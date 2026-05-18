use super::{MAX_ALLOWED_DESTINATIONS, MAX_ALLOWED_PROTOCOLS, SESSION_DURATION_SECONDS};
use anchor_lang::prelude::*;

/// Protocol access control mode: all protocols allowed
pub const PROTOCOL_MODE_ALL: u8 = 0;
/// Protocol access control mode: only protocols in list allowed
pub const PROTOCOL_MODE_ALLOWLIST: u8 = 1;
/// Protocol access control mode: all except protocols in list
pub const PROTOCOL_MODE_DENYLIST: u8 = 2;

/// Destination access control mode: destination MUST be in `allowed_destinations`
/// (default — closes F-4 default-allow drain vector).
pub const DESTINATION_MODE_RESTRICTED: u8 = 0;
/// Destination access control mode: any destination allowed; only the
/// daily spending cap throttles drain blast radius. Owner must explicitly opt in.
pub const DESTINATION_MODE_OPEN_WITH_CAP: u8 = 1;

#[account]
pub struct PolicyConfig {
    /// Associated vault pubkey
    pub vault: Pubkey,

    /// Maximum aggregate spend per rolling 24h period in USD (6 decimals).
    /// $500 = 500_000_000. This is the primary spending cap.
    pub daily_spending_cap_usd: u64,

    /// Maximum single transaction size in USD (6 decimals).
    pub max_transaction_size_usd: u64,

    /// Protocol access control mode:
    ///   0 = all allowed (protocols list ignored)
    ///   1 = allowlist (only protocols in list)
    ///   2 = denylist (all except protocols in list)
    pub protocol_mode: u8,

    /// Protocol pubkeys for allowlist/denylist.
    /// Bounded to MAX_ALLOWED_PROTOCOLS entries.
    pub protocols: Vec<Pubkey>,

    /// Developer fee rate (rate / 1,000,000). Applied to every finalized
    /// transaction. Max MAX_DEVELOPER_FEE_RATE (500 = 5 BPS).
    pub developer_fee_rate: u16,

    /// Maximum slippage tolerance (basis points) — generic config primitive
    /// preserved per D-5 across Phase 1 Option A demolition. Per L-1 there is
    /// no on-chain Jupiter slippage verifier in V1; this field is consumed by
    /// off-chain SDK simulators and (Phase 6) generic post-execution assertions
    /// (R-1 mint-delta cap). Validated at config time via
    /// `max_slippage_bps <= MAX_SLIPPAGE_BPS` (= 5000 BPS = 50% ceiling).
    /// 0 = no slippage protection configured.
    pub max_slippage_bps: u16,

    /// Timelock duration in seconds for policy changes. 0 = no timelock.
    pub timelock_duration: u64,

    /// Allowed destination addresses for agent transfers.
    /// Empty = any destination allowed. Bounded to MAX_ALLOWED_DESTINATIONS.
    pub allowed_destinations: Vec<Pubkey>,

    /// Whether instruction constraints PDA exists for this vault.
    /// Set true by create_instruction_constraints, false by apply_close_constraints.
    pub has_constraints: bool,

    /// Whether a pending policy update PDA exists for this vault.
    /// Set true by queue_policy_update, false by apply/cancel_pending_policy.
    pub has_pending_policy: bool,

    /// Whether per-protocol spend caps are configured.
    /// Requires protocol_mode == ALLOWLIST and protocol_caps.len() == protocols.len().
    pub has_protocol_caps: bool,

    /// Per-protocol daily spending caps in USD (6 decimals).
    /// Index-aligned with `protocols`. Only enforced when `has_protocol_caps = true`.
    /// A value of 0 means no per-protocol limit (global cap still applies).
    pub protocol_caps: Vec<u64>,

    /// Configurable session duration in seconds. 0 = use default
    /// (`SESSION_DURATION_SECONDS` = 30s). Valid range when non-zero:
    /// `MIN_SESSION_DURATION_SECONDS..=MAX_OWNER_SESSION_DURATION_SECONDS`
    /// (currently 5..=90s). Wall-clock based — see audit F5-H1.
    pub session_expiry_seconds: u64,

    /// Bump seed for PDA
    pub bump: u8,

    /// Policy version counter for OCC (optimistic concurrency control).
    /// Incremented on every apply_pending_policy and apply_constraints_update.
    /// Agents include expected_policy_version in validate_and_authorize;
    /// program rejects if version changed since the agent's RPC read.
    pub policy_version: u64,

    /// Whether native PostExecutionAssertions are configured for this vault.
    /// When true, finalize_session requires the assertions PDA in remaining_accounts.
    /// 0 = no assertions, non-zero = assertions required.
    pub has_post_assertions: u8,

    /// Destination access control mode for `agent_transfer`:
    ///   0 = Restricted (DEFAULT) — destination MUST be in `allowed_destinations`.
    ///   1 = OpenWithCap — destination unrestricted; only `daily_spending_cap_usd` throttles drain.
    /// Closes F-4 (third-pass audit): empty `allowed_destinations` no longer
    /// implies default-allow. Owners must explicitly opt into OpenWithCap via
    /// queue_policy_update / apply_pending_policy.
    pub destination_mode: u8,
}

impl PolicyConfig {
    /// Account discriminator (8) + vault (32) + daily_cap_usd (8) +
    /// max_tx_usd (8) + protocol_mode (1) +
    /// protocols vec (4 + 32 * MAX) +
    /// developer_fee_rate (2) + max_slippage_bps (2) + timelock_duration (8) +
    /// allowed_destinations vec (4 + 32 * MAX) + has_constraints (1) +
    /// has_pending_policy (1) + has_protocol_caps (1) +
    /// protocol_caps vec (4 + 8 * MAX) + session_expiry_seconds (8) + bump (1) +
    /// policy_version (8) + has_post_assertions (1) + destination_mode (1)
    pub const SIZE: usize = 8
        + 32
        + 8
        + 8
        + 1
        + (4 + 32 * MAX_ALLOWED_PROTOCOLS)
        + 2
        + 2 // max_slippage_bps
        + 8
        + (4 + 32 * MAX_ALLOWED_DESTINATIONS)
        + 1 // has_constraints
        + 1 // has_pending_policy
        + 1 // has_protocol_caps
        + (4 + 8 * MAX_ALLOWED_PROTOCOLS) // protocol_caps
        + 8 // session_expiry_seconds
        + 1 // bump
        + 8 // policy_version
        + 1 // has_post_assertions
        + 1; // destination_mode

    /// Check if a protocol is allowed based on the protocol mode.
    pub fn is_protocol_allowed(&self, program_id: &Pubkey) -> bool {
        match self.protocol_mode {
            PROTOCOL_MODE_ALL => true,
            PROTOCOL_MODE_ALLOWLIST => self.protocols.contains(program_id),
            PROTOCOL_MODE_DENYLIST => !self.protocols.contains(program_id),
            _ => false, // invalid mode = deny all
        }
    }

    /// Check if a destination is allowed for agent transfers.
    ///
    /// Behaviour is governed by `destination_mode` (F-4 audit fix —
    /// previously this returned true on any empty allowlist, allowing a
    /// compromised agent to drain `daily_spending_cap_usd` to any address).
    ///
    /// * `DESTINATION_MODE_RESTRICTED` (0, default) — destination MUST appear
    ///   in `allowed_destinations`. An empty list rejects every destination.
    /// * `DESTINATION_MODE_OPEN_WITH_CAP` (1) — destination unrestricted; only
    ///   the daily cap throttles. Owner must opt in explicitly via the
    ///   timelocked queue_policy_update path.
    /// * Any other value — fail-closed deny (defensive against bit flips /
    ///   migration glitches).
    pub fn is_destination_allowed(&self, destination_owner: &Pubkey) -> bool {
        match self.destination_mode {
            DESTINATION_MODE_OPEN_WITH_CAP => true,
            DESTINATION_MODE_RESTRICTED => self.allowed_destinations.contains(destination_owner),
            _ => false,
        }
    }

    /// Get the per-protocol daily cap for a given protocol.
    /// Returns None if caps disabled, or Some(cap) where 0 means unlimited.
    pub fn get_protocol_cap(&self, protocol: &Pubkey) -> Option<u64> {
        if !self.has_protocol_caps {
            return None;
        }
        self.protocols
            .iter()
            .position(|p| p == protocol)
            .map(|i| self.protocol_caps.get(i).copied().unwrap_or(0))
    }

    /// Returns the effective session duration in seconds.
    /// 0 = use default (`SESSION_DURATION_SECONDS` = 30s).
    pub fn effective_session_expiry_seconds(&self) -> u64 {
        if self.session_expiry_seconds == 0 {
            SESSION_DURATION_SECONDS as u64
        } else {
            self.session_expiry_seconds
        }
    }
}
