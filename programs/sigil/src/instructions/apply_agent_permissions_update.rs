use anchor_lang::accounts::account_loader::AccountLoader;
use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::AgentPermissionsChangeApplied;
use crate::state::*;
use crate::utils::cosign_digest::{
    compute_agent_perms_cosign_digest, AgentPermsCosignDigestFields,
};

#[derive(Accounts)]
pub struct ApplyAgentPermissionsUpdate<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        constraint = vault.owner == owner.key() @ SigilError::UnauthorizedOwner,
        seeds = [b"vault", vault.owner.as_ref(), vault.vault_id.to_le_bytes().as_ref()],
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

    #[account(
        mut,
        constraint = pending_agent_perms.vault == vault.key(),
        seeds = [
            b"pending_agent_perms",
            vault.key().as_ref(),
            pending_agent_perms.agent.as_ref(),
        ],
        bump = pending_agent_perms.bump,
        close = owner,
    )]
    pub pending_agent_perms: Account<'info, PendingAgentPermissionsUpdate>,

    /// Agent spend overlay — per-agent tracking slot.
    #[account(
        mut,
        seeds = [b"agent_spend", vault.key().as_ref(), &[0u8]],
        bump = agent_spend_overlay.load()?.bump,
    )]
    pub agent_spend_overlay: AccountLoader<'info, AgentSpendOverlay>,
}

pub fn handler(ctx: Context<ApplyAgentPermissionsUpdate>) -> Result<()> {
    crate::reject_cpi!();

    let clock = Clock::get()?;
    let pending = &ctx.accounts.pending_agent_perms;

    // Timelock must have expired
    require!(
        pending.is_ready(clock.unix_timestamp),
        SigilError::TimelockNotExpired
    );

    // F-10 audit fix: slot-bounded freshness check defends against durable-nonce
    // pre-signing attacks (Drift Protocol April 2026 $285M analog).
    require!(
        clock.slot.saturating_sub(pending.queued_at_slot) < MAX_APPLY_AGE_SLOTS,
        SigilError::QueuedUpdateExpired,
    );

    let agent = pending.agent;
    let new_capability = pending.new_capability;
    let spending_limit_usd = pending.spending_limit_usd;
    // TA-06 (Phase 3): pull pending cooldown_seconds for slot apply below.
    let pending_cooldown_seconds = pending.cooldown_seconds;
    // Round 2 F-RP3-2 fix (audit 2026-05-19): pull persisted cosign
    // binding for the apply-time digest re-validation below.
    let pending_cosign_session = pending.cosign_session;
    let pending_cosign_digest = pending.cosign_digest;

    // Phase 2 TA-04 (Audit #2 F-4): defense in depth. The pending PDA was
    // validated at queue time, but a rogue program with the same account
    // discriminator could have overwritten the field between queue and apply.
    // Re-assert the bound here so a tampered pending capability cannot
    // become the live capability without a fresh queue.
    require!(
        new_capability <= FULL_CAPABILITY,
        SigilError::InvalidCapability
    );

    // Round 2 F-RP3-2 fix (audit 2026-05-19): re-bind digest check.
    //
    // When the queue persisted a cosign_session != Pubkey::default(), it
    // was bound to a specific (cosign_session, agent, new_capability,
    // spending_limit_usd, cooldown_seconds) tuple. Any tamper of any
    // field between queue and apply (e.g. a future discriminator-collision
    // attack on the pending PDA, or a stale slot replay) would produce a
    // digest mismatch and a hard reject — identical to the apply-pending-
    // policy TA-09 binding.
    //
    // `cosign_session == Pubkey::default()` = non-elevated queue (no
    // cosign was required) — skip the re-bind check.
    if pending_cosign_session != Pubkey::default() {
        let recomputed = compute_agent_perms_cosign_digest(&AgentPermsCosignDigestFields {
            cosign_session: &pending_cosign_session,
            agent: &agent,
            new_capability,
            spending_limit_usd,
            cooldown_seconds: pending_cooldown_seconds,
        });
        require!(
            recomputed == pending_cosign_digest,
            SigilError::ErrCosignRequired
        );
    }

    // Find agent entry and update capability + spending limit
    let vault = &mut ctx.accounts.vault;
    let entry = vault
        .agents
        .iter_mut()
        .find(|a| a.pubkey == agent)
        .ok_or(error!(SigilError::UnauthorizedAgent))?;
    let old_spending_limit = entry.spending_limit_usd;
    entry.capability = new_capability;
    entry.spending_limit_usd = spending_limit_usd;

    // Manage overlay slot when spending limit changes
    // (lifted verbatim from update_agent_permissions.rs:66-81)
    // TA-06 (Phase 3): also apply per-agent cooldown_seconds onto the slot.
    if let Ok(mut overlay) = ctx.accounts.agent_spend_overlay.load_mut() {
        let has_slot = overlay.find_agent_slot(&agent).is_some();

        if spending_limit_usd > 0 && !has_slot {
            // Need a slot but don't have one — claim it
            require!(
                overlay.claim_slot(&agent).is_some(),
                SigilError::OverlaySlotExhausted
            );
        } else if spending_limit_usd == 0 && old_spending_limit > 0 && has_slot {
            // No longer need a slot — release it
            if let Some(idx) = overlay.find_agent_slot(&agent) {
                overlay.release_slot(idx);
            }
        }

        // TA-06 (Phase 3): apply cooldown_seconds onto the agent's slot if
        // present. If the slot was just released above (spending_limit→0),
        // skip cooldown update — there's no slot to write into. The next
        // re-registration / spending_limit-raise will claim a fresh slot
        // with cooldown_seconds = 0 (cleared by `release_slot`).
        if let Some(idx) = overlay.find_agent_slot(&agent) {
            overlay.set_cooldown_seconds(idx, pending_cooldown_seconds)?;
        }
    }

    // Bump policy version — permission changes affect security posture
    let policy = &mut ctx.accounts.policy;
    policy.policy_version = policy
        .policy_version
        .checked_add(1)
        .ok_or(error!(SigilError::Overflow))?;

    emit!(AgentPermissionsChangeApplied {
        vault: vault.key(),
        agent,
        applied_at: clock.unix_timestamp,
    });

    Ok(())
}
