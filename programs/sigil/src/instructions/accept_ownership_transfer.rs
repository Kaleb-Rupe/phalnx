use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::OwnershipTransferAccepted;
use crate::state::*;
use crate::utils::audit_log::build_audit_entry;

/// Phase 8 — C26 ownership transfer (accept path, standard EOA).
///
/// The `new_owner` queued by `initiate_ownership_transfer` signs this ix
/// after the timelock window elapses. On success:
///   * `vault.owner` is overwritten with `new_owner.key()`
///   * `pending` PDA closes, rent returns to `new_owner` (the new signer)
///   * `policy.policy_version` bumps so any in-flight `validate_and_authorize`
///     fails fast with PolicyVersionMismatch under the new authority
///
/// Hard-rejects when `pending.is_multisig_target == true` — the multisig
/// variant lives in Batch 4 (`accept_ownership_transfer_multisig`); this
/// handler MUST NOT be used as a back-door for the multisig flow before
/// that ix ships.
///
/// Note: we do NOT use `has_one = owner` on the vault constraint because the
/// signer here is the NEW owner, not the current. Authority is bound via
/// `require_keys_eq!(new_owner.key(), pending.new_owner, ...)` plus the
/// `seeds = [b"vault", vault.vault_authority, ...]` derivation (LBL-01).
///
/// Phase 8 LBL-01: the seed-key is now `vault.vault_authority` (the immutable
/// PDA seed-key set at init), NOT `pending.current_owner`. The handler still
/// performs a defense-in-depth check that `pending.current_owner ==
/// vault.owner` (snapshot below) so the queue→accept binding to the
/// queue-time owner remains explicit — but the PDA address itself is
/// decoupled from owner identity, which is the point of LBL-01.
///
/// TODO (Batch 6) — re-derive `policy.policy_preview_digest` using the new
/// owner's `agent_set_hash` projection. Today the digest binds 20 fields, none
/// of which are owner-pubkey-derived, so the apply-time digest check in
/// `apply_pending_policy` continues to pass without recompute. Batch 6 adds
/// `agent_set_hash` (owner-keyed) and at that point this handler must also
/// recompute the digest before completing — flagging here so the work isn't
/// forgotten.
#[derive(Accounts)]
pub struct AcceptOwnershipTransfer<'info> {
    /// The `new_owner` queued at initiate. Pubkey identity verified in the
    /// handler against `pending.new_owner` (defense-in-depth).
    #[account(mut)]
    pub new_owner: Signer<'info>,

    /// Vault is mutated (owner field overwritten). PDA derivation uses the
    /// immutable `vault.vault_authority` field (LBL-01) — the seed binding
    /// survives the owner mutation that this handler performs, so subsequent
    /// owner-side ix from `new_owner` continue to resolve the same vault
    /// account. Handler-level `require_keys_eq!(pending.current_owner,
    /// vault.owner)` replaces the implicit seed-derivation binding that
    /// previously enforced the queue→accept owner match.
    #[account(
        mut,
        seeds = [b"vault", vault.vault_authority.as_ref(), vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, AgentVault>,

    /// Policy is mutated (policy_version bump). Batch 6 will also recompute
    /// `policy_preview_digest` here — see handler TODO.
    #[account(
        mut,
        seeds = [b"policy", vault.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, PolicyConfig>,

    /// PendingOwnershipTransfer PDA. `close = new_owner` returns rent to the
    /// signer. `has_one = vault` binds the PDA to this vault explicitly
    /// (the seed derivation already enforces this via `vault.key()`, but the
    /// constraint is defense-in-depth against future seeds drift — same
    /// pattern as the §RP-1 I-2 audit-log guard).
    #[account(
        mut,
        has_one = vault @ SigilError::ZeroCopyVaultMismatch,
        seeds = [b"pending_owner", vault.key().as_ref()],
        bump = pending.bump,
        close = new_owner,
    )]
    pub pending: Account<'info, PendingOwnershipTransfer>,

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

pub fn handler(ctx: Context<AcceptOwnershipTransfer>) -> Result<()> {
    crate::reject_cpi!();

    // Defense-in-depth: bind the signer to the queued target exactly. Anchor
    // already enforces `pending.bump` + PDA seeds, but this surfaces the
    // intent at the handler level and gives a precise error code (6104
    // ErrPendingOwnershipNotReady — semantically "not ready for THIS caller").
    require_keys_eq!(
        ctx.accounts.new_owner.key(),
        ctx.accounts.pending.new_owner,
        SigilError::ErrPendingOwnershipNotReady,
    );

    // Phase 8 LBL-01 defense-in-depth — the pre-LBL-01 vault PDA seed
    // `seeds = [b"vault", pending.current_owner, ...]` implicitly bound
    // `pending.current_owner == vault.owner` at the seed-derivation layer
    // (a stale pending from before a hypothetical earlier ownership change
    // would have derived a different vault PDA and failed). LBL-01 moves
    // the seed-key to `vault.vault_authority` (immutable), so this implicit
    // binding is lost. Reinstate it as an explicit handler check so a
    // stale pending (e.g. accidentally re-initialized via a not-yet-
    // discovered queue-bypass path) cannot mismatch the live owner.
    require_keys_eq!(
        ctx.accounts.pending.current_owner,
        ctx.accounts.vault.owner,
        SigilError::ErrPendingOwnershipNotReady,
    );

    // Reject the multisig accept flow on the EOA handler — Batch 4 ships the
    // sibling `accept_ownership_transfer_multisig` for `is_multisig_target ==
    // true`. Without this guard, a multisig-targeted pending could be claimed
    // by a single EOA, defeating the multisig authority binding entirely.
    require!(
        !ctx.accounts.pending.is_multisig_target,
        SigilError::ErrPendingOwnershipNotReady,
    );

    let clock = Clock::get()?;

    // Timelock check — `>=` boundary matches the rest of the program's
    // timelock surface (PendingPolicyUpdate, PendingAgentPermissionsUpdate).
    // Use checked arithmetic on i64 — clock can in principle move backward
    // (rare devnet anomaly) and a wrap-around must not silently pass.
    let queued_at = ctx.accounts.pending.queued_at;
    let min_delay = ctx.accounts.pending.min_delay_seconds as i64;
    let elapsed = clock
        .unix_timestamp
        .checked_sub(queued_at)
        .ok_or(error!(SigilError::Overflow))?;
    require!(
        elapsed >= min_delay,
        SigilError::ErrPendingOwnershipNotReady,
    );

    // Snapshot fields BEFORE we mutate vault.owner — the event payload
    // includes `previous_owner` and the audit subject is the new owner.
    let vault_key = ctx.accounts.vault.key();
    let previous_owner = ctx.accounts.vault.owner;
    let new_owner_key = ctx.accounts.new_owner.key();

    // Mutate vault owner. This is the one-and-only place outside `initialize_vault`
    // that writes `vault.owner` — every downstream `has_one = owner` constraint
    // re-reads from here.
    {
        let vault = &mut ctx.accounts.vault;
        vault.owner = new_owner_key;
    }

    // Bump policy_version — symmetric with register/pause/unpause/revoke
    // PEN-CROSS-5 pattern: ownership change is at least as elevated as any
    // agent-set mutation. Any in-flight `validate_and_authorize` snapshotted
    // the prior `policy_version` and will now fail fast with
    // PolicyVersionMismatch under the new authority.
    {
        let policy = &mut ctx.accounts.policy;
        policy.policy_version = policy
            .policy_version
            .checked_add(1)
            .ok_or(error!(SigilError::Overflow))?;
    }

    // Phase 7 — audit-log entry BEFORE `emit!` (ISC-144 ordering). `subject`
    // slot stores the NEW owner so off-chain monitors get the routing target
    // directly without a second fetch (pending PDA closes on this ix).
    {
        let entry = build_audit_entry(
            AUDIT_DISC_OWNERSHIP_ACCEPT,
            new_owner_key,
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
            SigilError::ZeroCopyVaultMismatch,
        );
        log.append(entry);
    }

    emit!(OwnershipTransferAccepted {
        vault: vault_key,
        previous_owner,
        new_owner: new_owner_key,
        via_multisig: false, // Batch 4 multisig variant sets this true
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
