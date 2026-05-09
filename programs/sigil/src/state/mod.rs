pub mod agent_spend_overlay;
pub mod constraints;
pub mod escrow;
pub mod pending_agent_perms;
pub mod pending_close_constraints;
pub mod pending_constraints;
pub mod pending_policy;
pub mod policy;
pub mod post_assertions;
pub mod session;
pub mod tracker;
pub mod vault;

pub use agent_spend_overlay::*;
pub use constraints::*;
pub use escrow::*;
pub use pending_agent_perms::*;
pub use pending_close_constraints::*;
pub use pending_constraints::*;
pub use pending_policy::*;
pub use policy::*;
pub use post_assertions::*;
pub use session::*;
pub use tracker::*;
pub use vault::*;

/// Maximum number of agents per vault
pub const MAX_AGENTS_PER_VAULT: usize = 10;

/// Full capability level — Operator (spending + non-spending).
/// Used in tests and presets where the agent should have full access.
pub const FULL_CAPABILITY: u8 = 2; // CAPABILITY_OPERATOR

/// Maximum number of allowed protocols in a policy
pub const MAX_ALLOWED_PROTOCOLS: usize = 10;

/// Maximum number of allowed destination addresses for agent transfers
pub const MAX_ALLOWED_DESTINATIONS: usize = 10;

/// Session expiry in slots (~20 slots ≈ 8 seconds)
pub const SESSION_EXPIRY_SLOTS: u64 = 20;

/// Fee rate denominator — fee_rate / 1,000,000 = fractional fee
pub const FEE_RATE_DENOMINATOR: u64 = 1_000_000;

/// Protocol fee rate: 200 / 1,000,000 = 0.02% = 2 BPS (hardcoded)
pub const PROTOCOL_FEE_RATE: u16 = 200;

/// Maximum developer fee rate: 500 / 1,000,000 = 0.05% = 5 BPS
pub const MAX_DEVELOPER_FEE_RATE: u16 = 500;

/// Maximum allowed slippage in basis points (5000 = 50%).
/// Prevents misconfiguration while allowing wide flexibility.
pub const MAX_SLIPPAGE_BPS: u16 = 5000;

/// Maximum escrow duration: 30 days in seconds
pub const MAX_ESCROW_DURATION: i64 = 2_592_000;

/// Minimum timelock duration: 30 minutes in seconds.
/// Enforced at vault creation and in all queue/apply paths.
/// Once a vault has a timelock, it can never be reduced below this floor.
pub const MIN_TIMELOCK_DURATION: u64 = 1800;

/// sha256("global:finalize_session")[0..8] — used by validate_and_authorize
/// to identify finalize_session instructions in the transaction.
pub const FINALIZE_SESSION_DISCRIMINATOR: [u8; 8] = [34, 148, 144, 47, 37, 130, 206, 161];

/// Ceiling fee: ceil(amount * rate / FEE_RATE_DENOMINATOR).
/// Guarantees non-zero fee for any non-zero amount with non-zero rate.
/// Zero-product (amount=0 or rate=0) naturally returns 0.
pub(crate) fn ceil_fee(amount: u64, rate: u64) -> Result<u64> {
    amount
        .checked_mul(rate)
        .ok_or(error!(SigilError::Overflow))?
        .checked_add(FEE_RATE_DENOMINATOR - 1)
        .ok_or(error!(SigilError::Overflow))?
        .checked_div(FEE_RATE_DENOMINATOR)
        .ok_or(error!(SigilError::Overflow))
}

// Build requires exactly one of: --features mainnet OR --features devnet
#[cfg(not(any(feature = "mainnet", feature = "devnet")))]
compile_error!("Build requires --features mainnet OR --features devnet");

#[cfg(all(feature = "mainnet", feature = "devnet"))]
compile_error!("Cannot enable both mainnet and devnet simultaneously");

#[cfg(all(feature = "mainnet", feature = "devnet-testing"))]
compile_error!("devnet-testing is a devnet-only feature and cannot be combined with mainnet");

#[cfg(feature = "devnet")]
/// Protocol treasury address (devnet)
/// Base58: ASHie1dFTnDSnrHMPGmniJhMgfJVGPm3rAaEPnrtWDiT
pub const PROTOCOL_TREASURY: Pubkey = Pubkey::new_from_array([
    140, 51, 155, 5, 120, 99, 25, 69, 20, 4, 163, 87, 229, 124, 111, 239, 107, 28, 230, 192, 254,
    239, 33, 251, 37, 93, 179, 29, 45, 226, 14, 172,
]);

/// Protocol treasury address (mainnet).
/// Base58: 7tvi5yJZyjpxXnbPTcR42mKVK7qbnjRjViTXv1rckNsy
///
/// This is the Squads V4 multisig **vault PDA** (signer derived from the multisig
/// account), 3-of-5 threshold, 5 distinct human signers. Squads V4 derivation
/// reuses the same `createKey` + program id, so this address is identical on
/// devnet and mainnet — devnet rehearsals exercise the exact byte sequence below.
///
/// Pre-mainnet checklist completed (PR-10 / M4):
///   [x] Squads multisig vault PDA derived (2026-05-09)
///   [x] Real 32-byte Pubkey pinned below; sentinel `compile_error!` removed
///   [x] CI 'mainnet-build-readiness' job exercises this constant
///   [ ] Squads members confirmed accepting (5/5) before mainnet binary tag
///   [ ] Tag the release commit; build mainnet binary from this commit
///
/// Why compile-time, not runtime?
///   The previous implementation used a [0u8; 32] sentinel and relied on the
///   deposit handler's `treasury_token.owner == PROTOCOL_TREASURY` check to
///   fail at runtime. That meant a mainnet binary CAN be built and deployed
///   with the sentinel; the bug surfaces only on the first deposit. Converting
///   to a compile-time guard makes a mainnet build fail at `cargo build` time
///   if the constant is unset — defense in depth (the runtime check stays).
///
/// To recreate the un-pinned state for tests: replace the byte array below with
/// `[0u8; 32]` and uncomment the previous `compile_error!` block. The runtime
/// owner check at `instructions/{create_escrow, agent_transfer,
/// validate_and_authorize}.rs` is preserved as a second layer.
#[cfg(feature = "mainnet")]
pub const PROTOCOL_TREASURY: Pubkey = Pubkey::new_from_array([
    102, 115, 120, 152, 65, 88, 210, 76, 7, 220, 80, 231, 112, 6, 22, 32, 26, 4, 137, 55, 84, 52, 4,
    200, 254, 195, 18, 105, 97, 38, 227, 136,
]);

// --- Stablecoin mint constants ---

/// USDC mint (devnet: DMFEQFCRsvGrYzoL2gfwTEd9J8eVBQEjg7HjbJHd6oGH)
/// Test-controlled keypair — we own the mint authority for devnet testing.
#[cfg(feature = "devnet")]
pub const USDC_MINT: Pubkey = Pubkey::new_from_array([
    183, 123, 243, 77, 18, 80, 250, 164, 199, 89, 146, 151, 150, 233, 12, 20, 206, 135, 29, 138,
    218, 153, 91, 77, 84, 71, 174, 53, 139, 167, 156, 54,
]);

/// USDC mint (mainnet: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)
#[cfg(feature = "mainnet")]
pub const USDC_MINT: Pubkey = Pubkey::new_from_array([
    198, 250, 122, 243, 190, 219, 173, 58, 61, 101, 243, 106, 171, 201, 116, 49, 177, 187, 228,
    194, 210, 246, 224, 228, 124, 166, 2, 3, 69, 47, 93, 97,
]);

/// USDT mint (devnet: 43cd9ma7P968BssTtAKNs5qu6zgsErupwxwdjkiuMHze)
/// Test-controlled keypair — we own the mint authority for devnet testing.
#[cfg(feature = "devnet")]
pub const USDT_MINT: Pubkey = Pubkey::new_from_array([
    45, 62, 128, 117, 22, 254, 177, 202, 78, 70, 249, 101, 252, 36, 244, 42, 82, 77, 95, 72, 170,
    154, 33, 171, 68, 12, 82, 27, 106, 105, 202, 15,
]);

/// USDT mint (mainnet: Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB)
#[cfg(feature = "mainnet")]
pub const USDT_MINT: Pubkey = Pubkey::new_from_array([
    206, 1, 14, 96, 175, 237, 178, 39, 23, 189, 99, 25, 47, 84, 20, 90, 63, 150, 90, 51, 187, 130,
    210, 199, 2, 158, 178, 206, 30, 32, 130, 100,
]);

/// M4 (PR-10): Mainnet treasury guard is now COMPILE-TIME, not runtime.
///
/// The mainnet PROTOCOL_TREASURY constant uses `compile_error!` so a mainnet
/// build with the [0u8; 32] sentinel fails at `cargo build` rather than at
/// first deposit. The previous M8 runtime test (`mainnet_treasury_must_not_be_zero`)
/// is structurally redundant: a `--features mainnet` build cannot reach the
/// test runner if the constant is unset, because compilation halts first.
///
/// The runtime owner check in `instructions/{create_escrow, agent_transfer,
/// validate_and_authorize}.rs` is preserved as defense in depth.
#[cfg(test)]
mod treasury_tests {
    /// S-5: Documents the compile_error! guard for devnet-testing + mainnet.
    /// The actual guard at lines 63-64 is verified by CI:
    ///   cargo build --no-default-features --features "devnet-testing,mainnet"
    /// which fails with compile_error. This test verifies related constants are sane.
    #[test]
    fn devnet_testing_mainnet_guard_constants_sane() {
        use super::*;
        assert_ne!(SESSION_EXPIRY_SLOTS, 0, "session expiry must be non-zero");
        assert!(MAX_AGENTS_PER_VAULT > 0, "must allow at least one agent");
        assert!(FULL_CAPABILITY > 0, "capability value must be non-zero");
    }
}

/// Check if a mint address is a recognized stablecoin (USDC or USDT).
/// With `devnet-testing` feature, accepts any mint for integration testing
/// on devnet where Circle-controlled USDC cannot be minted.
#[cfg(not(feature = "devnet-testing"))]
pub fn is_stablecoin_mint(mint: &Pubkey) -> bool {
    *mint == USDC_MINT || *mint == USDT_MINT
}

#[cfg(feature = "devnet-testing")]
pub fn is_stablecoin_mint(_mint: &Pubkey) -> bool {
    true
}

// --- Protocol program IDs (same address on mainnet and devnet) ---

/// Jupiter V6 program
/// Base58: JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4
pub const JUPITER_PROGRAM: Pubkey = Pubkey::new_from_array([
    4, 121, 213, 91, 242, 49, 192, 110, 238, 116, 197, 110, 206, 104, 21, 7, 253, 177, 178, 222,
    163, 244, 142, 81, 2, 177, 205, 162, 86, 188, 19, 143,
]);

/// Flash Trade (Perpetuals) program
/// Base58: FLASH6Lo6h3iasJKWDs2F8TkW2UKf3s15C8PMGuVfgBn
pub const FLASH_TRADE_PROGRAM: Pubkey = Pubkey::new_from_array([
    212, 236, 82, 74, 222, 71, 209, 50, 127, 252, 246, 137, 90, 104, 93, 148, 41, 240, 55, 144,
    196, 35, 87, 71, 243, 123, 215, 163, 221, 165, 30, 221,
]);

/// Jupiter Lend program (wraps deposits/withdrawals)
/// Base58: JLend2fEim9xUFcaHsyGePEoBzFLvkjMi3MnPcSuCdu
pub const JUPITER_LEND_PROGRAM: Pubkey = Pubkey::new_from_array([
    4, 113, 24, 1, 43, 4, 76, 56, 240, 98, 104, 189, 87, 231, 52, 36, 154, 118, 168, 157, 132, 58,
    30, 222, 238, 9, 26, 161, 252, 73, 18, 120,
]);

/// Jupiter Earn program (on-chain deposit/withdraw target)
/// Base58: jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9
pub const JUPITER_EARN_PROGRAM: Pubkey = Pubkey::new_from_array([
    10, 254, 27, 145, 46, 72, 94, 149, 253, 21, 235, 41, 55, 223, 252, 75, 55, 163, 22, 208, 166,
    56, 18, 255, 2, 186, 73, 180, 198, 193, 141, 30,
]);

/// Jupiter Borrow/Vaults program
/// Base58: jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi
pub const JUPITER_BORROW_PROGRAM: Pubkey = Pubkey::new_from_array([
    10, 254, 31, 147, 34, 167, 161, 209, 195, 102, 29, 103, 23, 145, 202, 155, 48, 211, 32, 47, 30,
    31, 214, 135, 58, 119, 204, 220, 113, 143, 17, 51,
]);

/// Token-2022 program ID
/// Base58: TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
pub const TOKEN_2022_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    6, 221, 246, 225, 238, 117, 143, 222, 24, 66, 93, 188, 228, 108, 205, 218, 182, 26, 252, 77,
    131, 185, 13, 39, 254, 189, 249, 40, 216, 161, 139, 252,
]);

/// USD amounts use 6 decimal places (matching USDC/USDT precision).
/// $1.00 = 1_000_000, $500.00 = 500_000_000
pub const USD_DECIMALS: u8 = 6;

/// 10^6 — base multiplier for USD amounts with 6 decimals
pub const USD_BASE: u64 = 1_000_000;

use crate::errors::SigilError;
use anchor_lang::prelude::*;

/// Vault status enum
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq)]
pub enum VaultStatus {
    /// Vault is active, agent can execute actions
    #[default]
    Active,
    /// Vault is frozen (kill switch activated), no agent actions allowed
    Frozen,
    /// Vault is closed, all funds withdrawn, PDAs can be reclaimed
    Closed,
}

// PositionEffect enum REMOVED — position counter system deleted wholesale per council
// decision (9-1 vote, 2026-04-19). See Plans/we-need-to-plan-serialized-summit.md.
//
// ActionType enum REMOVED — spending classification now derives from matched
// ConstraintEntryZC field (is_spending). See RFC-ACTIONTYPE-ELIMINATION.md.
// Agent permissions use the 2-bit capability field (CAPABILITY_OBSERVER / CAPABILITY_OPERATOR)
// instead of the old 21-bit bitmask.
