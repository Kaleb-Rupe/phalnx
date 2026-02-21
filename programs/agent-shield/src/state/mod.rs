pub mod pending_policy;
pub mod policy;
pub mod session;
pub mod tracker;
pub mod vault;

pub use pending_policy::*;
pub use policy::*;
pub use session::*;
pub use tracker::*;
pub use vault::*;

/// Maximum number of allowed tokens in a policy
pub const MAX_ALLOWED_TOKENS: usize = 10;

/// Maximum number of allowed protocols in a policy
pub const MAX_ALLOWED_PROTOCOLS: usize = 10;

/// Maximum number of allowed destination addresses for agent transfers
pub const MAX_ALLOWED_DESTINATIONS: usize = 10;

/// Maximum number of recent transactions stored on-chain
pub const MAX_RECENT_TRANSACTIONS: usize = 50;

/// Rolling window duration in seconds (24 hours)
pub const ROLLING_WINDOW_SECONDS: i64 = 86_400;

/// Session expiry in slots (~20 slots ≈ 8 seconds)
pub const SESSION_EXPIRY_SLOTS: u64 = 20;

/// Fee rate denominator — fee_rate / 1,000,000 = fractional fee
pub const FEE_RATE_DENOMINATOR: u64 = 1_000_000;

/// Protocol fee rate: 200 / 1,000,000 = 0.02% = 2 BPS (hardcoded)
pub const PROTOCOL_FEE_RATE: u16 = 200;

/// Maximum developer fee rate: 500 / 1,000,000 = 0.05% = 5 BPS
pub const MAX_DEVELOPER_FEE_RATE: u16 = 500;

/// Protocol treasury address (devnet placeholder — replace before mainnet)
/// Base58: ASHie1dFTnDSnrHMPGmniJhMgfJVGPm3rAaEPnrtWDiT
pub const PROTOCOL_TREASURY: Pubkey = Pubkey::new_from_array([
    140, 51, 155, 5, 120, 99, 25, 69, 20, 4, 163, 87, 229, 124, 111, 239, 107, 28, 230, 192, 254,
    239, 33, 251, 37, 93, 179, 29, 45, 226, 14, 172,
]);

// --- Oracle constants ---

/// Pyth Receiver program (same mainnet/devnet).
/// Base58: rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ
pub const PYTH_RECEIVER_PROGRAM: Pubkey = Pubkey::new_from_array([
    12, 183, 250, 187, 82, 247, 166, 72, 187, 91, 49, 125, 154, 1, 139, 144, 87, 203, 2, 71, 116,
    250, 254, 1, 230, 196, 223, 152, 204, 56, 88, 129,
]);

/// Switchboard On-Demand program (same mainnet/devnet).
/// Base58: SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv
pub const SWITCHBOARD_ON_DEMAND_PROGRAM: Pubkey = Pubkey::new_from_array([
    6, 115, 189, 70, 242, 228, 126, 4, 241, 43, 217, 47, 183, 49, 150, 142, 205, 157, 151, 87, 194,
    116, 218, 135, 71, 111, 70, 92, 4, 12, 101, 115,
]);

/// Maximum staleness for Switchboard feed values (in slots).
/// At ~400ms per slot, 100 slots ≈ 40 seconds.
pub const MAX_ORACLE_STALE_SLOTS: u32 = 100;

/// Minimum number of oracle samples required for a valid price.
pub const MIN_ORACLE_SAMPLES: u32 = 3;

/// Maximum confidence/price ratio in BPS. 1000 = 10%.
pub const MAX_CONFIDENCE_BPS: u64 = 1000;

/// USD amounts use 6 decimal places (matching USDC/USDT precision).
/// $1.00 = 1_000_000, $500.00 = 500_000_000
pub const USD_DECIMALS: u8 = 6;

/// 10^6 — base multiplier for USD amounts with 6 decimals
pub const USD_BASE: u64 = 1_000_000;

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

/// Action types that agents can request
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ActionType {
    /// Token swap (e.g., Jupiter)
    Swap,
    /// Open a perpetual position (e.g., Flash Trade)
    OpenPosition,
    /// Close a perpetual position
    ClosePosition,
    /// Increase position size
    IncreasePosition,
    /// Decrease position size
    DecreasePosition,
    /// Deposit into a lending/yield protocol (e.g., Kamino)
    Deposit,
    /// Withdraw from a lending/yield protocol
    Withdraw,
    /// Direct token transfer to an allowed destination
    Transfer,
}

use anchor_lang::prelude::*;

/// Tracker capacity tiers — chosen at vault creation, determines
/// max rolling spend entries and SpendTracker account size.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq)]
pub enum TrackerTier {
    /// 200 entries (~16 KB)
    #[default]
    Standard,
    /// 500 entries (~33 KB)
    Pro,
    /// 1000 entries (~61 KB)
    Max,
}

impl TrackerTier {
    pub fn max_spend_entries(&self) -> usize {
        match self {
            TrackerTier::Standard => 200,
            TrackerTier::Pro => 500,
            TrackerTier::Max => 1000,
        }
    }

    pub fn from_u8(val: u8) -> Option<TrackerTier> {
        match val {
            0 => Some(TrackerTier::Standard),
            1 => Some(TrackerTier::Pro),
            2 => Some(TrackerTier::Max),
            _ => None,
        }
    }
}
