use super::{VaultStatus, MAX_AGENTS_PER_VAULT};
use anchor_lang::prelude::*;

/// Agent capability levels (replaces 21-bit ActionType bitmask).
/// 0 = Disabled, 1 = Observer (non-spending only), 2 = Operator (full access), 3 = Reserved.
pub const CAPABILITY_DISABLED: u8 = 0;
pub const CAPABILITY_OBSERVER: u8 = 1;
pub const CAPABILITY_OPERATOR: u8 = 2;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct AgentEntry {
    pub pubkey: Pubkey, // 32 bytes
    /// Agent capability: 0=Disabled, 1=Observer (non-spending), 2=Operator (full).
    /// Replaces the 21-bit ActionType permission bitmask.
    pub capability: u8, // 1 byte (was permissions: u64, 8 bytes)
    pub spending_limit_usd: u64, // 8 bytes — 0 = no per-agent limit
    pub paused: bool,   // 1 byte  — owner-controlled suspension
    /// TA-17 (Phase 3 pre-execution guard #7): consecutive policy-
    /// violation failures by this agent. Solana's atomic-or-none execution
    /// means a validate-time reject rolls back its own state mutation, so
    /// the counter cannot self-increment inside the failing tx. Instead,
    /// it is incremented by the owner-only `record_agent_violation` ix,
    /// called by an off-chain monitor after observing a failed seal whose
    /// reject reason is an on-chain policy code (numeric range
    /// POLICY_VIOLATION_RANGE = 6083..=6100 — see `state/mod.rs::is_policy_violation_code`).
    /// Reset to 0 inside `validate_and_authorize` on a successful seal.
    /// When `>= policy.auto_revoke_threshold`, the agent's capability is
    /// set to CAPABILITY_DISABLED and an `AgentAutoRevoked` event is
    /// emitted. Owner re-enables via `queue_agent_permissions_update`.
    ///
    /// External codes (sysvar-scan 6068 SysvarScanBoundExceeded,
    /// async-fulfillment 6069 AsyncFulfillmentNotPermitted, auth
    /// errors 6000-6082) do NOT increment — they're not the agent's
    /// fault and auto-revoking on them would let an attacker brick
    /// a working agent.
    ///
    /// Uses 1 byte from the prior `_reserved: [u8; 7]`. 6 bytes remain
    /// reserved for future fields.
    pub consecutive_failures: u8, // 1 byte
    pub _reserved: [u8; 6], // 6 bytes — was 7 pre-TA-17
}
// Total: 49 bytes per entry (32 + 1 + 8 + 1 + 1 + 6 = 49, same as old layout)

#[account]
pub struct AgentVault {
    /// The owner who created this vault (has full authority)
    pub owner: Pubkey,

    /// Unique vault identifier (allows one owner to have multiple vaults)
    pub vault_id: u64,

    /// Registered agents with per-agent permission bitmasks (max 10)
    pub agents: Vec<AgentEntry>,

    /// Developer fee destination — IMMUTABLE after initialization.
    /// Prevents a compromised owner from redirecting fees.
    pub fee_destination: Pubkey,

    /// Vault status: Active, Frozen, or Closed
    pub status: VaultStatus,

    /// Bump seed for PDA derivation
    pub bump: u8,

    /// Unix timestamp of vault creation
    pub created_at: i64,

    /// Total number of agent transactions executed through this vault
    pub total_transactions: u64,

    /// Total volume processed in token base units
    pub total_volume: u64,

    /// Cumulative developer fees collected from this vault (token base units)
    pub total_fees_collected: u64,

    /// Cumulative stablecoin deposits in base units (USDC/USDT, 6 decimals).
    /// Incremented in deposit_funds for stablecoin mints only.
    /// Used for P&L: current_balance - total_deposited_usd + total_withdrawn_usd.
    /// Cumulative gross — never decremented. Informational only, never authorization input.
    pub total_deposited_usd: u64,

    /// Cumulative stablecoin withdrawals in base units (USDC/USDT, 6 decimals).
    /// Incremented in withdraw_funds for stablecoin mints only.
    pub total_withdrawn_usd: u64,

    /// Cumulative failed + expired session count.
    /// Incremented in finalize_session when success=false OR is_expired=true.
    /// Used for success rate: total_transactions / (total_transactions + total_failed_transactions).
    /// Informational only — never used in authorization decisions.
    pub total_failed_transactions: u64,

    /// Number of active (not yet finalized) sessions for this vault.
    /// Incremented in validate_and_authorize, decremented in finalize_session.
    /// close_vault requires this to be 0.
    pub active_sessions: u8,

    /// Phase 2 Task 8: observe_only mode flag (independent from TA-19;
    /// included in TA-19 digest encoding at position 10).
    ///
    /// When true, ALL `validate_and_authorize` calls reject with
    /// `ObserveOnlyModeBlocksExecute`. Provides a hard, low-blast-radius
    /// kill switch separate from `VaultStatus::Frozen` — owners can stand
    /// up an observe-only vault to baseline agent behaviour before opening
    /// the execute path.
    ///
    /// Set at `initialize_vault` time; flipped post-init via the dedicated
    /// `set_observe_only` instruction (F-12 audit fix, Option (a) direct
    /// owner-only flip mirroring `freeze_vault` simplicity).
    ///
    /// APPENDED at end of struct per F-14 APPEND-ONLY rule for Borsh stability.
    pub observe_only: bool,
}

// ARCHITECTURE DECISION: No on-chain viewer/delegate role
//
// The program has two roles: owner (full authority) and agent (execute within policy).
// There is no "viewer" or "delegate" role because:
//   1. All Solana account data is publicly readable via RPC.
//   2. Read-only access control is a dashboard/API concern, not on-chain.
//   3. Adding viewer entries would bloat account size with zero security benefit.
//   4. Delegate roles are handled by Squads V4 externally if the owner is a multisig.
//
// Found by: Persona test (Treasury Manager "David")
// Decision: By design. Dashboard RBAC handles this.

impl AgentVault {
    /// Account discriminator (8) + owner (32) + vault_id (8) +
    /// agents vec prefix (4) + agents data (49 * 10) +
    /// fee_destination (32) + status (1) + bump (1) +
    /// created_at (8) + total_transactions (8) + total_volume (8) +
    /// total_fees_collected (8) +
    /// total_deposited_usd (8) + total_withdrawn_usd (8) + total_failed_transactions (8) +
    /// active_sessions (1) + observe_only (1)  [Phase 2 TA-19]
    pub const SIZE: usize = 8
        + 32
        + 8
        + 4
        + (49 * MAX_AGENTS_PER_VAULT)
        + 32
        + 1
        + 1
        + 8
        + 8
        + 8
        + 8
        + 8
        + 8
        + 8
        + 1
        + 1; // observe_only [Phase 2 TA-19]
    // = 634 (Phase 2: 633 + 1 observe_only)

    pub fn is_active(&self) -> bool {
        self.status == VaultStatus::Active
    }

    pub fn has_agent(&self) -> bool {
        !self.agents.is_empty()
    }

    pub fn is_agent(&self, signer: &Pubkey) -> bool {
        self.agents.iter().any(|a| a.pubkey == *signer)
    }

    pub fn get_agent(&self, signer: &Pubkey) -> Option<&AgentEntry> {
        self.agents.iter().find(|a| a.pubkey == *signer)
    }

    /// Check if an agent has sufficient capability for the requested operation.
    /// is_spending: whether `authorized_amount > 0` — caller derives.
    /// Returns true if the agent's capability level permits the operation.
    pub fn has_capability(&self, signer: &Pubkey, is_spending: bool) -> bool {
        self.get_agent(signer)
            .map(|a| {
                if is_spending {
                    a.capability >= CAPABILITY_OPERATOR
                } else {
                    a.capability >= CAPABILITY_OBSERVER
                }
            })
            .unwrap_or(false)
    }

    pub fn agent_count(&self) -> usize {
        self.agents.len()
    }

    pub fn is_owner(&self, signer: &Pubkey) -> bool {
        self.owner == *signer
    }

    pub fn is_agent_paused(&self, signer: &Pubkey) -> bool {
        self.get_agent(signer).map(|a| a.paused).unwrap_or(false)
    }
}
