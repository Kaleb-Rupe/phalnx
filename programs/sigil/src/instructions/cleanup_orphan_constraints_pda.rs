use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::OrphanConstraintsPdaCleaned;
use crate::state::*;

/// Cleanup an orphaned InstructionConstraints PDA after a partial
/// `allocate_constraints_pda` + `extend_pda` chain that never reached
/// `create_instruction_constraints` (e.g. ran out of compute budget mid-extend).
///
/// Without this instruction, the vault would be wedged: the orphan PDA exists
/// at the canonical constraints seeds, owned by the program, but never had a
/// discriminator written. `allocate_constraints_pda` rejects it
/// (`lamports != 0`), `apply_close_constraints` rejects it
/// (`policy.has_constraints == false` AND no queued close), and `close_vault`
/// has no scan path for ghost PDAs.
///
/// Guards (all four required):
///   1. Caller is vault owner (Anchor `has_one = owner` on vault).
///   2. `policy.has_constraints == false` — there is no live constraint set.
///   3. PDA is owned by this program — never drain a system-owned account.
///   4. PDA's first 8 bytes (Anchor discriminator slot) are all zero — the
///      account was never populated. A populated InstructionConstraints PDA
///      always has a non-zero discriminator written by
///      `create_instruction_constraints`.
///
/// Effects: drains all lamports back to owner, reassigns the account to the
/// system program, and truncates its data to zero — matching the manual-close
/// pattern used in `apply_close_constraints` and `close_vault`. This both
/// reclaims rent and erases the stale vault-key bytes at offset 8..40 so a
/// future seed-derivation collision cannot read them.
///
/// Audit reference: F3-H1 (third-pass adversarial review, severity 4).
#[derive(Accounts)]
pub struct CleanupOrphanConstraintsPda<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        has_one = owner @ SigilError::UnauthorizedOwner,
        seeds = [b"vault", vault.vault_authority.as_ref(), vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, AgentVault>,

    #[account(
        has_one = vault,
        seeds = [b"policy", vault.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, PolicyConfig>,

    /// CHECK: Validated in handler — must be at constraints PDA seeds, owned
    /// by this program, and discriminator zero (orphan from incomplete
    /// allocate+extend+populate chain).
    #[account(
        mut,
        seeds = [b"constraints", vault.key().as_ref()],
        bump,
    )]
    pub orphan_pda: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<CleanupOrphanConstraintsPda>) -> Result<()> {
    crate::reject_cpi!();

    // Guard 2: there is no live constraint set on this vault.
    let policy = &ctx.accounts.policy;
    require!(
        !policy.has_constraints,
        SigilError::ConstraintsAlreadyPopulated,
    );

    let info = ctx.accounts.orphan_pda.to_account_info();

    // Guard 3: PDA must be owned by this program — never drain
    // a system-owned (i.e. uninitialized) account or a foreign-owned one.
    require!(info.owner == &crate::ID, SigilError::OrphanPdaWrongOwner);

    // Guard 4: discriminator slot must be zero (account was never populated).
    // A live InstructionConstraints PDA always has its 8-byte Anchor
    // discriminator written by `create_instruction_constraints`.
    {
        let data = info.try_borrow_data()?;
        require!(
            data.len() >= 8 && data[..8] == [0u8; 8],
            SigilError::OrphanPdaPopulated,
        );
    }

    // Manual close — same pattern as apply_close_constraints / close_vault:
    // drain lamports, reassign to system program, truncate data.
    let owner_info = ctx.accounts.owner.to_account_info();
    let pda_lamports = info.lamports();
    let starting_lamports = owner_info.lamports();
    **owner_info.try_borrow_mut_lamports()? = starting_lamports
        .checked_add(pda_lamports)
        .ok_or(error!(SigilError::Overflow))?;
    **info.try_borrow_mut_lamports()? = 0;
    info.assign(&anchor_lang::system_program::ID);
    info.resize(0)?;

    emit!(OrphanConstraintsPdaCleaned {
        vault: ctx.accounts.vault.key(),
        rent_recovered: pda_lamports,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
