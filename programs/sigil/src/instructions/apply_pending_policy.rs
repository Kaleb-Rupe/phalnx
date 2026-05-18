use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::PolicyChangeApplied;
use crate::state::*;
use crate::utils::policy_digest::{compute_policy_preview_digest, PolicyPreviewFields};

#[derive(Accounts)]
pub struct ApplyPendingPolicy<'info> {
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
        mut,
        has_one = vault,
        seeds = [b"pending_policy", vault.key().as_ref()],
        bump = pending_policy.bump,
        close = owner,
    )]
    pub pending_policy: Account<'info, PendingPolicyUpdate>,
}

pub fn handler(ctx: Context<ApplyPendingPolicy>) -> Result<()> {
    crate::reject_cpi!();

    let clock = Clock::get()?;
    let pending = &ctx.accounts.pending_policy;

    // Timelock must have expired
    require!(
        pending.is_ready(clock.unix_timestamp),
        SigilError::TimelockNotExpired
    );

    // F-10 audit fix: slot-bounded freshness check defends against durable-nonce
    // pre-signing attacks (Drift Protocol April 2026 $285M analog). Limits the
    // time between queue and apply to MAX_APPLY_AGE_SLOTS — beyond that, the
    // queued update is stale and must be re-queued by the owner.
    require!(
        clock.slot.saturating_sub(pending.queued_at_slot) < MAX_APPLY_AGE_SLOTS,
        SigilError::QueuedUpdateExpired,
    );

    let policy = &mut ctx.accounts.policy;

    // Apply each non-None field
    if let Some(cap) = pending.daily_spending_cap_usd {
        policy.daily_spending_cap_usd = cap;
    }
    if let Some(max_tx) = pending.max_transaction_amount_usd {
        policy.max_transaction_size_usd = max_tx;
    }
    if let Some(mode) = pending.protocol_mode {
        policy.protocol_mode = mode;
    }
    if let Some(ref protos) = pending.protocols {
        policy.protocols = protos.clone();
    }
    if let Some(fee_rate) = pending.developer_fee_rate {
        policy.developer_fee_rate = fee_rate;
    }
    if let Some(slippage) = pending.max_slippage_bps {
        policy.max_slippage_bps = slippage;
    }
    if let Some(tl) = pending.timelock_duration {
        require!(tl >= MIN_TIMELOCK_DURATION, SigilError::TimelockTooShort);
        policy.timelock_duration = tl;
    }
    if let Some(ref destinations) = pending.allowed_destinations {
        policy.allowed_destinations = destinations.clone();
    }
    if let Some(expiry) = pending.session_expiry_seconds {
        policy.session_expiry_seconds = expiry;
    }
    if let Some(hpc) = pending.has_protocol_caps {
        policy.has_protocol_caps = hpc;
    }
    if let Some(ref caps) = pending.protocol_caps {
        policy.protocol_caps = caps.clone();
    }
    if let Some(mode) = pending.destination_mode {
        // Phase 2 Option A: re-validate at apply time. OPEN_WITH_CAP deleted.
        require!(
            mode == DESTINATION_MODE_RESTRICTED,
            SigilError::InvalidDestinationMode
        );
        policy.destination_mode = mode;
    }
    // Phase 2 Option A: defense-in-depth — re-validate protocol_mode if pending overrode it.
    if let Some(mode) = pending.protocol_mode {
        require!(
            mode == PROTOCOL_MODE_ALLOWLIST,
            SigilError::InvalidProtocolMode
        );
    }

    // Phase 2 TA-19: re-assert the digest of the now-merged live policy against
    // the owner-signed `pending.new_policy_preview_digest`. This is the second
    // defense — the first ran at `queue_policy_update`. If a rogue program
    // tampered with the pending PDA between queue and apply (e.g. discriminator
    // collision via a future zero-copy account type), the recomputed digest
    // diverges and we hard-reject.
    let recomputed_digest = compute_policy_preview_digest(&PolicyPreviewFields {
        daily_spending_cap_usd: policy.daily_spending_cap_usd,
        max_transaction_size_usd: policy.max_transaction_size_usd,
        max_slippage_bps: policy.max_slippage_bps,
        protocol_mode: policy.protocol_mode,
        protocols: &policy.protocols,
        destination_mode: policy.destination_mode,
        allowed_destinations: &policy.allowed_destinations,
        timelock_duration: policy.timelock_duration,
        session_expiry_seconds: policy.session_expiry_seconds,
        observe_only: ctx.accounts.vault.observe_only,
        has_constraints: policy.has_constraints,
        has_post_assertions: policy.has_post_assertions,
    });
    require!(
        recomputed_digest == pending.new_policy_preview_digest,
        SigilError::PolicyPreviewMismatch
    );
    // Persist the new digest into live policy for future reads.
    policy.policy_preview_digest = pending.new_policy_preview_digest;

    policy.has_pending_policy = false;

    // Bump policy version — agents will detect this via PolicyVersionMismatch
    policy.policy_version = policy
        .policy_version
        .checked_add(1)
        .ok_or(error!(SigilError::Overflow))?;

    emit!(PolicyChangeApplied {
        vault: ctx.accounts.vault.key(),
        applied_at: clock.unix_timestamp,
    });

    Ok(())
}
