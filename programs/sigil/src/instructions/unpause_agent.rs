use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::AgentUnpausedEvent;
use crate::state::*;

#[derive(Accounts)]
pub struct UnpauseAgent<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner @ SigilError::UnauthorizedOwner,
        seeds = [b"vault", owner.key().as_ref(), vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, AgentVault>,

    /// PEN-CROSS-5 (Phase 4 absorption) — bump policy_version on unpause.
    /// Symmetric with pause_agent; the four agent-mutation ix
    /// (register / revoke / pause / unpause) all bump version so OCC
    /// signals fire uniformly regardless of which mutation lands.
    #[account(
        mut,
        seeds = [b"policy", vault.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, PolicyConfig>,
}

pub fn handler(ctx: Context<UnpauseAgent>, agent_to_unpause: Pubkey) -> Result<()> {
    crate::reject_cpi!();

    let vault = &mut ctx.accounts.vault;

    // Works on Active or Frozen vaults (not Closed)
    require!(
        vault.status != VaultStatus::Closed,
        SigilError::VaultAlreadyClosed
    );

    // Find the agent entry
    let agent_entry = vault
        .agents
        .iter_mut()
        .find(|a| a.pubkey == agent_to_unpause)
        .ok_or(error!(SigilError::UnauthorizedAgent))?;

    // Must be paused
    require!(agent_entry.paused, SigilError::AgentNotPaused);

    agent_entry.paused = false;

    // PEN-CROSS-5 (Phase 4 absorption): bump policy_version. See
    // revoke_agent.rs for rationale.
    let policy = &mut ctx.accounts.policy;
    policy.policy_version = policy
        .policy_version
        .checked_add(1)
        .ok_or(error!(SigilError::Overflow))?;

    let clock = Clock::get()?;
    emit!(AgentUnpausedEvent {
        vault: vault.key(),
        agent: agent_to_unpause,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
