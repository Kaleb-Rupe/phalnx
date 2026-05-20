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

    /// Round 2 F-RP3-1 fix (audit 2026-05-19): policy is now mutated by
    /// `reactivate_vault` to:
    ///   1. Read `cosign_required` for the interim cosign gate (the previous
    ///      handler granted FULL_CAPABILITY to a fresh agent with NO cosign
    ///      gate on a cosign-opted-in vault — phished-owner instant operator
    ///      grant via freeze→reactivate(attacker, FULL_CAPABILITY)).
    ///   2. Bump `policy_version` after the agent push so any in-flight
    ///      validate_and_authorize fails fast with PolicyVersionMismatch
    ///      rather than relying on the slower vault.is_agent constraint.
    ///
    /// Policy-to-vault binding via PDA seeds — same pattern as
    /// `register_agent.rs:35-40`.
    #[account(
        mut,
        seeds = [b"policy", vault.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, PolicyConfig>,

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

    // Round 2 §RP-1 F-RP3-1 fix (audit 2026-05-19): status check fires
    // FIRST so callers operating on a non-frozen vault receive the more
    // diagnostic `VaultNotFrozen` (6021) rather than the misleading
    // `ErrCosignRequired` (6089) that the cosign gate would surface. The
    // cosign gate is still load-bearing for the phished-owner scenario
    // (freeze→reactivate(attacker, FULL_CAPABILITY)) — it just runs
    // SECOND so the error-code priority matches operator expectations.

    // 1. Status check FIRST — diagnostic priority. Read-only borrow so
    // the subsequent cosign-gate check on `ctx.accounts.policy` does not
    // conflict with a mutable borrow.
    require!(
        ctx.accounts.vault.status == VaultStatus::Frozen,
        SigilError::VaultNotFrozen
    );

    // 2. Interim cosign gate (Round 2 F-RP3-1). The previous handler
    // granted FULL_CAPABILITY to a fresh agent on a frozen vault with
    // NO cosign gate — a phished owner could chain `freeze_vault` →
    // `reactivate_vault(attacker, FULL_CAPABILITY)` in one tx and
    // silently install operator capability on a vault that has opted
    // into cosign. Mirrors `register_agent.rs:91-95` and
    // `set_observe_only.rs`. Vaults with the default
    // `cosign_required: false` are unaffected.
    if ctx.accounts.policy.cosign_required {
        let owner_key = ctx.accounts.owner.key();
        let has_cosigner = crate::instructions::register_agent::has_non_owner_signer(
            ctx.remaining_accounts,
            &owner_key,
        );
        require!(has_cosigner, SigilError::ErrCosignRequired);
    }

    let vault = &mut ctx.accounts.vault;

    // 3. Validate mutual presence of new_agent and new_agent_capability
    require!(
        new_agent.is_some() == new_agent_capability.is_some(),
        SigilError::InvalidPermissions
    );

    // 4. Optionally assign new agent
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

    // 5. Guard against soft-lock: cannot activate with no agents
    require!(!vault.agents.is_empty(), SigilError::NoAgentRegistered);

    // 6. Mutate status only after all checks pass
    vault.status = VaultStatus::Active;

    let clock = Clock::get()?;
    let vault_key = vault.key();

    // Round 2 F-RP3-1 fix (audit 2026-05-19): bump policy_version.
    // Permission posture changes when a new agent is grafted onto the
    // vault during reactivate — bumping the version ensures any in-flight
    // validate_and_authorize fails fast with PolicyVersionMismatch
    // (defense in depth) rather than relying on the slower
    // vault.is_agent constraint.
    {
        let policy = &mut ctx.accounts.policy;
        policy.policy_version = policy
            .policy_version
            .checked_add(1)
            .ok_or(error!(SigilError::Overflow))?;
    }

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
