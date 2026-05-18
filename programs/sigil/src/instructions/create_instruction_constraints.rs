use anchor_lang::prelude::*;
use anchor_lang::Discriminator;

use crate::errors::SigilError;
use crate::events::InstructionConstraintsCreated;
use crate::state::constraints::{pack_entries, InstructionConstraints};
use crate::state::*;
use crate::utils::policy_digest::{compute_policy_preview_digest, PolicyPreviewFields};

/// Populate a pre-allocated InstructionConstraints PDA with entries.
///
/// The PDA must have been created via `allocate_constraints_pda` + `extend_pda`
/// to reach `InstructionConstraints::SIZE` before this instruction is called.
/// All five instructions are composed into a single atomic transaction by the SDK.
#[derive(Accounts)]
pub struct CreateInstructionConstraints<'info> {
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

    /// CHECK: Pre-allocated PDA at InstructionConstraints::SIZE.
    /// Verified in handler: correct size, program-owned, vault match, no discriminator yet.
    #[account(
        mut,
        seeds = [b"constraints", vault.key().as_ref()],
        bump,
    )]
    pub constraints: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<CreateInstructionConstraints>,
    entries: Vec<ConstraintEntry>,
) -> Result<()> {
    crate::reject_cpi!();

    InstructionConstraints::validate_entries(&entries)?;

    let vault_key = ctx.accounts.vault.key();
    let bump = ctx.bumps.constraints;
    let entry_count = entries.len() as u8;

    let info = ctx.accounts.constraints.to_account_info();

    // Verify the account is fully extended and ready for population
    require!(
        info.data_len() == InstructionConstraints::SIZE,
        SigilError::InvalidConstraintsPda
    );
    require!(info.owner == &crate::ID, SigilError::InvalidConstraintsPda);

    {
        let mut data = info.try_borrow_mut_data()?;

        // Verify discriminator slot is zeroed (prevents double-init)
        require!(data[..8] == [0u8; 8], SigilError::InvalidConstraintConfig);

        // Verify vault key was written by allocate step
        require!(
            data[8..40] == vault_key.to_bytes(),
            SigilError::ConstraintsVaultMismatch
        );

        // Write Anchor discriminator
        data[..8].copy_from_slice(InstructionConstraints::DISCRIMINATOR);

        // Write fields via bytemuck (zero-copy direct memory access)
        let struct_size = core::mem::size_of::<InstructionConstraints>();
        let constraints: &mut InstructionConstraints =
            bytemuck::from_bytes_mut(&mut data[8..8 + struct_size]);

        constraints.vault = vault_key.to_bytes();
        // strict_mode field removed in V2 (REVAMP_PLAN §2.2) — constraints
        // are always strictly enforced.
        constraints.bump = bump;
        // V2: schema version stamp. Always 1 for new deployments.
        // Doc-comment at state/constraints.rs:186 promises constraint_version
        // is 1; CRIT-2 fix sets it explicitly on PDA init (was leaking 0).
        constraints.constraint_version = 1;

        let mut count = 0u8;
        pack_entries(&entries, &mut constraints.entries, &mut count)?;
        constraints.entry_count = count;
    }

    // Set has_constraints flag on policy.
    // TA-19 fix: this flag is part of the canonical policy_preview_digest
    // encoding. After mutation we MUST recompute the stored digest so that
    // external consumers comparing PolicyConfig.policy_preview_digest against
    // their own canonical recompute see byte-perfect parity. We also bump
    // policy_version as an OCC counter (consistent with apply_pending_policy).
    let policy = &mut ctx.accounts.policy;
    policy.has_constraints = true;

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
    });
    policy.policy_preview_digest = recomputed_digest;

    policy.policy_version = policy
        .policy_version
        .checked_add(1)
        .ok_or(error!(SigilError::Overflow))?;

    emit!(InstructionConstraintsCreated {
        vault: vault_key,
        entries_count: entry_count,
        discriminator_formats: entries
            .iter()
            .map(|e| e.discriminator_format as u8)
            .collect(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
