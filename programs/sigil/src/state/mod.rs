pub mod agent_spend_overlay;
pub mod constraints;
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

/// Default session duration in seconds (when `policy.session_expiry_seconds == 0`).
///
/// **Why timestamp-based, not slot-based:** Solana slot times vary 400ms-1.5s
/// under congestion. The previous slot-based bound (20 slots) ranged from 8s
/// (target) to 30s (worst-case observed) — a 3.75x variance window. Audit
/// finding F5-H1 (third-pass adversarial review) flagged this as HIGH severity
/// because the documented "8 seconds" assumption was load-bearing for
/// agent-permission risk modeling.
///
/// `Clock::unix_timestamp` is wall-clock and unaffected by congestion.
pub const SESSION_DURATION_SECONDS: i64 = 30;

/// Minimum owner-configurable session duration. Sessions shorter than this
/// are rejected at `queue_policy_update` (a 1-second window is unusable in
/// practice and indicates misconfiguration).
pub const MIN_SESSION_DURATION_SECONDS: u64 = 5;

/// Maximum owner-configurable session duration. Bounded to defend against
/// misconfiguration that would leave delegations live for minutes. Previous
/// slot-based bound (450) at 1.5s/slot would have permitted **11 minutes** of
/// live token delegation under congestion. 90 seconds is a hard worst-case.
pub const MAX_OWNER_SESSION_DURATION_SECONDS: u64 = 90;

/// Fee rate denominator — fee_rate / 1,000,000 = fractional fee
pub const FEE_RATE_DENOMINATOR: u64 = 1_000_000;

/// Protocol fee rate: 200 / 1,000,000 = 0.02% = 2 BPS (hardcoded)
pub const PROTOCOL_FEE_RATE: u16 = 200;

/// Maximum developer fee rate: 500 / 1,000,000 = 0.05% = 5 BPS
pub const MAX_DEVELOPER_FEE_RATE: u16 = 500;

/// Maximum allowed slippage in basis points (5000 = 50%).
/// Prevents misconfiguration while allowing wide flexibility.
pub const MAX_SLIPPAGE_BPS: u16 = 5000;

// MAX_ESCROW_DURATION constant REMOVED in v2 revamp Stage 1 (escrow deleted).

/// Minimum timelock duration: 30 minutes in seconds.
/// Enforced at vault creation and in all queue/apply paths.
/// Once a vault has a timelock, it can never be reduced below this floor.
pub const MIN_TIMELOCK_DURATION: u64 = 1800;

/// F-10 audit fix: maximum age (in slots) between queue and apply for any
/// pending administrative update.
///
/// Defends against durable-nonce pre-signing attacks where an attacker
/// pre-signs `apply_*` and submits weeks/months later — the Drift Protocol
/// April 2026 $285M analog. The on-chain queue already enforces a minimum
/// delay (`MIN_TIMELOCK_DURATION`) before apply, but had no upper bound:
/// a durable-nonce holder could sit on a signed `apply_*` indefinitely and
/// fire it at the moment that hurts the vault most (e.g. right after a
/// loosening policy change clears).
///
/// 216,000 slots = ~24h at 400ms slots, ~90h at 1.5s slots — large enough
/// to absorb any legitimate timelock + execution window, small enough to
/// kill the "weeks later" attack surface. Beyond this window, the queued
/// update is stale and must be re-queued by the owner.
pub const MAX_APPLY_AGE_SLOTS: u64 = 216_000;

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
/// owner check at `instructions/{agent_transfer,
/// validate_and_authorize}.rs` is preserved as a second layer.
#[cfg(feature = "mainnet")]
pub const PROTOCOL_TREASURY: Pubkey = Pubkey::new_from_array([
    102, 115, 120, 152, 65, 88, 210, 76, 7, 220, 80, 231, 112, 6, 22, 32, 26, 4, 137, 55, 84, 52,
    4, 200, 254, 195, 18, 105, 97, 38, 227, 136,
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
/// The runtime owner check in `instructions/{agent_transfer,
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
        assert!(
            SESSION_DURATION_SECONDS > 0,
            "session duration must be positive"
        );
        assert!(
            MIN_SESSION_DURATION_SECONDS < MAX_OWNER_SESSION_DURATION_SECONDS,
            "min must be below max owner-configurable bound"
        );
        assert!(MAX_AGENTS_PER_VAULT > 0, "must allow at least one agent");
        assert!(FULL_CAPABILITY > 0, "capability value must be non-zero");
    }
}

#[cfg(test)]
mod ta03_pinned_deposit_mint_tests {
    use super::*;

    /// TA-03: pinned-deposit predicate must accept USDC under the
    /// non-devnet-testing build. cargo test for the lib runs with the
    /// default `devnet` feature; `devnet-testing` is enabled only by the
    /// dedicated `cargo test --features devnet-testing` job. We assert the
    /// strict path here because the strict variant is the one shipped.
    #[cfg(not(feature = "devnet-testing"))]
    #[test]
    fn pinned_deposit_accepts_usdc() {
        assert!(
            is_pinned_deposit_mint(&USDC_MINT),
            "USDC mint must pass the pinned-deposit gate"
        );
    }

    /// TA-03: pinned-deposit must accept USDT.
    #[cfg(not(feature = "devnet-testing"))]
    #[test]
    fn pinned_deposit_accepts_usdt() {
        assert!(
            is_pinned_deposit_mint(&USDT_MINT),
            "USDT mint must pass the pinned-deposit gate"
        );
    }

    /// TA-03: pinned-deposit MUST reject an arbitrary unrecognized mint.
    /// Closes the deposit-time gap where an exotic mint could be parked in
    /// the vault and trigger `is_stablecoin_mint=true` only via the
    /// devnet-testing escape — the strict build must reject.
    #[cfg(not(feature = "devnet-testing"))]
    #[test]
    fn pinned_deposit_rejects_arbitrary_mint() {
        let arbitrary = Pubkey::new_from_array([7u8; 32]);
        assert!(
            !is_pinned_deposit_mint(&arbitrary),
            "arbitrary mint MUST be rejected by the pinned-deposit gate"
        );
    }

    /// TA-03: under devnet-testing, the pin is open — same escape hatch as
    /// `is_stablecoin_mint`. Required so LiteSVM + Surfpool integration
    /// suites can drive deposits with arbitrary test mints.
    #[cfg(feature = "devnet-testing")]
    #[test]
    fn pinned_deposit_devnet_testing_accepts_arbitrary_mint() {
        let arbitrary = Pubkey::new_from_array([7u8; 32]);
        assert!(
            is_pinned_deposit_mint(&arbitrary),
            "devnet-testing must keep the deposit gate open for integration suites"
        );
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

/// TA-03 — pinned-deposit allowlist for `deposit_funds`.
///
/// `is_stablecoin_mint` above is used throughout the spending path (balance
/// delta verification, output-mint checks, fee accounting). It must NOT widen
/// or it loosens existing security paths. TA-03 introduces a separate,
/// narrower predicate that gates **deposits only** to the exact set of mints
/// the program has been built for.
///
/// Mainnet: exactly USDC + USDT.
/// Devnet:  the devnet test-keypair USDC + USDT minted under our control.
/// `devnet-testing` (LiteSVM integration / Surfpool runs): any mint accepted,
/// matching the `is_stablecoin_mint` escape hatch — required because we can't
/// mint Circle-controlled USDC in these environments.
///
/// Together with the existing compile-time `mainnet|devnet` feature gate
/// (`compile_error!` in state/mod.rs), this provides build-time pinning: a
/// mainnet binary literally cannot be built against an unpinned mint set.
#[cfg(not(feature = "devnet-testing"))]
pub fn is_pinned_deposit_mint(mint: &Pubkey) -> bool {
    *mint == USDC_MINT || *mint == USDT_MINT
}

#[cfg(feature = "devnet-testing")]
pub fn is_pinned_deposit_mint(_mint: &Pubkey) -> bool {
    true
}

// --- Protocol program IDs (same address on mainnet and devnet) ---

// JUPITER_PROGRAM constant removed in Phase 1 (Option A demolition). The Jupiter
// V6 program ID is no longer referenced by on-chain code. SDK-side allowlist
// configuration uses the literal pubkey string `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`
// passed through PolicyConfig.protocols at vault creation time — generic primitive,
// not Jupiter-specific.

// ─── ADR-Phase-1 (2026-05-17) ───────────────────────────────────────────────
// JUPITER_LEND_PROGRAM / JUPITER_EARN_PROGRAM / JUPITER_BORROW_PROGRAM survive
// the Option A demolition as **`is_recognized_defi` markers** used by
// `ProtocolMismatch` enforcement and `defi_ix_count` accounting in
// `validate_and_authorize`. These are program-ID identifiers, NOT Jupiter
// routing-format parsers; they comply with Option A L-1 because Sigil does NOT
// interpret the Jupiter instruction data — it only checks whether the target
// program of a bundle's DeFi instruction is on this recognized-DeFi list.
//
// JUPITER_PERPS_PROGRAM survives in `KNOWN_ASYNC_FULFILLMENT_PROGRAMS`
// (alongside `DRIFT_V2_PROGRAM` and `DRIFT_JIT_PROXY_PROGRAM`) as an
// **attack-class block** — the program-ID is rejected outright in the scan
// because async-fulfillment models break Sigil's stablecoin balance-delta
// measurement (the keeper submits the SPL transfer 5-45s later in a separate
// transaction, so `finalize_session` records a $0 spend). Again, no Jupiter
// instruction-data parsing is involved; the block is purely program-ID based.
//
// **Future direction:** D-5 / Phase 4 TA-10 hardening will eventually replace
// these explicit constants with a **generic primitive** (reject any program ID
// known to follow async-fulfillment patterns; recognize DeFi via a per-vault
// PolicyConfig.protocols list, not a hardcoded enum). For V1 the explicit
// allowlist is the simplest implementation and the smallest blast radius.
// ─────────────────────────────────────────────────────────────────────────────

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

// --- Async-fulfillment programs (C4 audit fix) ---
//
// These three protocols use a request/fulfillment model: the user submits a
// `request*` instruction and the keeper submits the actual SPL transfer in a
// SEPARATE transaction 5-45s later. Because the transfer happens after
// `finalize_session` returns, Sigil's stablecoin balance-delta measurement is
// always 0, so daily caps + per-protocol caps + spend tracker never record
// the real spend, and the vault drains silently.
//
// V1 mitigation (Option C): hardcode-reject these program IDs in the
// instruction scan. A future release may re-enable them via the constraints
// PDA + post-execution assertions once we can prove keeper-tx accounting
// across atomic boundaries.
//
// Source: Sigil security audit C4 (2026-05). See also:
// - Jupiter Perps:    PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu
// - Drift v2:         dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH
// - Drift JIT proxy:  J1TnP8zvVxbtF5KFp5xRmWuvG9McnhzmBd9XGfCyuxFP

/// Jupiter Perpetuals program
/// Base58: PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu
pub const JUPITER_PERPS_PROGRAM: Pubkey = Pubkey::new_from_array([
    5, 177, 243, 202, 241, 148, 98, 239, 135, 96, 240, 171, 222, 117, 205, 61, 158, 227, 27, 58,
    50, 198, 32, 232, 148, 18, 46, 156, 155, 129, 69, 250,
]);

/// Drift v2 protocol program
/// Base58: dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH
pub const DRIFT_V2_PROGRAM: Pubkey = Pubkey::new_from_array([
    9, 84, 219, 190, 158, 201, 96, 201, 138, 122, 41, 63, 226, 19, 54, 150, 111, 225, 128, 209, 81,
    174, 75, 129, 121, 86, 31, 137, 133, 74, 83, 246,
]);

/// Drift JIT proxy program
/// Base58: J1TnP8zvVxbtF5KFp5xRmWuvG9McnhzmBd9XGfCyuxFP
pub const DRIFT_JIT_PROXY_PROGRAM: Pubkey = Pubkey::new_from_array([
    252, 180, 245, 243, 227, 226, 41, 248, 219, 192, 203, 167, 225, 83, 228, 133, 83, 109, 79, 110,
    62, 225, 115, 177, 71, 201, 141, 78, 240, 248, 168, 126,
]);

/// Programs whose spending Sigil cannot measure synchronously inside
/// `validate_and_authorize` because they use a request/fulfillment model
/// (the keeper submits the actual SPL transfer 5-45s later in a separate
/// transaction). Hardcode-rejected in V1; see C4 audit finding above.
pub const KNOWN_ASYNC_FULFILLMENT_PROGRAMS: [Pubkey; 3] = [
    JUPITER_PERPS_PROGRAM,
    DRIFT_V2_PROGRAM,
    DRIFT_JIT_PROXY_PROGRAM,
];

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
// ActionType enum REMOVED — spending classification now derives from
// `amount > 0` at runtime (validate_and_authorize.rs). The previously-stored
// `is_spending` field on ConstraintEntryZC was deleted (M2 Option A) because
// the runtime never read it. See RFC-ACTIONTYPE-ELIMINATION.md.
// Agent permissions use the 2-bit capability field (CAPABILITY_OBSERVER / CAPABILITY_OPERATOR)
// instead of the old 21-bit bitmask.
