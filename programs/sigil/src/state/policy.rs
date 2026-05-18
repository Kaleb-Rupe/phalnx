use super::{MAX_ALLOWED_DESTINATIONS, MAX_ALLOWED_PROTOCOLS, SESSION_DURATION_SECONDS};
use anchor_lang::prelude::*;

/// Protocol access control mode: only protocols in list allowed.
///
/// Phase 2 (Option A default-tightening): this is the ONLY permitted value.
/// The prior `PROTOCOL_MODE_ALL` (0) and `PROTOCOL_MODE_DENYLIST` (2) constants
/// were deleted because:
///   - ALL mode bypassed the protocol allowlist entirely (Audit #2 F-4 vector).
///   - DENYLIST mode required Sigil to enumerate every hostile program — an
///     unbounded set — defeating the security primitive.
/// Vaults MUST use ALLOWLIST. Handlers (`initialize_vault`, `queue_policy_update`,
/// `apply_pending_policy`) reject any other value with `InvalidProtocolMode`.
pub const PROTOCOL_MODE_ALLOWLIST: u8 = 1;

/// Destination access control mode: destination MUST be in `allowed_destinations`.
///
/// Phase 2 (Option A default-tightening): this is the ONLY permitted value.
/// The prior `DESTINATION_MODE_OPEN_WITH_CAP` (1) constant was deleted because
/// it allowed a compromised agent to drain `daily_spending_cap_usd` to any
/// destination (closes F-4 default-allow drain vector definitively, rather
/// than depending on owner opt-in correctness).
/// Vaults MUST use RESTRICTED. Handlers reject any other value with
/// `InvalidDestinationMode`.
pub const DESTINATION_MODE_RESTRICTED: u8 = 0;

#[account]
pub struct PolicyConfig {
    /// Associated vault pubkey
    pub vault: Pubkey,

    /// Maximum aggregate spend per rolling 24h period in USD (6 decimals).
    /// $500 = 500_000_000. This is the primary spending cap.
    pub daily_spending_cap_usd: u64,

    /// Maximum single transaction size in USD (6 decimals).
    pub max_transaction_size_usd: u64,

    /// Protocol allowlist mode. Phase 2 Option A: ONLY value 1 (ALLOWLIST)
    /// permitted. Modes 0 (ALL) and 2 (DENYLIST) deleted under L-1. Handler
    /// rejects any other value with `ErrInvalidProtocolMode`.
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

    /// Destination access control mode for `agent_transfer` and spending paths.
    ///
    /// Phase 2 Option A: only value 0 (RESTRICTED) is accepted. Permissive
    /// OPEN_WITH_CAP (1) was deleted. Closes F-4 (third-pass audit) and the
    /// subsequent owner-opt-in window definitively.
    pub destination_mode: u8,

    /// TA-19 (Phase 2): SHA-256 digest of the canonical Borsh encoding of the
    /// policy fields the owner approved at queue/init time. Bound at the same
    /// instruction where the owner signs the change, re-asserted at apply, so
    /// a compromised owner-signer or pending-PDA tampering cannot mutate the
    /// applied policy without producing a digest mismatch.
    ///
    /// CANONICAL ENCODING (FIXED — DO NOT REORDER):
    ///   1. `daily_spending_cap_usd: u64`
    ///   2. `max_transaction_size_usd: u64`
    ///   3. `max_slippage_bps: u16`
    ///   4. `developer_fee_rate: u16` — PEN-CROSS-6 (Phase 2 close-up)
    ///   5. `protocol_mode: u8`
    ///   6. `protocols: Vec<Pubkey>`
    ///   7. `destination_mode: u8`
    ///   8. `allowed_destinations: Vec<Pubkey>`
    ///   9. `timelock_duration: u64`
    ///   10. `session_expiry_seconds: u64`
    ///   11. `observe_only: bool`
    ///   12. `has_constraints: bool`
    ///   13. `has_post_assertions: u8`
    ///   14. `created_at_slot: u64` — PEN-CROSS-2 (Phase 2 close-up)
    ///
    /// All fields encoded as Borsh: u8/u16/u64 little-endian, `bool` as `[u8; 1]`
    /// (0 or 1), `Vec<Pubkey>` as `u32_le_len ++ pubkey_bytes_concatenated`.
    /// The SDK helper `computePolicyPreviewDigest` mirrors this encoding exactly.
    ///
    /// APPENDED at end of struct per F-14 APPEND-ONLY rule for Borsh stability.
    pub policy_preview_digest: [u8; 32],

    /// PEN-CROSS-2 (Phase 2 close-up): the slot at which `initialize_vault`
    /// minted this PolicyConfig. Bound by TA-19 at position 14 of the
    /// canonical digest encoding.
    ///
    /// Closes the close+reinit replay window: an owner who closes a vault
    /// (via `close_vault`) and later re-inits a fresh PDA at the same
    /// (owner, vault_id) gets a new `created_at_slot`. The signed
    /// `initialize_vault` ix from the old vault encodes the OLD slot in its
    /// preview digest, so replaying that signed tx against the fresh PDA
    /// produces a digest mismatch and `PolicyPreviewMismatch` rejects it.
    ///
    /// APPENDED at end of struct per F-14 APPEND-ONLY rule.
    pub created_at_slot: u64,
}

impl PolicyConfig {
    /// Account discriminator (8) + vault (32) + daily_cap_usd (8) +
    /// max_tx_usd (8) + protocol_mode (1) +
    /// protocols vec (4 + 32 * MAX) +
    /// developer_fee_rate (2) + max_slippage_bps (2) + timelock_duration (8) +
    /// allowed_destinations vec (4 + 32 * MAX) + has_constraints (1) +
    /// has_pending_policy (1) + has_protocol_caps (1) +
    /// protocol_caps vec (4 + 8 * MAX) + session_expiry_seconds (8) + bump (1) +
    /// policy_version (8) + has_post_assertions (1) + destination_mode (1) +
    /// policy_preview_digest (32) + created_at_slot (8)
    /// [TA-19, Phase 2; PEN-CROSS-2 Phase 2 close-up]
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
        + 1 // destination_mode
        + 32 // policy_preview_digest [TA-19]
        + 8; // created_at_slot [PEN-CROSS-2]

    /// Check if a protocol is allowed.
    ///
    /// Phase 2 Option A: ALLOWLIST-only. Permissive ALL/DENYLIST modes deleted.
    /// Returns true iff `program_id` appears in `self.protocols`.
    /// Handlers reject `protocol_mode != PROTOCOL_MODE_ALLOWLIST` at create/queue/apply,
    /// so a runtime `protocol_mode` mismatch here indicates state corruption — fail closed.
    pub fn is_protocol_allowed(&self, program_id: &Pubkey) -> bool {
        if self.protocol_mode != PROTOCOL_MODE_ALLOWLIST {
            return false; // defensive: state corruption / migration glitch
        }
        self.protocols.contains(program_id)
    }

    /// Check if a destination is allowed for agent transfers.
    ///
    /// Phase 2 Option A: RESTRICTED-only. Permissive OPEN_WITH_CAP mode deleted
    /// (closes F-4 default-allow drain vector definitively rather than relying on
    /// owner opt-in correctness). Returns true iff `destination_owner` appears
    /// in `self.allowed_destinations`. An empty list rejects every destination.
    /// Handlers reject `destination_mode != DESTINATION_MODE_RESTRICTED` at
    /// create/queue/apply, so a runtime mismatch here indicates state corruption —
    /// fail closed.
    pub fn is_destination_allowed(&self, destination_owner: &Pubkey) -> bool {
        if self.destination_mode != DESTINATION_MODE_RESTRICTED {
            return false; // defensive: state corruption / migration glitch
        }
        self.allowed_destinations.contains(destination_owner)
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
