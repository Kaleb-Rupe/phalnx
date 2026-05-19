use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::VaultReactivated;
use crate::state::*;
use crate::utils::audit_log::build_audit_entry;

#[derive(Accounts)]
pub struct ReactivateVault<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner @ SigilError::UnauthorizedOwner,
        seeds = [b"vault", owner.key().as_ref(), vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, AgentVault>,

    /// Phase 7 — success audit log; entry appended after status flip.
    #[account(
        mut,
        seeds = [b"audit_success", vault.key().as_ref()],
        bump = audit_log_success.load()?.bump,
    )]
    pub audit_log_success: AccountLoader<'info, AuditLogSuccess>,

    /// CHECK: Phase 7 — slot_hashes sysvar; address-pinned.
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::id())]
    pub slot_hashes_sysvar: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<ReactivateVault>,
    new_agent: Option<Pubkey>,
    new_agent_capability: Option<u8>,
) -> Result<()> {
    crate::reject_cpi!();

    let vault = &mut ctx.accounts.vault;

    // 1. Check frozen
    require!(
        vault.status == VaultStatus::Frozen,
        SigilError::VaultNotFrozen
    );

    // 2. Validate mutual presence of new_agent and new_agent_capability
    require!(
        new_agent.is_some() == new_agent_capability.is_some(),
        SigilError::InvalidPermissions
    );

    // 3. Optionally assign new agent
    if let Some(agent_key) = new_agent {
        let capability = new_agent_capability.unwrap();
        require!(agent_key != Pubkey::default(), SigilError::InvalidAgentKey);
        require!(agent_key != vault.owner, SigilError::AgentIsOwner);
        require!(
            capability <= FULL_CAPABILITY,
            SigilError::InvalidPermissions
        );
        require!(
            vault.agent_count() < MAX_AGENTS_PER_VAULT,
            SigilError::MaxAgentsReached
        );
        require!(
            !vault.is_agent(&agent_key),
            SigilError::AgentAlreadyRegistered
        );
        vault.agents.push(AgentEntry {
            pubkey: agent_key,
            capability,
            consecutive_failures: 0, // TA-17 (Phase 3): fresh counter on reactivation
            _reserved: [0u8; 6],
            spending_limit_usd: 0, // reactivation agent starts with no per-agent limit
            paused: false,
        });
    }

    // 4. Guard against soft-lock: cannot activate with no agents
    require!(!vault.agents.is_empty(), SigilError::NoAgentRegistered);

    // 5. Mutate status only after all checks pass
    vault.status = VaultStatus::Active;

    let clock = Clock::get()?;
    let vault_key = vault.key();

    // Phase 7 — write success audit-log entry AFTER state mutation.
    {
        let entry = build_audit_entry(
            AUDIT_DISC_REACTIVATE,
            vault_key,
            0,
            0,
            clock.unix_timestamp,
            &ctx.accounts.slot_hashes_sysvar.to_account_info(),
        )?;
        let mut log = ctx.accounts.audit_log_success.load_mut()?;
        // §RP-1 I-2: defense-in-depth guard against future seeds drift.
        require_keys_eq!(
            log.vault,
            ctx.accounts.vault.key(),
            SigilError::ZeroCopyVaultMismatch
        );
        log.append(entry);
    }

    emit!(VaultReactivated {
        vault: vault_key,
        new_agent,
        new_agent_capability,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
