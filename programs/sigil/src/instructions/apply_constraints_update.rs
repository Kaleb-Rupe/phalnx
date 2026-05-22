use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::ConstraintsChangeApplied;
use crate::state::pending_constraints::{
    compute_pending_constraints_digest, ct_eq_32,
};
use crate::state::*;
use crate::utils::audit_log::build_audit_entry;

#[derive(Accounts)]
pub struct ApplyConstraintsUpdate<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        has_one = owner @ SigilError::UnauthorizedOwner,
        seeds = [b"vault", vault.vault_authority.as_ref(), vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, AgentVault>,

    /// PolicyConfig — needed to bump policy_version on constraint changes.
    #[account(
        mut,
        has_one = vault,
        seeds = [b"policy", vault.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, PolicyConfig>,

    #[account(
        mut,
        seeds = [b"constraints", vault.key().as_ref()],
        bump = constraints.load()?.bump,
    )]
    pub constraints: AccountLoader<'info, InstructionConstraints>,

    #[account(
        mut,
        seeds = [b"pending_constraints", vault.key().as_ref()],
        bump = pending_constraints.load()?.bump,
        close = owner,
    )]
    pub pending_constraints: AccountLoader<'info, PendingConstraintsUpdate>,

    /// Phase 7 — success audit log; entry appended after constraints applied.
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

pub fn handler(ctx: Context<ApplyConstraintsUpdate>) -> Result<()> {
    crate::reject_cpi!();

    let clock = Clock::get()?;
    let vault_key = ctx.accounts.vault.key();

    // Read pending: verify vault + timelock + slot freshness + content digest,
    // extract scalar fields.
    let new_entry_count = {
        let pending = ctx.accounts.pending_constraints.load()?;
        require!(
            pending.vault == vault_key.to_bytes(),
            SigilError::InvalidPendingConstraintsPda
        );
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

        // M-4 close (Bucket 2, Phase 10 PEN-CROSS-3): re-assert the
        // pending content digest BEFORE any byte is copied into the live
        // `InstructionConstraints` PDA. The digest was sealed by
        // `queue_constraints_update` over the owner-attested
        // (vault, entry_count, entries[0..entry_count]) tuple; if a
        // future discriminator-collision bug or a same-seed CPI overwrite
        // mutated the entries slab between queue and apply, the
        // recomputed digest diverges and we reject with
        // `ErrPendingConstraintsDigestMismatch`. Constant-time compare
        // via `ct_eq_32` to deny timing side-channels (32-byte hash, ~30
        // CU on BPF — negligible relative to the 1.4M CU budget).
        let recomputed = compute_pending_constraints_digest(&pending)?;
        require!(
            ct_eq_32(&recomputed, &pending.pending_content_digest),
            SigilError::ErrPendingConstraintsDigestMismatch
        );

        pending.entry_count
    };

    // Direct raw byte copy between account data buffers to avoid 35KB stack allocation.
    // Both accounts are zero-copy with identical entries layout at the same offset.
    // entries starts at byte offset 8 (disc) + 32 (vault) = 40 in both structs.
    //
    // NOTE: No re-validation of entries here. Entries were validated during queue_constraints_update.
    // If a program upgrade changes validation rules between queue and apply, previously-queued
    // entries are applied unchanged. This is a known tradeoff in timelocked update systems —
    // the alternative (re-validation on apply) would add ~50K CU and could reject entries that
    // were valid when the owner queued them, breaking the timelock contract.
    {
        let pending_info = ctx.accounts.pending_constraints.to_account_info();
        let constraints_info = ctx.accounts.constraints.to_account_info();
        let pending_data = pending_info.try_borrow_data()?;
        let mut constraints_data = constraints_info.try_borrow_mut_data()?;

        let entries_offset = 8 + 32; // discriminator + vault
        let entries_size = core::mem::size_of::<constraints::ConstraintEntryZC>()
            * constraints::MAX_CONSTRAINT_ENTRIES;

        constraints_data[entries_offset..entries_offset + entries_size]
            .copy_from_slice(&pending_data[entries_offset..entries_offset + entries_size]);
    }

    // Set scalar fields via load_mut
    {
        let mut constraints = ctx.accounts.constraints.load_mut()?;
        require!(
            constraints.vault == vault_key.to_bytes(),
            SigilError::InvalidConstraintsPda
        );
        constraints.entry_count = new_entry_count;
        // CRIT-2: stamp constraint_version on every apply — pending PDA has no version field, and this rescues pre-CRIT-2 PDAs initialized at 0.
        constraints.constraint_version = 1;
    }

    // Bump policy version — constraint changes affect security posture
    let policy = &mut ctx.accounts.policy;
    policy.policy_version = policy
        .policy_version
        .checked_add(1)
        .ok_or(error!(SigilError::Overflow))?;

    // Collect discriminator formats from the freshly-applied entries for the event.
    // Read from constraints (not pending — pending is closed by Anchor after this handler).
    let discriminator_formats = {
        let constraints = ctx.accounts.constraints.load()?;
        let count = constraints.entry_count as usize;
        (0..count)
            .map(|i| constraints.entries[i].discriminator_format)
            .collect::<Vec<u8>>()
    };

    // Phase 7 — write success audit-log entry AFTER constraints + policy
    // version mutated.
    {
        let entry = build_audit_entry(
            AUDIT_DISC_CONSTRAINTS_APPLY,
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

    emit!(ConstraintsChangeApplied {
        vault: vault_key,
        discriminator_formats,
        applied_at: clock.unix_timestamp,
    });

    Ok(())
}
