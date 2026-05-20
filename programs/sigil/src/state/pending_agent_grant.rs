use anchor_lang::prelude::*;

/// Phase 8 PEN-CROSS-1 (Council ISC-58..65) — queued OPERATOR-class agent grant.
///
/// `register_agent` (Batch 6) now hard-rejects `capability == CAPABILITY_OPERATOR`
/// (closes the phished-owner instant-operator-grant vector). To grant an
/// OPERATOR-class agent the owner now MUST route through the two-step queue
/// + apply timelock-gated path:
///
///   1. `queue_agent_grant(agent, capability=OPERATOR, spending_limit_usd)` →
///      writes this PDA, captures `queued_at`, requires cosign when
///      `policy.cosign_required == true`.
///   2. `apply_agent_grant()` after `now - queued_at >= min_delay_seconds` →
///      pushes the agent into `vault.agents`, re-derives the policy preview
///      digest with the new `agent_set_hash`, bumps `policy.policy_version`,
///      and closes the pending PDA.
///
/// PDA seeds: `[b"pending_agent_grant", vault.key().as_ref()]`. There is at
/// most ONE pending OPERATOR grant per vault — `init` against a duplicate
/// pubkey rejects via the standard Anchor "account already in use" path,
/// mirroring `PendingOwnershipTransfer` and `PendingPolicyUpdate`.
#[account]
#[derive(Default)]
pub struct PendingAgentGrant {
    /// PDA-bound vault. Defense-in-depth duplicate of the seeds vault prefix.
    pub vault: Pubkey, // 32
    /// Agent pubkey being granted. Validated against the existing
    /// `vault.is_agent` set at apply time (the Anchor `init` of the PDA
    /// itself prevents double-queue per agent because the seed includes the
    /// vault only — apply also re-checks for double-registration).
    pub agent: Pubkey, // 32
    /// Target capability. Hard-rejected at queue time unless `>= CAPABILITY_OPERATOR`
    /// — this is the WHOLE POINT of the queued path. Stored as u8 for wire
    /// compatibility with `vault.agents[i].capability`.
    pub capability: u8, // 1
    /// Per-agent rolling-24h spend limit (USDC face value, 6 decimals).
    /// Mirrors `register_agent`'s arg.
    pub spending_limit_usd: u64, // 8
    /// `Clock::unix_timestamp` at queue time. Timelock enforced as
    /// `clock.unix_timestamp - queued_at >= min_delay_seconds`.
    pub queued_at: i64, // 8
    /// Owner-configurable timelock window (seconds). Defaults to
    /// `MIN_TIMELOCK_DURATION = 1800s = 30min` — owner has the full window
    /// to `cancel` if the queue was initiated by a phished key.
    pub min_delay_seconds: u64, // 8
    /// PDA bump.
    pub bump: u8, // 1
    /// 6-byte alignment cushion + additive headroom for future v1.1
    /// extensions (e.g. cooldown_seconds binding). Zero-init on `init`.
    pub _padding: [u8; 6], // 6
}

impl PendingAgentGrant {
    /// Account discriminator (8) + Pubkey×2 (64) + u8 (1) + u64 (8) +
    /// i64 (8) + u64 (8) + u8 (1) + padding[6] (6) = 104 bytes.
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 8 + 8 + 8 + 1 + 6;
}

// Compile-time pin — drift in the documented byte layout breaks the build.
// Mirrors the §RP-1 pattern used for `PendingOwnershipTransfer`.
const _PENDING_AGENT_GRANT_SIZE_PIN: () = assert!(
    PendingAgentGrant::SIZE == 104,
    "PendingAgentGrant::SIZE drifted from documented 104 bytes",
);
