use anchor_lang::prelude::*;
use anchor_spl::token::{self, Revoke, Token};

use crate::errors::SigilError;
use crate::events::{DelegationRevoked, VaultFrozen};
use crate::state::*;
use crate::utils::audit_log::build_audit_entry;

#[derive(Accounts)]
pub struct FreezeVault<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner @ SigilError::UnauthorizedOwner,
        seeds = [b"vault", owner.key().as_ref(), vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, AgentVault>,

    /// Phase 7 — success audit log; entry appended after status flip.
    #[account(
        mut,
        seeds = [b"audit_success", vault.key().as_ref()],
        bump = audit_log_success.load()?.bump,
    )]
    pub audit_log_success: AccountLoader<'info, AuditLogSuccess>,

    /// CHECK: Phase 7 — slot_hashes sysvar, read for fresh temporal binding.
    /// Address constrained to the canonical sysvar pubkey so a tampered caller
    /// cannot substitute a stale or attacker-controlled account.
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::id())]
    pub slot_hashes_sysvar: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

/// F2-H1 fix: When freezing the vault as a kill switch, revoke active SPL
/// delegations created by `validate_and_authorize` so a rogue agent cannot
/// continue spending against an in-flight session window (8s–11min).
///
/// Caller contract for `remaining_accounts`:
/// - PAIRS of `(session_pda, vault_token_account)` for every active session
///   whose delegation should be terminated.
/// - The handler verifies each `session_pda` derives from `[b"session",
///   vault, agent, token_mint]` using fields read from the account itself,
///   so callers cannot smuggle arbitrary accounts.
/// - Pairs that fail any check (PDA mismatch, wrong vault, not delegated,
///   ATA mismatch) are skipped silently — freeze still succeeds, just no
///   revoke for that pair. This keeps freeze a reliable kill switch even
///   when the dashboard SDK has stale session lists.
/// - Passing zero pairs is allowed (backwards-compat: pre-fix call sites
///   that just want to set status = Frozen still work).
pub fn handler<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, FreezeVault<'info>>,
) -> Result<()> {
    crate::reject_cpi!();

    // Allow freezing only from Active status (matches pre-fix behavior).
    // Already-frozen / closed vaults reject with VaultNotActive — preserves
    // existing test contract and prevents idempotent re-revoke attempts.
    require!(ctx.accounts.vault.is_active(), SigilError::VaultNotActive);

    // Snapshot vault PDA seeds so we can sign Revoke CPIs without holding a
    // borrow on `ctx.accounts.vault` while iterating remaining_accounts.
    let vault_key = ctx.accounts.vault.key();
    let owner_key = ctx.accounts.vault.owner;
    let vault_id_bytes = ctx.accounts.vault.vault_id.to_le_bytes();
    let vault_bump = ctx.accounts.vault.bump;
    let agents_preserved = ctx.accounts.vault.agent_count() as u8;

    let bump_slice = [vault_bump];
    let signer_seeds: [&[u8]; 4] = [
        b"vault",
        owner_key.as_ref(),
        vault_id_bytes.as_ref(),
        bump_slice.as_ref(),
    ];
    let binding = [signer_seeds.as_slice()];

    let clock = Clock::get()?;
    let mut sessions_revoked: u32 = 0;

    // Walk pairs of (session_pda, vault_token_account) from remaining_accounts.
    // Skip the trailing odd account if caller passed an unpaired entry.
    let mut idx = 0usize;
    while idx + 1 < ctx.remaining_accounts.len() {
        let session_info = &ctx.remaining_accounts[idx];
        let token_info = &ctx.remaining_accounts[idx + 1];
        idx += 2;

        // 1. Session account must be owned by this program. Anything else
        //    (system-owned, junk PDAs, attacker-owned scratch) is skipped.
        if session_info.owner != &crate::ID {
            continue;
        }

        // 2. Deserialize session. Anchor's `try_deserialize` validates the
        //    8-byte discriminator, so non-Session accounts owned by us
        //    (vault, policy, etc.) are rejected here.
        let data = match session_info.try_borrow_data() {
            Ok(d) => d,
            Err(_) => continue,
        };
        let mut data_slice: &[u8] = &data;
        let session = match SessionAuthority::try_deserialize(&mut data_slice) {
            Ok(s) => s,
            Err(_) => continue,
        };

        // 3. Session must belong to THIS vault. Cross-vault session accounts
        //    are skipped — owner of vault A cannot revoke vault B sessions.
        if session.vault != vault_key {
            continue;
        }

        // 4. Verify session_info matches the expected PDA derivation
        //    (defense-in-depth — owner check + vault check above already
        //    bind the account, but explicit derivation rules out substitution
        //    via a malformed but program-owned account).
        let expected_session_pda = match Pubkey::create_program_address(
            &[
                b"session",
                vault_key.as_ref(),
                session.agent.as_ref(),
                session.authorized_token.as_ref(),
                &[session.bump],
            ],
            &crate::ID,
        ) {
            Ok(pk) => pk,
            Err(_) => continue,
        };
        if session_info.key() != expected_session_pda {
            continue;
        }

        // 5. Only delegated sessions need revoke. Non-spending sessions
        //    (delegated == false) and sessions without authorization are no-ops.
        if !session.delegated || !session.authorized {
            continue;
        }

        // 6. Verify the vault_token_account paired with this session is the
        //    same one approve()d in validate_and_authorize. Without this check
        //    the caller could pair a wrong token account, leaving the real
        //    delegation intact. The session stores the exact account that
        //    received the SPL approve.
        if token_info.key() != session.delegation_token_account {
            continue;
        }

        // 7. Sanity-check the token account is owned by SPL Token program.
        //    Stops attempts to pass a fake-shape account that would crash CPI.
        if token_info.owner != &token::ID {
            continue;
        }

        // 8. Revoke the SPL delegation. The vault PDA signs because it is
        //    the token account authority (set in deposit_funds via ATA derivation).
        let cpi_accounts = Revoke {
            source: token_info.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &binding,
        );
        // Drop the data borrow before the CPI in case the runtime reloads accounts.
        drop(data);
        token::revoke(cpi_ctx)?;

        emit!(DelegationRevoked {
            vault: vault_key,
            token_account: token_info.key(),
            timestamp: clock.unix_timestamp,
        });

        sessions_revoked = sessions_revoked.saturating_add(1);
    }

    // Flip status LAST — by the time the kill switch lands, all surfaced
    // delegations are dead and any leftover sessions can no longer pass
    // `validate_and_authorize` (it requires `vault.is_active()`).
    let vault = &mut ctx.accounts.vault;
    vault.status = VaultStatus::Frozen;

    // Phase 7 — write success audit-log entry AFTER state mutation completes.
    // M-3 ordering: persist on-chain before emit!() so event log and on-chain
    // state stay aligned even if a downstream regression breaks the emit.
    {
        let entry = build_audit_entry(
            AUDIT_DISC_FREEZE,
            vault_key,
            0,
            0,
            clock.unix_timestamp,
            &ctx.accounts.slot_hashes_sysvar.to_account_info(),
        )?;
        let mut log = ctx.accounts.audit_log_success.load_mut()?;
        log.append(entry);
    }

    emit!(VaultFrozen {
        vault: vault_key,
        owner: ctx.accounts.owner.key(),
        agents_preserved,
        sessions_revoked,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
