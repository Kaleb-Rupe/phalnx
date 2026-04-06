use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::errors::SigilError;
use crate::state::*;

use super::allocate_constraints_pda::MAX_CPI_ACCOUNT_SIZE;

/// Grow a program-owned PDA by up to MAX_CPI_ACCOUNT_SIZE bytes.
/// Generic: works for InstructionConstraints and PendingConstraintsUpdate.
///
/// Security: verifies the PDA is owned by this program, that the vault
/// field (at offset 8..40 in the raw data) matches the provided vault,
/// and that the signer is the vault owner.
#[derive(Accounts)]
pub struct ExtendPda<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        has_one = owner @ SigilError::UnauthorizedOwner,
        seeds = [b"vault", owner.key().as_ref(), vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, AgentVault>,

    /// CHECK: Program-owned PDA being extended. Verified in handler:
    /// owner == crate::ID, vault bytes match, size within bounds.
    #[account(mut)]
    pub pda: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ExtendPda>, target_size: u32) -> Result<()> {
    let pda_info = ctx.accounts.pda.to_account_info();
    let vault_key = ctx.accounts.vault.key();

    // Verify the PDA is owned by this program
    require!(
        pda_info.owner == &crate::ID,
        SigilError::InvalidConstraintsPda
    );

    // Verify the vault field at offset 8..40 matches
    {
        let data = pda_info.try_borrow_data()?;
        require!(data.len() >= 40, SigilError::InvalidConstraintsPda);
        require!(
            data[8..40] == vault_key.to_bytes(),
            SigilError::ConstraintsVaultMismatch
        );
    }

    let current_size = pda_info.data_len();
    let target = target_size as usize;

    // Must be growing, not shrinking
    require!(target > current_size, SigilError::InvalidConstraintConfig);

    // Enforce per-instruction limit (runtime also enforces this, but fail early with a clear error)
    require!(
        target.saturating_sub(current_size) <= MAX_CPI_ACCOUNT_SIZE,
        SigilError::InvalidConstraintConfig
    );

    // Realloc the account data
    #[allow(deprecated)]
    pda_info.realloc(target, false)?;

    // Transfer additional rent from owner to PDA via system_program CPI.
    // Direct lamport modification is not allowed on accounts we don't own (owner = system program).
    let rent = Rent::get()?;
    let new_min_lamports = rent.minimum_balance(target);
    let current_lamports = pda_info.lamports();
    if new_min_lamports > current_lamports {
        let diff = new_min_lamports
            .checked_sub(current_lamports)
            .ok_or(SigilError::Overflow)?;
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: pda_info.clone(),
                },
            ),
            diff,
        )?;
    }

    Ok(())
}
