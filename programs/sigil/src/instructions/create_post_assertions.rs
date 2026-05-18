use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::state::policy::PolicyConfig;
use crate::state::post_assertions::*;
use crate::state::vault::AgentVault;
use crate::utils::policy_digest::{compute_policy_preview_digest, PolicyPreviewFields};

#[derive(Accounts)]
pub struct CreatePostAssertions<'info> {
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
        init,
        payer = owner,
        space = PostExecutionAssertions::SIZE,
        seeds = [b"post_assertions", vault.key().as_ref()],
        bump,
    )]
    pub post_assertions: AccountLoader<'info, PostExecutionAssertions>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreatePostAssertions>,
    entries: Vec<PostAssertionEntry>,
    // PEN-CROSS-3 (Phase 2 close-up): owner-signed expected digest covering
    // the POST-mutation policy state (with `has_post_assertions=1`).
    expected_digest: [u8; 32],
) -> Result<()> {
    crate::reject_cpi!();

    // Validate entries
    PostExecutionAssertions::validate_entries(&entries)?;

    let vault_key = ctx.accounts.vault.key();

    // Pack entries into zero-copy account
    let mut assertions = ctx.accounts.post_assertions.load_init()?;
    assertions.vault = vault_key.to_bytes();
    assertions.bump = ctx.bumps.post_assertions;
    assertions.entry_count = entries.len() as u8;

    for (i, entry) in entries.iter().enumerate() {
        let zc = &mut assertions.entries[i];
        zc.target_account = entry.target_account.to_bytes();
        zc.offset = entry.offset;
        zc.value_len = entry.value_len;
        zc.operator = entry.operator;
        zc.assertion_mode = entry.assertion_mode;

        // Phase B3 CrossFieldLte field copies DELETED in Phase 1 Option A demolition.

        // Copy expected value (padded to MAX_CONSTRAINT_VALUE_LEN)
        let len = entry
            .expected_value
            .len()
            .min(crate::state::constraints::MAX_CONSTRAINT_VALUE_LEN);
        zc.expected_value[..len].copy_from_slice(&entry.expected_value[..len]);
    }

    // Set the feature flag on PolicyConfig.
    // TA-19 fix: has_post_assertions is part of the canonical
    // policy_preview_digest encoding. Recompute the stored digest from the
    // post-mutation policy state and bump policy_version (OCC counter).
    let policy = &mut ctx.accounts.policy;
    policy.has_post_assertions = 1;

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
    // PEN-CROSS-3: owner must have signed the post-mutation digest.
    require!(
        recomputed_digest == expected_digest,
        SigilError::PolicyPreviewMismatch
    );
    policy.policy_preview_digest = recomputed_digest;

    policy.policy_version = policy
        .policy_version
        .checked_add(1)
        .ok_or(error!(SigilError::Overflow))?;

    emit!(crate::events::PostAssertionsCreated {
        vault: vault_key,
        entry_count: entries.len() as u8,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
