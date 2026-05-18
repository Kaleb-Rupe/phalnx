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

    let is_elevated = raises_daily_cap
        || raises_max_tx
        || expands_destinations
        || expands_protocols;

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

    ctx.accounts.policy.has_pending_policy = true;

    emit!(PolicyChangeQueued {
        vault: vault.key(),
        executes_at,
    });

    Ok(())
}
