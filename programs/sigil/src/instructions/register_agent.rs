use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::AgentRegistered;
use crate::state::*;

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner @ SigilError::UnauthorizedOwner,
        seeds = [b"vault", owner.key().as_ref(), vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, AgentVault>,

    /// PEN-CROSS-5 (Phase 4 absorption) — policy is now mutated by
    /// register/revoke/pause/unpause to bump `policy_version` as a
    /// defense-in-depth OCC signal. Existing `vault.is_agent` /
    /// `is_agent_paused` constraints already reject the TOCTOU window;
    /// the version bump lets concurrent validate_and_authorize calls fail
    /// fast with PolicyVersionMismatch instead of relying on the slower
    /// constraint check.
    #[account(
        mut,
        seeds = [b"policy", vault.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, PolicyConfig>,

    /// Agent spend overlay — per-agent tracking slot.
    #[account(
        mut,
        seeds = [b"agent_spend", vault.key().as_ref(), &[0u8]],
        bump = agent_spend_overlay.load()?.bump,
    )]
    pub agent_spend_overlay: AccountLoader<'info, AgentSpendOverlay>,
}

pub fn handler(
    ctx: Context<RegisterAgent>,
    agent: Pubkey,
    capability: u8,
    spending_limit_usd: u64,
) -> Result<()> {
    crate::reject_cpi!();

    let vault = &mut ctx.accounts.vault;

    require!(
        vault.status != VaultStatus::Closed,
        SigilError::VaultAlreadyClosed
    );
    // Phase 2 TA-04: reserved capability values 3..=255 explicitly rejected.
    // Replaces prior silent zero-coerce behaviour in `has_capability`.
    require!(
        capability <= FULL_CAPABILITY,
        SigilError::InvalidCapability
    );
    require!(!vault.is_agent(&agent), SigilError::AgentAlreadyRegistered);
    require!(
        vault.agent_count() < MAX_AGENTS_PER_VAULT,
        SigilError::MaxAgentsReached
    );
    require!(agent != Pubkey::default(), SigilError::InvalidAgentKey);
    require!(agent != vault.owner, SigilError::AgentIsOwner);

    vault.agents.push(AgentEntry {
        pubkey: agent,
        capability,
        // TA-17 (Phase 3): new agent starts with no consecutive failures.
        consecutive_failures: 0,
        _reserved: [0u8; 6],
        spending_limit_usd,
        paused: false,
    });

    // Claim a slot in the overlay for per-agent tracking.
    // Fail-closed: if spending_limit_usd > 0 but no slot available,
    // reject registration to guarantee per-agent limits are enforced.
    if let Ok(mut overlay) = ctx.accounts.agent_spend_overlay.load_mut() {
        if overlay.find_agent_slot(&agent).is_none() {
            match overlay.claim_slot(&agent) {
                Some(_) => {} // slot claimed successfully
                None => {
                    if spending_limit_usd > 0 {
                        // Remove the agent we just pushed — no slot to enforce limit
                        vault.agents.retain(|a| a.pubkey != agent);
                        return Err(error!(SigilError::OverlaySlotExhausted));
                    }
                    // spending_limit_usd == 0: no per-agent limit needed, continue
                }
            }
        }
    }

    // PEN-CROSS-5 (Phase 4 absorption): bump policy_version. Closes the
    // OCC window where an in-flight validate_and_authorize could be
    // sandwiched between an agent's registration and its first action.
    // `vault.is_agent` constraint already rejects mid-flight, but the
    // bump means concurrent validates fail fast with PolicyVersionMismatch
    // instead of pushing into the agent-existence check.
    let policy = &mut ctx.accounts.policy;
    policy.policy_version = policy
        .policy_version
        .checked_add(1)
        .ok_or(error!(SigilError::Overflow))?;

    let clock = Clock::get()?;
    emit!(AgentRegistered {
        vault: vault.key(),
        agent,
        capability,
        spending_limit_usd,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
