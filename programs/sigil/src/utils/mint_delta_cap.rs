//! Phase 6 R-1 MintDeltaCap support helpers.
//!
//! Two entry shapes:
//!
//! - `scope=0` (vault-wide): sum the SPL Token classic ATA plus the
//!   Token-2022 ATA for `(vault, mint)`. Up to `MAX_ATAS_PER_MINT` PDAs are
//!   enumerated; missing-on-chain accounts contribute 0. This is the
//!   protocol-agnostic ceiling: a single (vault, mint) pair has at most one
//!   canonical ATA per token program, so today's realistic max is 2 (SPL
//!   classic + Token-2022). The extra slots are reserved for future SIMD
//!   ATA programs.
//!
//! - `scope=1` (single account): read the entry's `target_account` directly.
//!   The caller is responsible for declaring which token account they want
//!   measured (typical pattern: a non-ATA program-owned vault account).
//!
//! Token-2022 accounts may carry extension data after byte 165, but the
//! canonical fields (mint, owner, amount) live at the same offsets as SPL
//! classic: 0..32, 32..64, 64..72. We read those slices directly rather than
//! calling `Account::unpack`, which would fail on Token-2022 extension-bearing
//! accounts. The raw read keeps R-1 protocol-agnostic across both token
//! programs.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::account_info::AccountInfo;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;

use crate::errors::SigilError;
use crate::state::post_assertions::MAX_ATAS_PER_MINT;
use crate::state::TOKEN_2022_PROGRAM_ID;

/// SPL classic Token program — bound at compile time via anchor_spl re-export.
fn spl_token_id() -> Pubkey {
    anchor_spl::token::ID
}

/// Derive every plausible vault-owned ATA for `(vault, mint)` across the
/// known token programs. Returns at most `MAX_ATAS_PER_MINT` PDAs.
///
/// Order is deterministic — SPL classic first, then Token-2022 — so the same
/// (vault, mint) pair always produces the same enumeration regardless of
/// caller. Off-chain decoders depend on the order for replaying the snapshot
/// sum from the post-execution state.
pub fn derive_vault_atas(vault: &Pubkey, mint: &Pubkey) -> Vec<Pubkey> {
    let mut atas = Vec::with_capacity(MAX_ATAS_PER_MINT);
    // 1. SPL classic.
    atas.push(get_associated_token_address_with_program_id(
        vault,
        mint,
        &spl_token_id(),
    ));
    // 2. Token-2022.
    atas.push(get_associated_token_address_with_program_id(
        vault,
        mint,
        &TOKEN_2022_PROGRAM_ID,
    ));
    // Slots 2..MAX_ATAS_PER_MINT are reserved for future ATA programs but
    // not derived today — adding them would silently lower CU headroom
    // without coverage. The cap is the upper bound, not the floor.
    atas
}

/// Read the canonical SPL/Token-2022 amount field (bytes 64..72, u64 LE) from
/// an account. Returns `None` if the account isn't owned by a known token
/// program OR if the data buffer is too short to hold the fixed prefix.
///
/// **Why not unpack:** Token-2022 accounts carry TLV extension data after the
/// fixed 165-byte base layout. `spl_token::state::Account::unpack` will
/// reject a Token-2022 extension-bearing account because its packed length
/// doesn't equal 165. Reading the raw bytes at the prefix offsets is the
/// protocol-agnostic move — the layout has been stable since SPL Token v1.
fn read_token_amount(info: &AccountInfo) -> Option<u64> {
    if info.owner != &spl_token_id() && info.owner != &TOKEN_2022_PROGRAM_ID {
        return None;
    }
    let data = info.try_borrow_data().ok()?;
    if data.len() < 72 {
        return None;
    }
    let mut amount_bytes = [0u8; 8];
    amount_bytes.copy_from_slice(&data[64..72]);
    Some(u64::from_le_bytes(amount_bytes))
}

/// Read the owner field (bytes 32..64) of a token account.
fn read_token_owner(info: &AccountInfo) -> Option<Pubkey> {
    if info.owner != &spl_token_id() && info.owner != &TOKEN_2022_PROGRAM_ID {
        return None;
    }
    let data = info.try_borrow_data().ok()?;
    if data.len() < 64 {
        return None;
    }
    let mut owner_bytes = [0u8; 32];
    owner_bytes.copy_from_slice(&data[32..64]);
    Some(Pubkey::new_from_array(owner_bytes))
}

/// Read the mint field (bytes 0..32) of a token account.
fn read_token_mint(info: &AccountInfo) -> Option<Pubkey> {
    if info.owner != &spl_token_id() && info.owner != &TOKEN_2022_PROGRAM_ID {
        return None;
    }
    let data = info.try_borrow_data().ok()?;
    if data.len() < 32 {
        return None;
    }
    let mut mint_bytes = [0u8; 32];
    mint_bytes.copy_from_slice(&data[0..32]);
    Some(Pubkey::new_from_array(mint_bytes))
}

/// Sum the balances of vault-owned ATAs for `mint` (scope=0) OR a single
/// declared account (scope=1).
///
/// **scope=0 semantic:** iterate the derived ATA list; for each derived PDA
/// that the caller has actually included in `remaining_accounts`, validate
/// (a) the account is owned by a known token program, (b) the deserialized
/// mint matches, (c) the deserialized owner is the vault, then add its
/// balance. Missing derived ATAs contribute 0 — this is the legitimate case
/// where the vault has no balance in that token program.
///
/// **scope=1 semantic:** require `target_account` to be in
/// `remaining_accounts`; validate ownership = vault AND mint matches; return
/// its balance. Any mismatch errors with `MintDeltaCapMisconfigured` so the
/// caller can correct the entry rather than silently passing a 0-balance.
///
/// **CU bound:** `MAX_ATAS_PER_MINT` (5) PDA derivations + per-derivation
/// linear scan over `remaining_accounts`. Phase 6 sets the cap so worst-case
/// CU stays inside the existing finalize budget.
pub fn sum_vault_mint_balance<'info>(
    vault: &Pubkey,
    mint: &Pubkey,
    scope: u8,
    target_account: &Pubkey,
    remaining: &[AccountInfo<'info>],
) -> Result<u64> {
    match scope {
        0 => {
            let derived = derive_vault_atas(vault, mint);
            let mut sum: u64 = 0;
            for pda in derived.iter().take(MAX_ATAS_PER_MINT) {
                // The caller passes any subset of derived ATAs in
                // remaining_accounts. If a derived ATA isn't present, treat
                // its balance as 0 (the vault doesn't hold that variant).
                let Some(info) = remaining.iter().find(|a| a.key() == *pda) else {
                    continue;
                };
                // Defensive: must be token-program-owned AND match the
                // (vault, mint) pair. If a caller injects a same-pubkey
                // attacker-owned account at this slot, the owner check
                // rejects.
                let Some(acct_mint) = read_token_mint(info) else {
                    continue;
                };
                if acct_mint != *mint {
                    // Account exists at the derived PDA but mint diverges —
                    // either uninitialized or attacker-funded. Skip.
                    continue;
                }
                let Some(acct_owner) = read_token_owner(info) else {
                    continue;
                };
                if acct_owner != *vault {
                    // Same PDA pubkey, different owner field — close+recreate
                    // attempt. AtaAuthorityPin (R-2) catches this at finalize
                    // time; here in the validate snapshot phase we simply
                    // skip the malformed account.
                    continue;
                }
                let Some(amount) = read_token_amount(info) else {
                    continue;
                };
                sum = sum
                    .checked_add(amount)
                    .ok_or(SigilError::Overflow)?;
            }
            Ok(sum)
        }
        1 => {
            // Single account: require the entry's target_account to be
            // present + vault-owned + mint matches.
            let info = remaining
                .iter()
                .find(|a| a.key() == *target_account)
                .ok_or(error!(SigilError::MintDeltaCapMisconfigured))?;
            let acct_mint =
                read_token_mint(info).ok_or(error!(SigilError::MintDeltaCapMisconfigured))?;
            require!(acct_mint == *mint, SigilError::MintDeltaCapMisconfigured);
            let acct_owner =
                read_token_owner(info).ok_or(error!(SigilError::MintDeltaCapMisconfigured))?;
            require!(acct_owner == *vault, SigilError::MintDeltaCapMisconfigured);
            let amount =
                read_token_amount(info).ok_or(error!(SigilError::MintDeltaCapMisconfigured))?;
            Ok(amount)
        }
        // validate_entries already rejects scope > 1, but defense-in-depth.
        _ => Err(error!(SigilError::MintDeltaCapMisconfigured)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Derivation is deterministic across calls — the ATA list never changes
    /// for a given (vault, mint) pair within a program version.
    #[test]
    fn derive_vault_atas_is_deterministic() {
        let vault = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let a = derive_vault_atas(&vault, &mint);
        let b = derive_vault_atas(&vault, &mint);
        assert_eq!(a, b);
        assert_eq!(a.len(), 2); // SPL classic + Token-2022
    }

    /// SPL classic ATA is always at index 0 — off-chain decoders depend on
    /// the slot ordering for snapshot replay.
    #[test]
    fn derive_vault_atas_classic_first() {
        let vault = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let atas = derive_vault_atas(&vault, &mint);
        let expected_classic =
            get_associated_token_address_with_program_id(&vault, &mint, &spl_token_id());
        assert_eq!(atas[0], expected_classic);
    }

    /// Different mints produce different ATAs.
    #[test]
    fn derive_vault_atas_changes_with_mint() {
        let vault = Pubkey::new_unique();
        let mint_a = Pubkey::new_unique();
        let mint_b = Pubkey::new_unique();
        assert_ne!(
            derive_vault_atas(&vault, &mint_a)[0],
            derive_vault_atas(&vault, &mint_b)[0]
        );
    }

    /// MAX_ATAS_PER_MINT bound holds — derivation never exceeds it.
    #[test]
    fn derive_vault_atas_respects_cap() {
        let vault = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        assert!(derive_vault_atas(&vault, &mint).len() <= MAX_ATAS_PER_MINT);
    }
}
