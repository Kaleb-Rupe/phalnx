use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::AgentGrantQueued;
use crate::state::*;
use crate::utils::audit_log::build_audit_entry;

/// Phase 8 PEN-CROSS-1 (Council ISC-58..65) — queue an OPERATOR-class agent grant.
///
/// `register_agent` (Batch 6) hard-rejects `capability == CAPABILITY_OPERATOR`.
/// This handler is the ONLY path by which a vault gains a new OPERATOR-class
/// agent, and it requires:
///   (1) `capability >= CAPABILITY_OPERATOR` (mirror image of register_agent reject)
///   (2) `policy.cosign_required == true` → non-owner signer in remaining_accounts
///   (3) `pending_agent_grant` PDA does NOT already exist (Anchor `init` enforced)
///   (4) `agent` not already a registered agent on the vault
///   (5) `vault.status != Closed` and `vault.agent_count() < MAX_AGENTS_PER_VAULT`
///
/// On success: PendingAgentGrant PDA written + audit-log entry (disc=17) +
/// `AgentGrantQueued` event. The agent is NOT yet inserted into `vault.agents`
/// — that happens at `apply_agent_grant` after the timelock elapses.
///
/// Cosign mechanism mirrors `register_agent` Phase 8 interim gate: scan
/// `remaining_accounts` for any non-owner signer. Same predicate
/// (`has_non_owner_signer`) used by `register_agent`, `set_observe_only`,
/// `initiate_ownership_transfer`. Single-signer flow continues for vaults
/// with the default `cosign_required: false`.
#[derive(Accounts)]
pub struct QueueAgentGrant<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        has_one = owner @ SigilError::UnauthorizedOwner,
        seeds = [b"vault", vault.vault_authority.as_ref(), vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, AgentVault>,

    /// PolicyConfig is read-only here — only `cosign_required` is consulted.
    /// PDA seeds derivation [b"policy", vault.key()] is the load-bearing
    /// vault binding; cosmetic `has_one = vault` is unnecessary (§RP-1 V6).
    #[account(
        seeds = [b"policy", vault.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, PolicyConfig>,

    /// PendingAgentGrant PDA. `init` ⇒ duplicate-queue rejects via Anchor's
    /// "account already in use" path (mirrors PendingOwnershipTransfer's
    /// double-init guard).
    #[account(
        init,
        payer = owner,
        space = PendingAgentGrant::SIZE,
        seeds = [b"pending_agent_grant", vault.key().as_ref()],
        bump,
    )]
    pub pending: Account<'info, PendingAgentGrant>,

    /// Phase 7 — success audit log; entry appended after state mutation.
    #[account(
        mut,
        seeds = [b"audit_success", vault.key().as_ref()],
        bump = audit_log_success.load()?.bump,
    )]
    pub audit_log_success: AccountLoader<'info, AuditLogSuccess>,

    /// CHECK: Phase 7 — slot_hashes sysvar; address-pinned.
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::id())]
    pub slot_hashes_sysvar: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<QueueAgentGrant>,
    agent: Pubkey,
    capability: u8,
    spending_limit_usd: u64,
) -> Result<()> {
    crate::reject_cpi!();

    let vault = &ctx.accounts.vault;
    let policy = &ctx.accounts.policy;

    // 1. Vault status — reject closed vaults early.
    require!(
        vault.status != VaultStatus::Closed,
        SigilError::VaultAlreadyClosed
    );

    // 2. Capability validation — this handler is the QUEUE path for
    // OPERATOR-class grants. Reject:
    //   - reserved values (3..=255) — same TA-04 contract as register_agent
    //   - non-OPERATOR (0 = Disabled, 1 = Observer) — those go through the
    //     fast `register_agent` path
    require!(
        capability <= FULL_CAPABILITY,
        SigilError::InvalidCapability
    );
    require!(
        capability >= CAPABILITY_OPERATOR,
        SigilError::InvalidPermissions
    );

    // 3. Agent invariants — mirror register_agent's reject checks so we
    // reject early at queue rather than after timelock elapses.
    require!(agent != Pubkey::default(), SigilError::InvalidAgentKey);
    require!(agent != vault.owner, SigilError::AgentIsOwner);
    require!(!vault.is_agent(&agent), SigilError::AgentAlreadyRegistered);
    require!(
        vault.agent_count() < MAX_AGENTS_PER_VAULT,
        SigilError::MaxAgentsReached
    );

    // 4. Cosign gate (Phase 8 PEN-CROSS-1 interim) — mirrors register_agent's
    // cosign check. The whole POINT of the queue path is that elevated grants
    // require timelock + cosign on cosign-opted-in vaults; without the cosign
    // gate here, a phished owner key could queue then wait the timelock and
    // apply the OPERATOR grant unilaterally.
    if policy.cosign_required {
        let owner_key = ctx.accounts.owner.key();
        let has_cosigner = crate::instructions::register_agent::has_non_owner_signer(
            ctx.remaining_accounts,
            &owner_key,
        );
        require!(has_cosigner, SigilError::ErrCosignRequired);
    }

    // 5. Populate pending PDA.
    let clock = Clock::get()?;
    let vault_key = vault.key();
    {
        let pending = &mut ctx.accounts.pending;
        pending.vault = vault_key;
        pending.agent = agent;
        pending.capability = capability;
        pending.spending_limit_usd = spending_limit_usd;
        pending.queued_at = clock.unix_timestamp;
        pending.min_delay_seconds = MIN_TIMELOCK_DURATION;
        pending.bump = ctx.bumps.pending;
    }

    // 6. Phase 7 — audit-log entry BEFORE `emit!` (ISC-144 ordering). Subject
    // = agent pubkey so off-chain monitors can correlate the queued grant
    // with downstream `apply_agent_grant` (disc=18) entries.
    {
        let entry = build_audit_entry(
            AUDIT_DISC_AGENT_GRANT_QUEUE,
            agent,
            0,
            0,
            clock.unix_timestamp,
            &ctx.accounts.slot_hashes_sysvar.to_account_info(),
        )?;
        let mut log = ctx.accounts.audit_log_success.load_mut()?;
        // §RP-1 I-2: defense-in-depth guard against future seeds drift.
        require_keys_eq!(
            log.vault,
            vault_key,
            SigilError::ZeroCopyVaultMismatch
        );
        log.append(entry);
    }

    let executes_at = clock
        .unix_timestamp
        .checked_add(MIN_TIMELOCK_DURATION as i64)
        .ok_or(error!(SigilError::Overflow))?;

    emit!(AgentGrantQueued {
        vault: vault_key,
        agent,
        capability,
        spending_limit_usd,
        queued_at: clock.unix_timestamp,
        executes_at,
    });

    Ok(())
}
