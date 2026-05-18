use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::state::policy::PolicyConfig;
use crate::state::post_assertions::PostExecutionAssertions;
use crate::state::vault::AgentVault;
use crate::utils::policy_digest::{compute_policy_preview_digest, PolicyPreviewFields};

#[derive(Accounts)]
pub struct ClosePostAssertions<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner @ SigilError::UnauthorizedOwner,
        seeds = [b"vault", owner.key().as_ref(), vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, AgentVault>,

    #[account(
        mut,
        seeds = [b"policy", vault.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, PolicyConfig>,

    #[account(
        mut,
        seeds = [b"post_assertions", vault.key().as_ref()],
        bump = post_assertions.load()?.bump,
        close = owner,
    )]
    pub post_assertions: AccountLoader<'info, PostExecutionAssertions>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClosePostAssertions>) -> Result<()> {
    crate::reject_cpi!();

    let vault_key = ctx.accounts.vault.key();

    // Clear the feature flag on PolicyConfig.
    // TA-19 fix: has_post_assertions is part of the canonical
    // policy_preview_digest encoding. Recompute the stored digest from the
    // post-mutation policy state and bump policy_version (OCC counter).
    let policy = &mut ctx.accounts.policy;
    policy.has_post_assertions = 0;

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
    });
    policy.policy_preview_digest = recomputed_digest;

    policy.policy_version = policy
        .policy_version
        .checked_add(1)
        .ok_or(error!(SigilError::Overflow))?;

    emit!(crate::events::PostAssertionsClosed {
        vault: vault_key,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
