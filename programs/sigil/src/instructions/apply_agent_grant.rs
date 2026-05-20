use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::AgentGrantApplied;
use crate::state::*;
use crate::utils::audit_log::build_audit_entry;
use crate::utils::policy_digest::{
    compute_agent_set_hash, compute_policy_preview_digest, PolicyPreviewFields,
};

/// Phase 8 PEN-CROSS-1 (Council ISC-58..65) — apply a queued OPERATOR-class grant.
///
/// After `queue_agent_grant` populated the `PendingAgentGrant` PDA and the
/// timelock window (`min_delay_seconds`, default = `MIN_TIMELOCK_DURATION = 1800s`)
/// has elapsed, the owner calls this handler to land the grant. The handler:
///   1. Asserts `now - queued_at >= min_delay_seconds` (timelock check).
///   2. Re-validates the agent invariants (in case `vault.agents` mutated
///      between queue and apply — e.g. another agent registered, push the
///      count up).
///   3. Pushes the new agent into `vault.agents` AND claims an
///      AgentSpendOverlay slot when `spending_limit_usd > 0`.
///   4. Re-derives the policy preview digest with the NEW `agent_set_hash`
///      (PEN-CROSS-1 binding) and persists it.
///   5. Bumps `policy.policy_version` (mirrors register_agent OCC pattern).
///   6. Writes audit-log entry (disc=18) + emits `AgentGrantApplied` event.
///   7. Closes the pending PDA, returning rent to the owner.
///
/// Cosign is NOT re-checked at apply: the queue-time cosign gate is the
/// authoritative attestation. The apply path is timelock-protected; if a
/// phished key tried to apply, the owner's `cancel_agent_permissions_update`-
/// analog (TODO: add `cancel_agent_grant` in a follow-up batch) would
/// abort. For Batch 6, the timelock + audit-log signal is the V1 mechanism.
#[derive(Accounts)]
pub struct ApplyAgentGrant<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner @ SigilError::UnauthorizedOwner,
        seeds = [b"vault", owner.key().as_ref(), vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, AgentVault>,

    /// Policy is mutated (policy_version bump + policy_preview_digest recompute).
    #[account(
        mut,
        seeds = [b"policy", vault.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, PolicyConfig>,

    /// PendingAgentGrant PDA. `close = owner` returns rent to the signer
    /// (mirrors register_agent rent payer). `has_one = vault` binds the PDA
    /// to this vault explicitly (defense-in-depth alongside seed derivation).
    #[account(
        mut,
        has_one = vault @ SigilError::ZeroCopyVaultMismatch,
        seeds = [b"pending_agent_grant", vault.key().as_ref()],
        bump = pending.bump,
        close = owner,
    )]
    pub pending: Account<'info, PendingAgentGrant>,

    /// Agent spend overlay — per-agent tracking slot. Same seeds as
    /// register_agent so the apply path lands in the same overlay.
    #[account(
        mut,
        seeds = [b"agent_spend", vault.key().as_ref(), &[0u8]],
        bump = agent_spend_overlay.load()?.bump,
    )]
    pub agent_spend_overlay: AccountLoader<'info, AgentSpendOverlay>,

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
}

pub fn handler(ctx: Context<ApplyAgentGrant>) -> Result<()> {
    crate::reject_cpi!();

    let clock = Clock::get()?;
    let pending = &ctx.accounts.pending;

    // 1. Timelock check — `>=` boundary matches the rest of the program's
    // timelock surface (PendingPolicyUpdate, PendingAgentPermissionsUpdate,
    // PendingOwnershipTransfer). Checked i64 sub guards against rare devnet
    // clock-backward anomalies.
    let elapsed = clock
        .unix_timestamp
        .checked_sub(pending.queued_at)
        .ok_or(error!(SigilError::Overflow))?;
    require!(
        elapsed >= pending.min_delay_seconds as i64,
        SigilError::TimelockNotExpired,
    );

    // Snapshot pending fields BEFORE the mutate so the audit-log entry +
    // event payload have the queue-time values even after pending closes.
    let agent = pending.agent;
    let capability = pending.capability;
    let spending_limit_usd = pending.spending_limit_usd;
    let queued_at = pending.queued_at;

    let vault_key = ctx.accounts.vault.key();

    // 2. Re-validate agent invariants at apply (defense-in-depth — vault.agents
    // may have changed between queue and apply via register_agent/revoke_agent).
    let vault = &mut ctx.accounts.vault;
    require!(
        vault.status != VaultStatus::Closed,
        SigilError::VaultAlreadyClosed
    );
    require!(!vault.is_agent(&agent), SigilError::AgentAlreadyRegistered);
    require!(
        vault.agent_count() < MAX_AGENTS_PER_VAULT,
        SigilError::MaxAgentsReached
    );
    // Re-assert capability bound — pending PDA tamper between queue & apply
    // would land here even if the queue value was valid. Forward-secure.
    require!(
        capability >= CAPABILITY_OPERATOR && capability <= FULL_CAPABILITY,
        SigilError::InvalidPermissions
    );

    // 3. Push into vault.agents — same shape as register_agent.
    vault.agents.push(AgentEntry {
        pubkey: agent,
        capability,
        // TA-17 (Phase 3): new agent starts with no consecutive failures.
        consecutive_failures: 0,
        _reserved: [0u8; 6],
        spending_limit_usd,
        paused: false,
    });

    // 4. Claim an overlay slot. Fail-closed: if spending_limit_usd > 0 but
    // no slot available, REJECT the apply (cannot enforce the per-agent
    // limit). Mirrors register_agent's contract.
    if let Ok(mut overlay) = ctx.accounts.agent_spend_overlay.load_mut() {
        if overlay.find_agent_slot(&agent).is_none() {
            match overlay.claim_slot(&agent) {
                Some(_) => {}
                None => {
                    if spending_limit_usd > 0 {
                        // Pop the agent we just pushed — symmetric with
                        // register_agent.rs:135 retain().
                        vault.agents.retain(|a| a.pubkey != agent);
                        return Err(error!(SigilError::OverlaySlotExhausted));
                    }
                }
            }
        }
    }

    // 5. Re-derive policy_preview_digest with the NEW agent_set_hash and
    // persist. The owner-signed digest at vault creation (or last queue/
    // apply policy update) bound the THEN-current agent set; after this
    // mutation it diverges, so future apply_pending_policy / sibling
    // handler digest checks would reject — UNLESS we update the stored
    // digest here too. Bump policy_version OCC counter to match.
    let policy = &mut ctx.accounts.policy;
    let new_agent_set_hash = compute_agent_set_hash(&vault.agents);
    let new_digest = compute_policy_preview_digest(&PolicyPreviewFields {
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
        observe_only: vault.observe_only,
        has_constraints: policy.has_constraints,
        has_post_assertions: policy.has_post_assertions,
        created_at_slot: policy.created_at_slot,
        operating_hours: policy.operating_hours,
        auto_promote_grays: policy.auto_promote_grays,
        auto_revoke_threshold: policy.auto_revoke_threshold,
        stable_balance_floor: policy.stable_balance_floor,
        per_recipient_daily_cap_usd: policy.per_recipient_daily_cap_usd,
        cosign_required: policy.cosign_required,
        agent_set_hash: new_agent_set_hash,
    });
    policy.policy_preview_digest = new_digest;
    policy.policy_version = policy
        .policy_version
        .checked_add(1)
        .ok_or(error!(SigilError::Overflow))?;

    // 6. Phase 7 — audit-log entry BEFORE `emit!` (ISC-144 ordering).
    // Subject = agent pubkey for off-chain correlation with the
    // earlier queue_agent_grant (disc=17) entry.
    {
        let entry = build_audit_entry(
            AUDIT_DISC_AGENT_GRANT_APPLY,
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

    emit!(AgentGrantApplied {
        vault: vault_key,
        agent,
        capability,
        spending_limit_usd,
        queued_at,
        applied_at: clock.unix_timestamp,
        new_policy_version: policy.policy_version,
    });

    Ok(())
}
