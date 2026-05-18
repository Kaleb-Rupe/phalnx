use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::CloseConstraintsApplied;
use crate::state::*;
use crate::utils::policy_digest::{compute_policy_preview_digest, PolicyPreviewFields};

#[derive(Accounts)]
pub struct ApplyCloseConstraints<'info> {
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
        seeds = [b"constraints", vault.key().as_ref()],
        bump = constraints.load()?.bump,
        close = owner,
    )]
    pub constraints: AccountLoader<'info, InstructionConstraints>,

    #[account(
        mut,
        constraint = pending_close_constraints.vault == vault.key(),
        seeds = [b"pending_close_constraints", vault.key().as_ref()],
        bump = pending_close_constraints.bump,
        close = owner,
    )]
    pub pending_close_constraints: Account<'info, PendingCloseConstraints>,
}

pub fn handler(
    ctx: Context<ApplyCloseConstraints>,
    // PEN-CROSS-3 (Phase 2 close-up): owner-signed expected digest covering
    // the POST-mutation policy state (with `has_constraints=false`). Same
    // defense rationale as `create_instruction_constraints` — closes the
    // owner blind-sign vector.
    expected_digest: [u8; 32],
) -> Result<()> {
    crate::reject_cpi!();

    let clock = Clock::get()?;
    let pending = &ctx.accounts.pending_close_constraints;

    // Verify constraints belongs to this vault (replaces has_one = vault)
    {
        let c = ctx.accounts.constraints.load()?;
        require!(
            c.vault == ctx.accounts.vault.key().to_bytes(),
            SigilError::InvalidConstraintsPda
        );
    }

    // Timelock must have expired
    require!(
        pending.is_ready(clock.unix_timestamp),
        SigilError::TimelockNotExpired
    );

    // F-10 audit fix: slot-bounded freshness check defends against durable-nonce
    // pre-signing attacks (Drift Protocol April 2026 $285M analog).
    require!(
        clock.slot.saturating_sub(pending.queued_at_slot) < MAX_APPLY_AGE_SLOTS,
        SigilError::QueuedUpdateExpired,
    );

    // Clear the has_constraints flag so validate_and_authorize skips constraint checks
    let policy = &mut ctx.accounts.policy;
    policy.has_constraints = false;

    // TA-19 fix: has_constraints is part of the canonical policy_preview_digest
    // encoding. Recompute the stored digest from the post-mutation policy state
    // so external consumers see byte-perfect parity vs. their own recompute.
    let recomputed_digest = compute_policy_preview_digest(&PolicyPreviewFields {
        daily_spending_cap_usd: policy.daily_spending_cap_usd,
        max_transaction_size_usd: policy.max_transaction_size_usd,
        max_slippage_bps: policy.max_slippage_bps,
        developer_fee_rate: policy.developer_fee_rate,
        protocol_mode: policy.protocol_mode,
        protocols: &policy.protocols,
        destination_mode: policy.destination_mode,
        allowed_destinations: &policy.allowed_destinations,
        timelock_duration: policy.timelock_duration,
        session_expiry_seconds: policy.session_expiry_seconds,
        observe_only: ctx.accounts.vault.observe_only,
        has_constraints: policy.has_constraints,
        has_post_assertions: policy.has_post_assertions,
        // PEN-CROSS-2: created_at_slot is immutable post-init.
        created_at_slot: policy.created_at_slot,
        // TA-05 (Phase 3): operating_hours is policy-owned and bound by TA-19.
        // Sibling handler reads from live policy — this ix never mutates it.
        operating_hours: policy.operating_hours,
        // TA-07/17 (Phase 3): auto_promote_grays + auto_revoke_threshold
        // are policy-owned and bound by TA-19. Sibling handler passes them
        // through from live policy — never mutated here.
        auto_promote_grays: policy.auto_promote_grays,
        auto_revoke_threshold: policy.auto_revoke_threshold,
        // TA-12 (Phase 5): stable_balance_floor is policy-owned and bound
        // by TA-19. apply_close_constraints never mutates it — pass
        // through from live policy.
        stable_balance_floor: policy.stable_balance_floor,
        // TA-14 (Phase 5): per_recipient_daily_cap_usd is policy-owned
        // and bound by TA-19. Sibling handler — never mutates it.
        per_recipient_daily_cap_usd: policy.per_recipient_daily_cap_usd,
        // G6 (audit 2026-05-18 cosign opt-in): bound by TA-19 at canonical
        // position 20. Sibling handler reads live policy.
        cosign_required: policy.cosign_required,
    });
    // PEN-CROSS-3: owner must have signed the post-mutation digest.
    require!(
        recomputed_digest == expected_digest,
        SigilError::PolicyPreviewMismatch
    );
    policy.policy_preview_digest = recomputed_digest;

    // Bump policy version — removing constraints affects security posture
    policy.policy_version = policy
        .policy_version
        .checked_add(1)
        .ok_or(error!(SigilError::Overflow))?;

    emit!(CloseConstraintsApplied {
        vault: ctx.accounts.vault.key(),
        applied_at: clock.unix_timestamp,
    });

    // If caller provides PendingConstraintsUpdate in remaining_accounts, close it too
    // (same pattern as the old close_instruction_constraints.rs:53-70)
    if let Some(pending_info) = ctx.remaining_accounts.first() {
        let (expected_pda, _) = Pubkey::find_program_address(
            &[b"pending_constraints", ctx.accounts.vault.key().as_ref()],
            ctx.program_id,
        );
        if pending_info.key() == expected_pda && pending_info.lamports() > 0 {
            let owner_info = ctx.accounts.owner.to_account_info();
            let dest_lamports = owner_info.lamports();
            **owner_info.try_borrow_mut_lamports()? = dest_lamports
                .checked_add(pending_info.lamports())
                .ok_or(error!(SigilError::Overflow))?;
            **pending_info.try_borrow_mut_lamports()? = 0;
            pending_info.assign(&anchor_lang::system_program::ID);
            pending_info.resize(0)?;
        }
    }

    Ok(())
}
