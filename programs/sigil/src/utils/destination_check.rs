//! Phase 2 TA-02: wire `PolicyConfig.allowed_destinations` enforcement into
//! spending paths (`validate_and_authorize`), not just `agent_transfer`.
//!
//! Pre-Phase-2 state: `allowed_destinations` was only enforced in
//! `agent_transfer.rs`. The DeFi spending paths (stablecoin-input swap and
//! non-stablecoin-input swap) could route value to ANY ATA whose owner was
//! not in the allowlist as long as the protocol allowlist passed — a known
//! gap surfaced by Audit #2.
//!
//! Phase 2 closes the gap by extracting destination ATAs from the DeFi
//! instruction's account metas and verifying their owners against the policy.
//!
//! ## Scope (intentionally narrow for V1)
//!
//! The helper checks accounts that are **token accounts owned by the SPL Token
//! program (or Token-2022) AND writable AND non-vault**. The vault's own ATAs
//! are not "destinations" — value flowing out of the vault is the spend; value
//! flowing back in is verified by the stablecoin-balance-delta check in
//! `finalize_session`. The helper is called only when `is_spending` is true.
//!
//! ## Performance
//!
//! O(N · M) where N is the number of account metas (bounded by the Solana
//! per-tx limit, ~64) and M is `MAX_ALLOWED_DESTINATIONS` (10). For real
//! DeFi instructions N is typically 5-25, M is 1-3 → ~50-75 comparisons
//! per call. Well below 1k CU.
//!
//! ## Defense layering
//!
//! `is_destination_allowed` on `PolicyConfig` is the actual allowlist
//! check; this helper is the **discoverer** that finds which accounts need
//! to be checked. Both must be present for end-to-end enforcement.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_spl::token::TokenAccount;

use crate::errors::SigilError;
use crate::state::{PolicyConfig, TOKEN_2022_PROGRAM_ID};

/// Walks the DeFi instruction's account metas, finds writable token-account
/// recipients that are NOT the vault's own ATA, and verifies each recipient's
/// owner against `policy.allowed_destinations`.
///
/// Returns `Ok(())` if every candidate destination passes the allowlist (or if
/// no candidate destinations are present — uncommon but possible in pure
/// observe-style DeFi calls). Returns `Err(DestinationNotAllowed)` on the
/// first mismatch.
///
/// # Arguments
///
/// * `ix_accounts` — the DeFi instruction's `Vec<AccountMeta>` (from the
///   `Instruction` extracted via `load_instruction_at_checked`).
/// * `remaining_accounts` — the full slice from `ctx.remaining_accounts`. We
///   need this to read each candidate account's `owner` field (token-account
///   owner = wallet that owns the token account, NOT the SPL Token program).
/// * `vault_pubkey` — the vault PDA; vault-owned ATAs are excluded from the
///   check (those are the spend source, not a destination).
/// * `policy` — the live `PolicyConfig` used to check `allowed_destinations`.
///
/// # Why pre-borrow remaining_accounts?
///
/// We can't deserialize a `TokenAccount` from a raw byte slice without owning
/// the data borrow for the lifetime of the unpack. So the caller holds the
/// borrowed data and passes the unpacked owner. We resolve via Anchor's
/// `TokenAccount::try_deserialize` shortcut.
///
/// # Token-2022 awareness
///
/// We accept both `spl_token::ID` and `TOKEN_2022_PROGRAM_ID` as token-account
/// owners. Token-2022 accounts have a longer layout (extensions), but the
/// `owner` field is in the same byte position, so `TokenAccount::try_deserialize`
/// works for the read.
pub fn enforce_destination_allowlist<'info>(
    ix_accounts: &[AccountMeta],
    remaining_accounts: &[AccountInfo<'info>],
    vault_pubkey: &Pubkey,
    policy: &PolicyConfig,
) -> Result<()> {
    for meta in ix_accounts.iter() {
        if !meta.is_writable {
            // Read-only accounts cannot receive value; skip.
            continue;
        }
        if &meta.pubkey == vault_pubkey {
            // Vault PDA itself is never a destination — it's the authority.
            continue;
        }

        // Locate the AccountInfo for this meta in remaining_accounts.
        // Solana puts the *target* program's accounts in remaining_accounts
        // when the instruction is built via the sysvar-introspected path.
        let info = match remaining_accounts.iter().find(|ai| ai.key == &meta.pubkey) {
            Some(info) => info,
            // If the account isn't passed in remaining_accounts, we can't read
            // it. That's expected for non-token writable accounts (e.g. program
            // PDAs of the target protocol — those don't receive token value).
            // Skip rather than reject; the protocol allowlist + token-balance
            // sandwich is the load-bearing defense for those.
            None => continue,
        };

        // Filter to token-account owners only (SPL Token or Token-2022).
        // Other writable program-owned accounts (PDAs, etc.) aren't token
        // recipients and don't need destination-allowlist gating.
        let owner_program = info.owner;
        if *owner_program != anchor_spl::token::ID && *owner_program != TOKEN_2022_PROGRAM_ID {
            continue;
        }

        // Now read the token account's owner (= the wallet/PDA that controls
        // the tokens in this ATA). We need a fresh deserialize because the
        // caller hasn't unpacked this account.
        let data = info.try_borrow_data()?;
        let token_acct = TokenAccount::try_deserialize(&mut data.as_ref())?;
        let recipient_wallet = token_acct.owner;

        // Skip the vault's own ATAs (recipient_wallet == vault PDA). The vault's
        // ATAs carry tokens IN and OUT during the swap — the OUT direction is
        // the spend (already capped) and the IN direction is verified by
        // finalize_session's balance-delta check.
        if recipient_wallet == *vault_pubkey {
            continue;
        }

        // Allowlist check. Fail-closed: a single mismatched destination rejects
        // the whole bundle.
        require!(
            policy.is_destination_allowed(&recipient_wallet),
            SigilError::DestinationNotAllowed,
        );
    }

    Ok(())
}
