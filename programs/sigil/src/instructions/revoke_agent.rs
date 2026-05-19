use anchor_lang::accounts::account_loader::AccountLoader;
use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::AgentRevoked;
use crate::state::*;
use crate::utils::audit_log::build_audit_entry;

#[derive(Accounts)]
pub struct RevokeAgent<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner @ SigilError::UnauthorizedOwner,
        seeds = [b"vault", owner.key().as_ref(), vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, AgentVault>,

    /// PEN-CROSS-5 (Phase 4 absorption) — bump policy_version on agent
    /// revocation. See register_agent.rs for the OCC rationale; revoke
    /// is the more important of the four (removing an agent must
    /// invalidate concurrent validates that race the revoke).
    #[account(
        mut,
        seeds = [b"policy", vault.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, PolicyConfig>,

    /// Agent spend overlay — release slot on revocation.
    #[account(
        mut,
        seeds = [b"agent_spend", vault.key().as_ref(), &[0u8]],
        bump = agent_spend_overlay.load()?.bump,
    )]
    pub agent_spend_overlay: AccountLoader<'info, AgentSpendOverlay>,

    /// Phase 7 — success audit log; entry appended after revoke completes.
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

pub fn handler(ctx: Context<RevokeAgent>, agent_to_remove: Pubkey) -> Result<()> {
    crate::reject_cpi!();

    let vault = &mut ctx.accounts.vault;

    require!(
        vault.status != VaultStatus::Closed,
        SigilError::VaultAlreadyClosed
    );
    require!(
        vault.is_agent(&agent_to_remove),
        SigilError::UnauthorizedAgent
    );

    // Release overlay slot before removing agent from vault
    if let Ok(mut overlay) = ctx.accounts.agent_spend_overlay.load_mut() {
        if let Some(slot_idx) = overlay.find_agent_slot(&agent_to_remove) {
            overlay.release_slot(slot_idx);
        }
    }

    vault.agents.retain(|a| a.pubkey != agent_to_remove);

    // Freeze if no agents remain
    if vault.agents.is_empty() {
        vault.status = VaultStatus::Frozen;
    }

    // PEN-CROSS-5 (Phase 4 absorption): bump policy_version. Critical for
    // revoke specifically — a concurrent validate_and_authorize on the
    // about-to-be-revoked agent could otherwise sneak through if the
    // existing is_agent constraint check loses the TOCTOU race. The OCC
    // bump means any in-flight validate built against the pre-revoke
    // version rejects with PolicyVersionMismatch.
    let policy = &mut ctx.accounts.policy;
    policy.policy_version = policy
        .policy_version
        .checked_add(1)
        .ok_or(error!(SigilError::Overflow))?;

    let clock = Clock::get()?;
    let vault_key = vault.key();
    let remaining = vault.agent_count() as u8;

    // Phase 7 — write success audit-log entry.
    {
        let entry = build_audit_entry(
            AUDIT_DISC_REVOKE_AGENT,
            agent_to_remove,
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

    emit!(AgentRevoked {
        vault: vault_key,
        agent: agent_to_remove,
        remaining_agents: remaining,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
