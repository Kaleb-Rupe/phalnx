use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::PolicyChangeQueued;
use crate::state::*;
use crate::utils::cosign_digest::{compute_cosign_digest, CosignDigestFields};
use crate::utils::policy_digest::{compute_policy_preview_digest, PolicyPreviewFields};

#[derive(Accounts)]
pub struct QueuePolicyUpdate<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        has_one = owner @ SigilError::UnauthorizedOwner,
        seeds = [b"vault", owner.key().as_ref(), vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, AgentVault>,

    #[account(
        mut,
        has_one = vault,
        seeds = [b"policy", vault.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, PolicyConfig>,

    #[account(
        init,
        payer = owner,
        space = PendingPolicyUpdate::SIZE,
        seeds = [b"pending_policy", vault.key().as_ref()],
        bump,
    )]
    pub pending_policy: Account<'info, PendingPolicyUpdate>,

    pub system_program: Program<'info, System>,

    // TA-09 (Phase 3): co-signing session is NOT a standalone account
    // here — it's surfaced via the `cosign_session` IX ARG (Pubkey) +
    // `ctx.remaining_accounts`. When elevated mutations are detected,
    // the handler searches remaining_accounts for an entry matching
    // the cosign_session pubkey arg AND with `is_signer == true`.
    //
    // Why this design instead of a typed Option<UncheckedAccount>:
    // Anchor 0.32's optional-account marshalling (passing the program_id
    // as a sentinel for None) interferes with downstream account ordering
    // assumptions when the test client uses `cosignSession: null`. Using
    // a plain remaining_accounts scan with an arg-bound pubkey gives a
    // simpler, more deterministic interface that the LiteSVM + production
    // SDK both produce identically.
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<QueuePolicyUpdate>,
    daily_spending_cap_usd: Option<u64>,
    max_transaction_amount_usd: Option<u64>,
    protocol_mode: Option<u8>,
    protocols: Option<Vec<Pubkey>>,
    developer_fee_rate: Option<u16>,
    max_slippage_bps: Option<u16>,
    timelock_duration: Option<u64>,
    allowed_destinations: Option<Vec<Pubkey>>,
    session_expiry_seconds: Option<u64>,
    has_protocol_caps: Option<bool>,
    protocol_caps: Option<Vec<u64>>,
    destination_mode: Option<u8>,
    operating_hours: Option<u32>,
    // TA-12 (Phase 5 post-exec): owner-controlled stablecoin floor.
    // None = pass through from live policy; Some(n) = update.
    // Bound by TA-19 at canonical digest position 18. NOTE: lowering
    // this is an "elevated mutation" per TA-09 (deferred — Phase 9 will
    // wire the cosign gate for floor reductions; current ix permits
    // lowering through ordinary queue/apply since TA-09 cosign currently
    // covers only the original 4 elevated conditions).
    stable_balance_floor: Option<u64>,
    // TA-14 (Phase 5 post-exec): owner-controlled per-recipient daily cap.
    // None = pass through; Some(n) = update. Bound by TA-19 at digest
    // position 19. NOTE: raising this is an "elevated mutation" per
    // TA-09 (deferred to Phase 9 alongside the floor-lowering case).
    per_recipient_daily_cap_usd: Option<u64>,
    // TA-09 (Phase 3): the cosigning session pubkey. `Pubkey::default()`
    // means "no cosign required" (non-elevated mutation). For elevated
    // mutations the caller MUST pass a non-default pubkey AND include
    // the corresponding signer in `remaining_accounts`. Owner cannot
    // cosign themselves.
    cosign_session: Pubkey,
    new_policy_preview_digest: [u8; 32],
) -> Result<()> {
    crate::reject_cpi!();

    let vault = &ctx.accounts.vault;
    let policy = &ctx.accounts.policy;

    require!(
        vault.status != VaultStatus::Closed,
        SigilError::VaultAlreadyClosed
    );

    // Timelock must be configured to use queue
    require!(
        policy.timelock_duration > 0,
        SigilError::NoTimelockConfigured
    );

    // Phase 2 Option A: protocol_mode and destination_mode are tightened.
    if let Some(ref mode) = protocol_mode {
        require!(
            *mode == PROTOCOL_MODE_ALLOWLIST,
            SigilError::InvalidProtocolMode
        );
    }
    if let Some(ref mode) = destination_mode {
        require!(
            *mode == DESTINATION_MODE_RESTRICTED,
            SigilError::InvalidDestinationMode
        );
    }
    if let Some(ref protos) = protocols {
        require!(
            protos.len() <= MAX_ALLOWED_PROTOCOLS,
            SigilError::TooManyAllowedProtocols
        );
    }
    if let Some(ref fee_rate) = developer_fee_rate {
        require!(
            *fee_rate <= MAX_DEVELOPER_FEE_RATE,
            SigilError::DeveloperFeeTooHigh
        );
    }
    if let Some(ref slippage) = max_slippage_bps {
        require!(
            *slippage <= MAX_SLIPPAGE_BPS,
            SigilError::SlippageBpsTooHigh
        );
    }
    if let Some(ref destinations) = allowed_destinations {
        require!(
            destinations.len() <= MAX_ALLOWED_DESTINATIONS,
            SigilError::TooManyDestinations
        );
    }
    if let Some(ref tl) = timelock_duration {
        require!(*tl >= MIN_TIMELOCK_DURATION, SigilError::TimelockTooShort);
    }
    if let Some(ref expiry) = session_expiry_seconds {
        if *expiry > 0 {
            // Bounds: 5..=90 seconds. 0 reserved for "use default" (30s).
            // Tight upper bound defends against misconfiguration that would
            // leave delegations live for minutes (audit F5-H1).
            require!(
                *expiry >= MIN_SESSION_DURATION_SECONDS
                    && *expiry <= MAX_OWNER_SESSION_DURATION_SECONDS,
                SigilError::InvalidSessionExpiry
            );
        }
    }
    // TA-05 (Phase 3): if owner is updating operating_hours, ensure upper
    // 8 bits are zero. Bound by TA-19 — the recomputed digest below also
    // catches divergent encodings, but this is the explicit local check.
    if let Some(ref hours) = operating_hours {
        require!(
            *hours & !OPERATING_HOURS_VALID_MASK == 0,
            SigilError::ErrOutsideOperatingHours
        );
    }

    // Validate per-protocol caps consistency against resulting policy state
    {
        let effective_hpc = has_protocol_caps.unwrap_or(policy.has_protocol_caps);
        if effective_hpc {
            let effective_mode = protocol_mode.unwrap_or(policy.protocol_mode);
            require!(
                effective_mode == PROTOCOL_MODE_ALLOWLIST,
                SigilError::ProtocolCapsMismatch
            );
            let effective_protos_len = protocols
                .as_ref()
                .map_or(policy.protocols.len(), |p| p.len());
            let effective_caps_len = protocol_caps
                .as_ref()
                .map_or(policy.protocol_caps.len(), |c| c.len());
            require!(
                effective_caps_len == effective_protos_len,
                SigilError::ProtocolCapsMismatch
            );
        }
    }

    // Phase 2 TA-19: assert the owner's signed digest matches a recomputed
    // digest over the policy state that WILL result if this pending update is
    // applied. Any field the owner did not override is inherited from the live
    // `policy`. The on-chain re-compute prevents owner-signer blind-sign from
    // committing an unintended policy.
    //
    // The "effective" policy projected by this queue:
    let eff_daily = daily_spending_cap_usd.unwrap_or(policy.daily_spending_cap_usd);
    let eff_max_tx = max_transaction_amount_usd.unwrap_or(policy.max_transaction_size_usd);
    let eff_max_slip = max_slippage_bps.unwrap_or(policy.max_slippage_bps);
    // PEN-CROSS-6: developer_fee_rate is now part of the digest. Project the
    // merged-effective value the same way as other Option<…> fields.
    let eff_developer_fee_rate = developer_fee_rate.unwrap_or(policy.developer_fee_rate);
    let eff_protocol_mode = protocol_mode.unwrap_or(policy.protocol_mode);
    let eff_protocols_owned: Vec<Pubkey> = protocols
        .as_ref()
        .map(|v| v.clone())
        .unwrap_or_else(|| policy.protocols.clone());
    let eff_dest_mode = destination_mode.unwrap_or(policy.destination_mode);
    let eff_destinations_owned: Vec<Pubkey> = allowed_destinations
        .as_ref()
        .map(|v| v.clone())
        .unwrap_or_else(|| policy.allowed_destinations.clone());
    let eff_timelock = timelock_duration.unwrap_or(policy.timelock_duration);
    let eff_session_expiry = session_expiry_seconds.unwrap_or(policy.session_expiry_seconds);
    // TA-05 (Phase 3): merged-effective operating_hours.
    let eff_operating_hours = operating_hours.unwrap_or(policy.operating_hours);

    // observe_only is NOT mutable via queue_policy_update (uses dedicated
    // set_observe_only ix for direct owner-only mutation — F-12 audit fix,
    // Option (a) flip mirroring freeze_vault simplicity). Read from vault
    // for digest correctness so this queue's recomputed digest matches the
    // owner's signed digest even when set_observe_only ran independently.
    let eff_observe_only = vault.observe_only;
    let eff_has_constraints = policy.has_constraints;
    let eff_has_post_assertions = policy.has_post_assertions;
    // TA-12 (Phase 5): merged-effective stable_balance_floor.
    let eff_stable_balance_floor = stable_balance_floor.unwrap_or(policy.stable_balance_floor);
    // TA-14 (Phase 5): merged-effective per_recipient_daily_cap_usd.
    let eff_per_recipient_daily_cap_usd =
        per_recipient_daily_cap_usd.unwrap_or(policy.per_recipient_daily_cap_usd);

    // ─── TA-09 (Phase 3): elevated mutation detection + cosign binding ─
    //
    // Definition of "elevated mutation" per HARDENED §6:
    //   a) Raise daily_spending_cap_usd
    //   b) Raise max_transaction_size_usd
    //   c) Expand allowed_destinations (more entries OR different members)
    //   d) Expand allowed_protocols (more entries OR different members)
    //   e) Lower stable_balance_floor (Phase 5 — not yet implemented)
    //   f) Toggle observe_only sequence (false→true→false) — observe_only
    //      is mutated via dedicated `set_observe_only` ix, NOT this queue,
    //      so the gate lives there (Phase 8 absorption — out of scope).
    //
    // "Raise" is detected via `Option::Some(new) > live`. "Expand" is
    // detected via: new vec contains any pubkey NOT in live vec, OR new
    // len > live len.
    //
    // If ANY elevated condition is true, the handler REQUIRES the cosign
    // signer to be present + is_signer == true, and binds the
    // cosign_digest to a sha256 over the canonical pending args + the
    // cosign pubkey. Apply re-validates.
    let raises_daily_cap = daily_spending_cap_usd
        .is_some_and(|new| new > policy.daily_spending_cap_usd);
    let raises_max_tx = max_transaction_amount_usd
        .is_some_and(|new| new > policy.max_transaction_size_usd);
    let expands_destinations = allowed_destinations.as_ref().is_some_and(|new| {
        // Larger set, or any pubkey not in current list
        new.len() > policy.allowed_destinations.len()
            || new
                .iter()
                .any(|d| !policy.allowed_destinations.contains(d))
    });
    let expands_protocols = protocols.as_ref().is_some_and(|new| {
        new.len() > policy.protocols.len()
            || new.iter().any(|p| !policy.protocols.contains(p))
    });
    // G3 audit fix (2026-05-18): TA-12/14 elevation closure. Phase 5 shipped
    // stable_balance_floor + per_recipient_daily_cap_usd as queueable but did
    // NOT classify their hostile mutations (LOWERING the floor, RAISING the
    // per-recipient cap) as elevated. Independently flagged by Pentester (A1)
    // + code-reviewer (A2) + Architect (B1-6). Single-line each.
    //
    // G3a audit fix (§RP-2 2026-05-18): the naive `new > live` predicate
    // missed the "0 = unlimited / off" convention that finalize_session
    // already enforces (finalize_session.rs:486 for per-recipient cap;
    // finalize_session.rs:411-412 + state/policy.rs:347-355 for protocol_caps).
    // A hostile `Some(0)` for these caps actually DISABLES enforcement —
    // strictly weaker than any non-zero value — so it must be elevated even
    // though `0 > live_non_zero` evaluates false. Same applies to
    // `has_protocol_caps: Some(false)` (HIGH-1) and any single protocol cap
    // shrinking-to-zero or growing-to-larger.
    //
    // `lowers_floor` is intentionally NOT touched: stable_balance_floor uses
    // the same "0 = no enforcement" convention (finalize_session.rs:626) but
    // the relationship is INVERSE — a SMALLER floor is weaker. The existing
    // `new < live` already catches `Some(0)` when live > 0 (since 0 < live)
    // and correctly rejects RAISING the floor (which is strengthening).
    let lowers_floor =
        stable_balance_floor.is_some_and(|new| new < policy.stable_balance_floor);
    let weakens_per_recipient_cap = per_recipient_daily_cap_usd
        .is_some_and(|new| weakens_per_recipient_cap_predicate(new, policy.per_recipient_daily_cap_usd));
    let weakens_protocol_caps = has_protocol_caps.is_some_and(|new| !new)
        || protocol_caps
            .as_ref()
            .is_some_and(|new_caps| weakens_protocol_caps_predicate(new_caps, &policy.protocol_caps));

    let is_elevated = raises_daily_cap
        || raises_max_tx
        || expands_destinations
        || expands_protocols
        || lowers_floor
        || weakens_per_recipient_cap
        || weakens_protocol_caps;

    let (cosign_session_pubkey, cosign_digest_bound): (Pubkey, [u8; 32]) = if is_elevated {
        // Elevated mutation: cosign_session MUST be a non-default pubkey.
        require_keys_neq!(
            cosign_session,
            Pubkey::default(),
            SigilError::ErrCosignRequired
        );
        // Cosign signer MUST be DISTINCT from the owner — otherwise the
        // "two signers" gate collapses to a single one and cosign is
        // ceremonial. (HARDENED D-2 — "any owner-signed session within
        // validity window" — the owner using their own key would defeat
        // the purpose.)
        require_keys_neq!(
            cosign_session,
            ctx.accounts.owner.key(),
            SigilError::ErrCosignRequired
        );
        // The corresponding signer MUST be present in remaining_accounts
        // with `is_signer == true`. Solana enforces the signature; this
        // handler validates presence.
        let cosign_present = ctx.remaining_accounts.iter().any(|ai| {
            ai.key == &cosign_session && ai.is_signer
        });
        require!(cosign_present, SigilError::ErrCosignRequired);

        // Compute the cosign digest binding INSTRUCTION DATA HASH per
        // HARDENED: "The session signature must cover the SAME
        // instruction-data hash (sha256 of pending args) that the owner
        // signed."
        let digest = compute_cosign_digest(&CosignDigestFields {
            cosign_session: &cosign_session,
            daily_spending_cap_usd,
            max_transaction_amount_usd,
            allowed_destinations: allowed_destinations.as_deref(),
            protocols: protocols.as_deref(),
        });
        (cosign_session, digest)
    } else {
        // Non-elevated: zero digest + default session pubkey signals
        // "no cosign required" at apply time. The cosign_session arg
        // is ignored (clients can pass Pubkey::default()).
        (Pubkey::default(), [0u8; 32])
    };

    let recomputed_digest = compute_policy_preview_digest(&PolicyPreviewFields {
        daily_spending_cap_usd: eff_daily,
        max_transaction_size_usd: eff_max_tx,
        max_slippage_bps: eff_max_slip,
        developer_fee_rate: eff_developer_fee_rate,
        protocol_mode: eff_protocol_mode,
        protocols: &eff_protocols_owned,
        destination_mode: eff_dest_mode,
        allowed_destinations: &eff_destinations_owned,
        timelock_duration: eff_timelock,
        session_expiry_seconds: eff_session_expiry,
        observe_only: eff_observe_only,
        has_constraints: eff_has_constraints,
        has_post_assertions: eff_has_post_assertions,
        // PEN-CROSS-2: created_at_slot is bound to vault lifetime — never
        // mutates after init, so pass through from live policy.
        created_at_slot: policy.created_at_slot,
        // TA-05 (Phase 3): merged-effective operating_hours bound by TA-19.
        operating_hours: eff_operating_hours,
        // TA-07/17 (Phase 3): auto_promote_grays + auto_revoke_threshold are
        // not mutated by queue_policy_update in V1 — V2 may expose
        // dedicated set ix. Read live policy so the digest matches the
        // owner's signed digest when the owner didn't intend to change them.
        auto_promote_grays: policy.auto_promote_grays,
        auto_revoke_threshold: policy.auto_revoke_threshold,
        // TA-12 (Phase 5 post-exec): merged-effective stable_balance_floor
        // bound by TA-19. When the queue does not change this field the
        // value pass-through from live policy MUST match the owner's
        // signed digest — defends against a tampered SDK silently
        // lowering the reserve between queue and apply.
        stable_balance_floor: eff_stable_balance_floor,
        // TA-14 (Phase 5 post-exec): merged-effective per-recipient cap
        // bound by TA-19 at canonical position 19.
        per_recipient_daily_cap_usd: eff_per_recipient_daily_cap_usd,
    });
    require!(
        recomputed_digest == new_policy_preview_digest,
        SigilError::PolicyPreviewMismatch
    );

    let clock = Clock::get()?;
    let executes_at = clock
        .unix_timestamp
        .checked_add(policy.timelock_duration as i64)
        .ok_or(SigilError::Overflow)?;

    let pending = &mut ctx.accounts.pending_policy;
    pending.vault = vault.key();
    pending.queued_at = clock.unix_timestamp;
    pending.executes_at = executes_at;
    // F-10 audit fix: capture queue slot for slot-bounded freshness check.
    pending.queued_at_slot = clock.slot;
    pending.daily_spending_cap_usd = daily_spending_cap_usd;
    pending.max_transaction_amount_usd = max_transaction_amount_usd;
    pending.protocol_mode = protocol_mode;
    pending.protocols = protocols;
    pending.developer_fee_rate = developer_fee_rate;
    pending.max_slippage_bps = max_slippage_bps;
    pending.timelock_duration = timelock_duration;
    pending.allowed_destinations = allowed_destinations;
    pending.session_expiry_seconds = session_expiry_seconds;
    pending.has_protocol_caps = has_protocol_caps;
    pending.protocol_caps = protocol_caps;
    pending.destination_mode = destination_mode;
    pending.bump = ctx.bumps.pending_policy;
    // TA-05 (Phase 3): persist optional operating_hours update.
    pending.operating_hours = operating_hours;
    // TA-09 (Phase 3): persist cosign binding. `[0; 32]` + default
    // session = non-elevated; non-zero values = bound to this cosign.
    pending.cosign_digest = cosign_digest_bound;
    pending.cosign_session = cosign_session_pubkey;
    // Phase 2 TA-19: store the validated owner-signed digest. `apply_pending_policy`
    // re-asserts it after the timelock against the merged-effective policy.
    pending.new_policy_preview_digest = new_policy_preview_digest;
    // TA-12 (Phase 5): persist optional stable_balance_floor update.
    // None passes the live value through at apply time.
    pending.stable_balance_floor = stable_balance_floor;
    // TA-14 (Phase 5): persist optional per_recipient_daily_cap_usd update.
    pending.per_recipient_daily_cap_usd = per_recipient_daily_cap_usd;

    ctx.accounts.policy.has_pending_policy = true;

    emit!(PolicyChangeQueued {
        vault: vault.key(),
        executes_at,
    });

    Ok(())
}

/// G3a audit fix (§RP-2 2026-05-18): predicate detecting whether a proposed
/// `per_recipient_daily_cap_usd` value WEAKENS enforcement relative to the
/// live policy value. Honors the "0 = unlimited / off" convention enforced
/// at `finalize_session.rs:486` (`if policy.per_recipient_daily_cap_usd > 0`).
///
/// Semantics:
///   live == 0  → enforcement already disabled, no weaker state exists → false
///   new  == 0  → weakening (turning enforcement OFF) unless already off
///   both > 0   → weakening iff `new > live` (more spend allowed per recipient)
///
/// Extracted as a pub fn so the boundary cases can be unit-tested without a
/// full `PolicyConfig` / Anchor `Context` scaffold.
pub fn weakens_per_recipient_cap_predicate(new: u64, live: u64) -> bool {
    if live == 0 {
        // Already unlimited — no further weakening possible.
        return false;
    }
    if new == 0 {
        // Setting to "unlimited" from a bounded value is the canonical
        // attack vector flagged by §RP-2 CRIT-1.
        return true;
    }
    // Both bounded: weakening = strictly larger value.
    new > live
}

/// G3a audit fix (§RP-2 2026-05-18 HIGH-1): predicate detecting whether a
/// proposed `protocol_caps` vector weakens enforcement at the per-protocol
/// level. Honors the same "0 = unlimited" convention enforced at
/// `finalize_session.rs:411-412` (`if proto_cap > 0`).
///
/// A single cap is weakened iff:
///   - live_cap > 0  AND  (new_cap == 0  OR  new_cap > live_cap)
///
/// Missing entries in `live_caps` (shorter Vec than `new_caps`) are treated
/// as `live_cap = 0` (unlimited — no weakening possible at that index).
/// Returns true on FIRST weakened index seen.
///
/// NOTE: this does NOT cover the `has_protocol_caps: Some(false)` case —
/// that's a master-switch disable and is checked separately at the call site
/// in `handler()`.
///
/// Extracted as a pub fn so boundary cases can be unit-tested standalone.
pub fn weakens_protocol_caps_predicate(new_caps: &[u64], live_caps: &[u64]) -> bool {
    new_caps.iter().enumerate().any(|(i, &new_cap)| {
        let live_cap = live_caps.get(i).copied().unwrap_or(0);
        if live_cap == 0 {
            // Already unlimited (or missing live entry → unlimited per convention).
            return false;
        }
        if new_cap == 0 {
            // Turning OFF this protocol's cap is weakening.
            return true;
        }
        // Both bounded: weakening = strictly larger.
        new_cap > live_cap
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- weakens_per_recipient_cap_predicate (G3a §RP-2 CRIT-1) ---

    #[test]
    fn per_recipient_weakens_when_setting_zero_with_live_nonzero() {
        // CRIT-1 attack vector: live=$5 cap, attacker proposes Some(0)
        // → disables enforcement. Must be detected as weakening.
        assert!(weakens_per_recipient_cap_predicate(0, 5_000_000));
    }

    #[test]
    fn per_recipient_not_weakened_when_setting_zero_with_live_zero() {
        // No-op: live is already unlimited.
        assert!(!weakens_per_recipient_cap_predicate(0, 0));
    }

    #[test]
    fn per_recipient_not_weakened_when_setting_nonzero_with_live_zero() {
        // Owner is TIGHTENING from "unlimited" to a bounded value.
        // The new state is stricter than the live one — but the §RP-2 spec
        // explicitly classifies this as non-elevated since live=unlimited
        // means "already at the weakest state, anything is a tightening."
        assert!(!weakens_per_recipient_cap_predicate(1_000_000, 0));
        assert!(!weakens_per_recipient_cap_predicate(u64::MAX, 0));
    }

    #[test]
    fn per_recipient_weakens_when_new_larger_than_live_both_bounded() {
        // Classic raise: live=$5, new=$10 → more spend allowed → weakening.
        assert!(weakens_per_recipient_cap_predicate(10_000_000, 5_000_000));
    }

    #[test]
    fn per_recipient_not_weakened_when_new_smaller_than_live_both_bounded() {
        // Tightening from $10 to $5 → strictly stricter, not weakening.
        assert!(!weakens_per_recipient_cap_predicate(5_000_000, 10_000_000));
    }

    #[test]
    fn per_recipient_not_weakened_when_unchanged() {
        // No-op queue: no elevation needed.
        assert!(!weakens_per_recipient_cap_predicate(5_000_000, 5_000_000));
    }

    // --- weakens_protocol_caps_predicate (G3a §RP-2 HIGH-1) ---

    #[test]
    fn protocol_caps_weakens_when_cap_shrinks_to_zero() {
        // HIGH-1: live cap = $100, new = $0 → disables that protocol's cap.
        let live = vec![100_000_000u64, 50_000_000u64];
        let new = vec![0u64, 50_000_000u64];
        assert!(weakens_protocol_caps_predicate(&new, &live));
    }

    #[test]
    fn protocol_caps_weakens_when_cap_grows_to_higher_value() {
        // Classic raise on a single protocol: $100 → $200.
        let live = vec![100_000_000u64, 50_000_000u64];
        let new = vec![200_000_000u64, 50_000_000u64];
        assert!(weakens_protocol_caps_predicate(&new, &live));
    }

    #[test]
    fn protocol_caps_not_weakened_when_unchanged() {
        let live = vec![100_000_000u64, 50_000_000u64];
        let new = vec![100_000_000u64, 50_000_000u64];
        assert!(!weakens_protocol_caps_predicate(&new, &live));
    }

    #[test]
    fn protocol_caps_not_weakened_when_caps_tighten() {
        // Strictly tightening on both protocols.
        let live = vec![100_000_000u64, 50_000_000u64];
        let new = vec![50_000_000u64, 25_000_000u64];
        assert!(!weakens_protocol_caps_predicate(&new, &live));
    }

    #[test]
    fn protocol_caps_not_weakened_when_setting_zero_with_live_zero() {
        // Live unlimited → no further weakening possible at that index.
        let live = vec![0u64, 50_000_000u64];
        let new = vec![0u64, 25_000_000u64];
        assert!(!weakens_protocol_caps_predicate(&new, &live));
    }

    #[test]
    fn protocol_caps_not_weakened_when_live_shorter_and_new_index_zero() {
        // Missing live entries treated as unlimited (0) per get_protocol_cap
        // semantics at state/policy.rs:354.
        let live = vec![100_000_000u64];
        let new = vec![100_000_000u64, 0u64];
        assert!(!weakens_protocol_caps_predicate(&new, &live));
    }

    #[test]
    fn protocol_caps_weakens_on_first_weakened_index() {
        // Mixed: index 0 tightened, index 1 weakened. Must still detect.
        let live = vec![100_000_000u64, 50_000_000u64];
        let new = vec![50_000_000u64, 100_000_000u64];
        assert!(weakens_protocol_caps_predicate(&new, &live));
    }
}
