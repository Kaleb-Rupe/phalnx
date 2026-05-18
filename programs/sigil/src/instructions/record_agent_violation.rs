//! TA-17 (Phase 3 pre-execution guard #7): record a policy-violation
//! failure for an agent, auto-revoking on threshold trip.
//!
//! ## Why this is a separate instruction
//!
//! Solana's atomic-or-none execution model means a transaction that
//! errors mid-validate rolls back all state mutations. So an agent that
//! attempts a seal and fails due to a policy gate (e.g. cooldown,
//! operating-hours, mint pin) cannot increment its own failure counter
//! in the same transaction — the counter mutation would be reverted
//! alongside the failure.
//!
//! This ix is the explicit reporting path. The agent's middleware (or
//! the vault owner's off-chain monitor) calls it after observing a
//! failed seal. The reported code is range-filtered to ensure only
//! genuine policy-violation rejects (6083-6100) count — external
//! causes (CU exhaustion, network, auth errors) do NOT increment.
//!
//! Successful validate_and_authorize on the same agent RESETS the
//! counter to 0 (cf. validate_and_authorize.rs trailing block) — so
//! transient failures don't accumulate forever; only sustained
//! misbehavior trips the threshold.
//!
//! ## Auth
//!
//! Owner-only. The agent cannot self-report (would be trivially
//! circumventable: an attacker controlling the agent never reports its
//! own violations). The owner OR an owner-designated indexer reports.
//!
//! ## Threshold trip
//!
//! When `agent.consecutive_failures >= policy.auto_revoke_threshold`,
//! the handler:
//!   1. Sets `agent.capability = CAPABILITY_DISABLED`.
//!   2. Emits `AgentAutoRevoked` event.
//!   3. Bumps `policy.policy_version` (OCC).
//! Subsequent validate_and_authorize calls reject with
//! `ErrAutoRevoked` (6090).

use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::AgentAutoRevoked;
use crate::state::*;

#[derive(Accounts)]
#[instruction(agent: Pubkey)]
pub struct RecordAgentViolation<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
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
}

pub fn handler(
    ctx: Context<RecordAgentViolation>,
    agent: Pubkey,
    error_code: u32,
) -> Result<()> {
    crate::reject_cpi!();

    let vault = &mut ctx.accounts.vault;
    require!(
        vault.status != VaultStatus::Closed,
        SigilError::VaultAlreadyClosed
    );

    // Filter the reported code by NUMERIC RANGE — string match would be
    // brittle. 6083-6100 = on-chain policy-violation codes (TA-03/05/06/
    // 07/08/09/17 + reserved for Phase 4+5 post-exec). External codes
    // (CU exhaustion 6047, async-fulfillment 6048, auth 6000-6082) do
    // NOT count.
    require!(
        is_policy_violation_code(error_code),
        SigilError::InvalidPermissions
    );

    let threshold = ctx.accounts.policy.auto_revoke_threshold;
    require!(
        (AUTO_REVOKE_THRESHOLD_MIN..=AUTO_REVOKE_THRESHOLD_MAX).contains(&threshold),
        SigilError::InvalidPermissions
    );

    // Capture vault key BEFORE taking &mut on agents (avoids re-borrow).
    let vault_key = vault.key();

    let entry = vault
        .agents
        .iter_mut()
        .find(|a| a.pubkey == agent)
        .ok_or(error!(SigilError::UnauthorizedAgent))?;

    // Increment with checked arithmetic — saturate at u8::MAX rather
    // than wrap; the threshold trip happens far below saturation anyway.
    entry.consecutive_failures = entry.consecutive_failures.saturating_add(1);

    // Threshold trip → auto-revoke.
    let tripped = entry.consecutive_failures >= threshold;
    let failures_at_trip = entry.consecutive_failures;
    if tripped {
        entry.capability = CAPABILITY_DISABLED;
    }

    if tripped {
        let policy = &mut ctx.accounts.policy;
        // OCC: bump policy_version so external monitors see the change.
        policy.policy_version = policy
            .policy_version
            .checked_add(1)
            .ok_or(error!(SigilError::Overflow))?;

        let clock = Clock::get()?;
        emit!(AgentAutoRevoked {
            vault: vault_key,
            agent,
            threshold,
            consecutive_failures: failures_at_trip,
            timestamp: clock.unix_timestamp,
        });
    }

    Ok(())
}
