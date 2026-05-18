use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::ObserveOnlyChanged;
use crate::state::{AgentVault, PolicyConfig};
use crate::utils::policy_digest::{compute_policy_preview_digest, PolicyPreviewFields};

/// F-12 audit fix: direct owner-only flip of `vault.observe_only`.
///
/// observe_only is part of the canonical policy_preview_digest encoding
/// (position 10). Any mutation MUST recompute the stored digest + bump
/// policy_version (OCC) — same invariant enforced by the four sibling
/// handlers covered by `tests/policy-digest-invariant.ts`.
///
/// User-approved Option (a): direct flip, no timelock. observe_only is a
/// low-stakes mutation surface — flipping it only enables/disables vault
/// execution. If owner key is compromised the attacker can do strictly worse
/// via the existing surfaces (freeze, withdraw, queue/apply policy update).
/// Mirrors `freeze_vault`'s simplicity.
///
/// F-11 consistency: cannot flip to active (observe_only=false) when both
/// the protocol and destination allowlists are empty — otherwise the vault
/// would land in a silently inert state. The opposite direction (active →
/// observe_only=true) is always allowed.
#[derive(Accounts)]
pub struct SetObserveOnly<'info> {
    #[account(mut, has_one = owner @ SigilError::UnauthorizedOwner)]
    pub vault: Account<'info, AgentVault>,

    #[account(
        mut,
        has_one = vault,
        seeds = [b"policy", vault.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, PolicyConfig>,

    pub owner: Signer<'info>,
}

pub fn handler(ctx: Context<SetObserveOnly>, new_value: bool) -> Result<()> {
    crate::reject_cpi!();
    let vault = &mut ctx.accounts.vault;
    let policy = &mut ctx.accounts.policy;

    // F-11 consistency: cannot flip to active mode when both allowlists are
    // empty. observe_only=true never trips this check because inert is the
    // intended state for observation vaults.
    if !new_value {
        require!(
            !policy.protocols.is_empty() || !policy.allowed_destinations.is_empty(),
            SigilError::ActiveVaultRequiresAllowlist
        );
    }

    let old_value = vault.observe_only;
    vault.observe_only = new_value;

    // F-2 lesson (TA-19): any mutation of a field included in
    // policy_preview_digest MUST recompute the stored digest + bump
    // policy_version (OCC). observe_only is at position 10 of the canonical
    // digest encoding.
    let recomputed_digest = compute_policy_preview_digest(&PolicyPreviewFields {
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
        // PEN-CROSS-2: created_at_slot is immutable post-init.
        created_at_slot: policy.created_at_slot,
    });
    policy.policy_preview_digest = recomputed_digest;
    policy.policy_version = policy
        .policy_version
        .checked_add(1)
        .ok_or(SigilError::Overflow)?;

    emit!(ObserveOnlyChanged {
        vault: vault.key(),
        old_value,
        new_value,
        new_policy_version: policy.policy_version,
        new_policy_preview_digest: recomputed_digest,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
