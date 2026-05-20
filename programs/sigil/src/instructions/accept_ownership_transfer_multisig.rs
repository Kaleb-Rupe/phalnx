use anchor_lang::prelude::*;

use crate::errors::SigilError;
use crate::events::OwnershipTransferAccepted;
use crate::state::*;
use crate::utils::audit_log::build_audit_entry;

/// Phase 8 Batch 4 — C26 ownership transfer (accept path, Squads V4 multisig).
///
/// Sibling handler to `accept_ownership_transfer` for the multisig-target flow.
/// When `pending.is_multisig_target == true`, the new owner is a Squads V4
/// multisig **vault PDA** (the signer derived from the multisig account). The
/// transaction containing this ix is built and signed via the Squads program;
/// from Sigil's perspective the multisig PDA is an **opaque non-signer account**
/// — Squads handles the underlying multisig signature aggregation off-chain,
/// then submits a transaction where the multisig PDA appears as a writable
/// (but NOT signer) account in `accept_ownership_transfer_multisig`.
///
/// Authority binding is therefore NOT via Anchor's `Signer<'info>` constraint
/// (which would require an actual signature on the multisig PDA private key —
/// which doesn't exist). Instead, authority is bound by:
///   1. `multisig_pda.owner == SQUADS_V4_PROGRAM_ID` — proves the account was
///      created by the Squads program (only Squads can mint accounts owned by
///      itself). An attacker cannot forge ownership without compromising the
///      Squads program itself.
///   2. `pending.new_owner == multisig_pda.key()` — pubkey identity match
///      against the target queued at initiate time.
///   3. `pending.is_multisig_target == true` — rejects standard-target pendings
///      (symmetric with the EOA accept's `!is_multisig_target` guard).
///
/// On success:
///   * `vault.owner` is overwritten with `multisig_pda.key()`
///   * `pending` PDA closes, rent returns to `multisig_pda` (the new authority)
///   * `policy.policy_version` bumps so any in-flight `validate_and_authorize`
///     fails fast with PolicyVersionMismatch under the new authority
///
/// **Why no Signer.** A Squads V4 multisig vault PDA is a program-derived
/// address with no private key. Squads V4's own `vault_transaction_execute`
/// re-derives the vault PDA at runtime and CPI-invokes the wrapped instruction
/// with the vault PDA passed as an UncheckedAccount, NOT a signer. The
/// multisig-side authority is enforced upstream by Squads (threshold-of-N
/// signatures on the wrapping `vault_transaction`). For Sigil to require an
/// actual signature here would make the multisig flow architecturally
/// impossible.
///
/// **V1 verification depth — Council ISC-A7.** Today we verify program-ID
/// match only. Stronger structural checks (multisig threshold > 0, vault
/// discriminator parse, anti-1-of-1-self-multisig) are V1.1 — V1 ships with
/// the program-ID match because (a) only Squads V4 can create accounts owned
/// by `SQUADS_V4_PROGRAM_ID` and (b) the owner-side `initiate` step is
/// gated by the cosign requirement (Council ISC-129), so a phished owner key
/// alone cannot queue a transfer to a malicious multisig.
///
/// TODO (Batch 6) — re-derive `policy.policy_preview_digest` using the new
/// owner's `agent_set_hash` projection. Same note as the EOA variant: today's
/// digest binds 20 fields none of which are owner-derived, so the apply-time
/// check continues to pass. Batch 6 ships `agent_set_hash` (owner-keyed) and
/// at that point this handler must also recompute the digest before completing.
#[derive(Accounts)]
pub struct AcceptOwnershipTransferMultisig<'info> {
    /// CHECK: Squads V4 multisig vault PDA. NOT a `Signer` because Squads V4
    /// vault PDAs have no private key — authority is enforced by:
    ///   1. `owner == SQUADS_V4_PROGRAM_ID` (verified in handler)
    ///   2. `key() == pending.new_owner` (verified in handler)
    ///   3. `pending.is_multisig_target == true` (verified in handler)
    /// Marked `mut` so the closed `pending` PDA's rent returns here.
    #[account(mut)]
    pub multisig_pda: UncheckedAccount<'info>,

    /// Vault is mutated (owner field overwritten). PDA derivation uses the
    /// immutable `vault.vault_authority` field (LBL-01) so the seed binding
    /// survives ownership transfer. Handler-level `require_keys_eq!(
    /// pending.current_owner, vault.owner)` replaces the implicit seed
    /// binding that previously enforced the queue→accept owner match.
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

    /// PendingOwnershipTransfer PDA. `close = multisig_pda` returns rent to the
    /// new authority. `has_one = vault` binds the PDA to this vault explicitly
    /// (defense-in-depth against future seeds drift; same pattern as §RP-1 I-2).
    #[account(
        mut,
        has_one = vault @ SigilError::ZeroCopyVaultMismatch,
        seeds = [b"pending_owner", vault.key().as_ref()],
        bump = pending.bump,
        close = multisig_pda,
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

pub fn handler(ctx: Context<AcceptOwnershipTransferMultisig>) -> Result<()> {
    crate::reject_cpi!();

    // 1. Authority binding gate A — multisig PDA owner program check.
    //    The supplied multisig PDA MUST be owned by the Squads V4 program;
    //    any other owner (SystemProgram, attacker-deployed program, etc.) is
    //    rejected hard. This is the load-bearing structural check that
    //    distinguishes a real Squads multisig from an attacker-forged account.
    //
    //    `AccountInfo::owner` returns `&Pubkey`; comparison is by reference to
    //    the program-pinned constant. We reuse `ErrInvalidOwnershipTarget`
    //    (6107) — the same code initiate emits when the new_owner pubkey is
    //    in the program/sysvar blocklist — because the semantics are
    //    identical: "the supplied target is not a valid ownership recipient."
    let multisig_info = ctx.accounts.multisig_pda.to_account_info();
    require!(
        multisig_info.owner == &SQUADS_V4_PROGRAM_ID,
        SigilError::ErrInvalidOwnershipTarget,
    );

    // 2. Authority binding gate B — pubkey identity match.
    //    The supplied multisig PDA must be the same pubkey queued at initiate.
    //    Without this check, an attacker could swap in a DIFFERENT
    //    Squads-owned account (e.g. a multisig they control) and accept on
    //    behalf of the owner's queued multisig.
    require_keys_eq!(
        ctx.accounts.multisig_pda.key(),
        ctx.accounts.pending.new_owner,
        SigilError::ErrPendingOwnershipNotReady,
    );

    // 3. Variant binding — reject standard-target pendings on the multisig
    //    handler. Symmetric with the EOA accept's `!is_multisig_target` guard:
    //    without this, an EOA-target pending could be claimed via the multisig
    //    handler by deploying a Squads-owned account at the EOA address (a
    //    practically-impossible address collision but defensible).
    require!(
        ctx.accounts.pending.is_multisig_target,
        SigilError::ErrPendingOwnershipNotReady,
    );

    // 3.5. Phase 8 LBL-01 defense-in-depth — see the EOA accept handler for
    //      the full rationale. The pre-LBL-01 seed pattern
    //      `seeds = [b"vault", pending.current_owner, ...]` implicitly bound
    //      `pending.current_owner == vault.owner`. LBL-01 moves the seed-key
    //      to `vault.vault_authority` (immutable), so this implicit binding
    //      is lost. Reinstate it as an explicit handler check.
    require_keys_eq!(
        ctx.accounts.pending.current_owner,
        ctx.accounts.vault.owner,
        SigilError::ErrPendingOwnershipNotReady,
    );

    let clock = Clock::get()?;

    // 4. Timelock — identical to the EOA accept path. Checked arithmetic
    //    on i64 to guard against backward-moving clocks (rare devnet anomaly).
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

    // Snapshot fields BEFORE we mutate vault.owner.
    let vault_key = ctx.accounts.vault.key();
    let previous_owner = ctx.accounts.vault.owner;
    let multisig_key = ctx.accounts.multisig_pda.key();

    // 5. Mutate vault owner. Same one-and-only-place rule as the EOA path —
    //    every downstream `has_one = owner` re-reads from here.
    {
        let vault = &mut ctx.accounts.vault;
        vault.owner = multisig_key;
    }

    // 6. Bump policy_version — symmetric with the EOA accept handler and the
    //    PEN-CROSS-5 pattern (register/pause/unpause/revoke). Any in-flight
    //    `validate_and_authorize` snapshotted the prior version and will now
    //    fail fast under the new (multisig) authority.
    {
        let policy = &mut ctx.accounts.policy;
        policy.policy_version = policy
            .policy_version
            .checked_add(1)
            .ok_or(error!(SigilError::Overflow))?;
    }

    // 7. Phase 7 — audit-log entry BEFORE `emit!` (ISC-144 ordering). Reuses
    //    disc=8 `AUDIT_DISC_OWNERSHIP_ACCEPT` — distinguishing EOA vs multisig
    //    accepts is the event's `via_multisig` flag, not a separate disc byte.
    //    `subject` slot stores the multisig PDA pubkey so off-chain monitors
    //    get the new authority routing target directly.
    {
        let entry = build_audit_entry(
            AUDIT_DISC_OWNERSHIP_ACCEPT,
            multisig_key,
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
        new_owner: multisig_key,
        via_multisig: true, // Batch 4 multisig variant — distinguishes from EOA accept
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
