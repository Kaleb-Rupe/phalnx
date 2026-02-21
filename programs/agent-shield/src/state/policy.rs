use super::{MAX_ALLOWED_DESTINATIONS, MAX_ALLOWED_PROTOCOLS, MAX_ALLOWED_TOKENS};
use anchor_lang::prelude::*;

/// Sentinel for unpriced (receive-only) tokens.
/// `Pubkey::default()` cannot be used because it equals `system_program::ID`
/// (both are all-zero bytes). Using all-0xFF bytes instead.
pub const UNPRICED_SENTINEL: Pubkey = Pubkey::new_from_array([0xFF; 32]);

/// Per-token configuration including oracle feed and per-token caps.
/// Replaces the old `Vec<Pubkey>` allowed_tokens with richer metadata.
///
/// Oracle feed classification:
///   - `Pubkey::default()` = stablecoin (1:1 USD, no oracle needed)
///   - `UNPRICED_SENTINEL` ([0xFF; 32]) = unpriced token (receive-only)
///   - Any other pubkey = Oracle feed account (Pyth PriceUpdateV2 or Switchboard PullFeed)
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AllowedToken {
    /// Token mint address
    pub mint: Pubkey,

    /// Oracle feed account (Pyth PriceUpdateV2 or Switchboard PullFeed) for USD pricing.
    /// `Pubkey::default()` = stablecoin (1:1 USD).
    /// `UNPRICED_SENTINEL` = unpriced (receive-only, cannot be spent).
    pub oracle_feed: Pubkey,

    /// Token decimals (e.g., 6 for USDC, 9 for SOL)
    pub decimals: u8,

    /// Per-token daily cap in base units (0 = no per-token limit,
    /// only the aggregate USD cap applies)
    pub daily_cap_base: u64,

    /// Per-token max single transaction in base units
    /// (0 = no per-token tx limit, only USD tx limit applies)
    pub max_tx_base: u64,
}

impl AllowedToken {
    /// 32 (mint) + 32 (oracle_feed) + 1 (decimals) + 8 (daily_cap_base) + 8 (max_tx_base) = 81
    pub const SIZE: usize = 32 + 32 + 1 + 8 + 8;

    /// Returns true if this token is classified as a stablecoin (1:1 USD)
    pub fn is_stablecoin(&self) -> bool {
        self.oracle_feed == Pubkey::default()
    }

    /// Returns true if this token is unpriced (receive-only, cannot be spent)
    pub fn is_unpriced(&self) -> bool {
        self.oracle_feed == UNPRICED_SENTINEL
    }

    /// Returns true if this token requires an oracle (Pyth or Switchboard) for pricing
    pub fn is_oracle_priced(&self) -> bool {
        !self.is_stablecoin() && !self.is_unpriced()
    }
}

#[account]
pub struct PolicyConfig {
    /// Associated vault pubkey
    pub vault: Pubkey,

    /// Maximum aggregate spend per rolling 24h period in USD (6 decimals).
    /// $500 = 500_000_000. This is the primary spending cap.
    pub daily_spending_cap_usd: u64,

    /// Maximum single transaction size in USD (6 decimals).
    pub max_transaction_size_usd: u64,

    /// Allowed token mints with oracle feeds and per-token caps.
    /// Bounded to MAX_ALLOWED_TOKENS entries.
    pub allowed_tokens: Vec<AllowedToken>,

    /// Allowed program IDs the agent can call (Jupiter, Flash Trade, etc.)
    /// Bounded to MAX_ALLOWED_PROTOCOLS entries
    pub allowed_protocols: Vec<Pubkey>,

    /// Maximum leverage multiplier in basis points (e.g., 10000 = 100x, 1000 = 10x)
    /// Set to 0 to disallow leveraged positions entirely
    pub max_leverage_bps: u16,

    /// Whether the agent can open new positions (vs only close existing)
    pub can_open_positions: bool,

    /// Maximum number of concurrent open positions
    pub max_concurrent_positions: u8,

    /// Developer fee rate (rate / 1,000,000). Applied to every finalized
    /// transaction. Fee deducted from vault, transferred to vault's
    /// fee_destination. Max MAX_DEVELOPER_FEE_RATE (500 = 5 BPS).
    /// Set to 0 for no developer fee. Protocol fee is always applied
    /// separately at PROTOCOL_FEE_RATE.
    pub developer_fee_rate: u16,

    /// Timelock duration in seconds for policy changes. 0 = no timelock
    /// (immediate updates allowed). When > 0, policy changes must go
    /// through queue_policy_update → apply_pending_policy.
    pub timelock_duration: u64,

    /// Allowed destination addresses for agent transfers.
    /// Empty = any destination allowed. Bounded to MAX_ALLOWED_DESTINATIONS.
    pub allowed_destinations: Vec<Pubkey>,

    /// Bump seed for PDA
    pub bump: u8,
}

impl PolicyConfig {
    /// Account discriminator (8) + vault (32) + daily_cap_usd (8) + max_tx_usd (8) +
    /// allowed_tokens vec (4 + AllowedToken::SIZE * MAX) +
    /// allowed_protocols vec (4 + 32 * MAX) +
    /// max_leverage (2) + can_open (1) + max_positions (1) +
    /// developer_fee_rate (2) + timelock_duration (8) +
    /// allowed_destinations vec (4 + 32 * MAX) + bump (1)
    pub const SIZE: usize = 8
        + 32
        + 8
        + 8
        + (4 + AllowedToken::SIZE * MAX_ALLOWED_TOKENS)
        + (4 + 32 * MAX_ALLOWED_PROTOCOLS)
        + 2
        + 1
        + 1
        + 2
        + 8
        + (4 + 32 * MAX_ALLOWED_DESTINATIONS)
        + 1;

    /// Find an allowed token by mint address
    pub fn find_token(&self, mint: &Pubkey) -> Option<&AllowedToken> {
        self.allowed_tokens.iter().find(|t| t.mint == *mint)
    }

    /// Find an allowed token by mint address and return (index, &AllowedToken)
    pub fn find_token_with_index(&self, mint: &Pubkey) -> Option<(u8, &AllowedToken)> {
        self.allowed_tokens
            .iter()
            .enumerate()
            .find(|(_, t)| t.mint == *mint)
            .map(|(i, t)| (i as u8, t))
    }

    /// Check if a token mint is in the allowed list
    pub fn is_token_allowed(&self, mint: &Pubkey) -> bool {
        self.find_token(mint).is_some()
    }

    pub fn is_protocol_allowed(&self, program_id: &Pubkey) -> bool {
        self.allowed_protocols.contains(program_id)
    }

    pub fn is_leverage_within_limit(&self, leverage_bps: u16) -> bool {
        leverage_bps <= self.max_leverage_bps
    }

    /// Check if a destination is allowed for agent transfers.
    /// Empty allowlist = any destination allowed.
    pub fn is_destination_allowed(&self, destination_owner: &Pubkey) -> bool {
        self.allowed_destinations.is_empty()
            || self.allowed_destinations.contains(destination_owner)
    }
}
