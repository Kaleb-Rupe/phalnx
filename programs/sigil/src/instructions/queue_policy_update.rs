use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::PolicyChangeQueued;
use crate::state::*;
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

    // observe_only is NOT mutable via queue_policy_update (Phase 2 scope):
    // captured at init only. Read from vault for digest correctness.
    let eff_observe_only = vault.observe_only;
    let eff_has_constraints = policy.has_constraints;
    let eff_has_post_assertions = policy.has_post_assertions;

    let recomputed_digest = compute_policy_preview_digest(&PolicyPreviewFields {
        daily_spending_cap_usd: eff_daily,
        max_transaction_size_usd: eff_max_tx,
        max_slippage_bps: eff_max_slip,
        protocol_mode: eff_protocol_mode,
        protocols: &eff_protocols_owned,
        destination_mode: eff_dest_mode,
        allowed_destinations: &eff_destinations_owned,
        timelock_duration: eff_timelock,
        session_expiry_seconds: eff_session_expiry,
        observe_only: eff_observe_only,
        has_constraints: eff_has_constraints,
        has_post_assertions: eff_has_post_assertions,
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
