use anchor_lang::prelude::*;
// Note: `anchor_lang::solana_program::hash` is NOT re-exported in Anchor 0.32.1.
// Use the `solana-program` direct dep (declared in Cargo.toml) — same
// pattern as `utils/policy_digest.rs`.
use solana_program::hash::hash as sha256_hash;

use super::constraints::{ConstraintEntryZC, MAX_CONSTRAINT_ENTRIES};

/// Queued instruction constraints update that becomes executable after
/// a timelock period. Mirrors `PendingPolicyUpdate` pattern.
///
/// PDA seeds: `[b"pending_constraints", vault.key().as_ref()]`
///
/// Zero-copy layout — same entries array as InstructionConstraints
/// plus queued_at and executes_at timestamps.
#[account(zero_copy)]
pub struct PendingConstraintsUpdate {
    /// Associated vault pubkey (as raw bytes for Pod compatibility)
    pub vault: [u8; 32],

    /// New constraint entries to apply (fixed array, use entry_count for active)
    pub entries: [ConstraintEntryZC; MAX_CONSTRAINT_ENTRIES],

    /// Number of active entries (0..=64)
    pub entry_count: u8,

    /// Bump seed for PDA
    pub bump: u8,

    /// Alignment padding. Total: 8+32+35840+1+1+6 = 35888, keeping queued_at at
    /// struct offset 35880 (8-aligned post-discriminator absolute 35888).
    pub _padding: [u8; 6],

    /// Unix timestamp when this update was queued
    pub queued_at: i64,

    /// Unix timestamp when this update becomes executable
    pub executes_at: i64,

    /// Slot number when this update was queued. Paired with `MAX_APPLY_AGE_SLOTS`
    /// to enforce a freshness ceiling — defends against durable-nonce pre-signing
    /// attacks (F-10 audit fix, Drift Protocol April 2026 $285M analog).
    /// Already 8-byte aligned (follows two i64 fields).
    pub queued_at_slot: u64,

    /// M-4 close (Bucket 2, Phase 10 PEN-CROSS-3): SHA-256 over the canonical
    /// byte encoding of the pending content (vault + entry_count + active
    /// entries[0..entry_count]). Written once at `queue_constraints_update`
    /// and re-asserted at `apply_constraints_update` before any byte is
    /// copied into the live `InstructionConstraints` PDA.
    ///
    /// Defense-in-depth against discriminator-collision overwrite of this
    /// pending PDA's body between queue and apply: even if a future bug
    /// allowed a same-seed CPI to rewrite the entries slab, the digest
    /// recorded at queue time pins the owner-attested content, and the
    /// apply-time recompute would diverge and reject with
    /// `ErrPendingConstraintsDigestMismatch`.
    ///
    /// Alignment: follows a u64 at struct offset 35896, so byte offset
    /// 35904..35936 is 8-aligned. `[u8; 32]` has alignment 1, no padding
    /// required.
    pub pending_content_digest: [u8; 32],
}

impl PendingConstraintsUpdate {
    // SIZE = 8 (disc) + 32 (vault) + 64*560 (entries) + 1+1+6 (flags+pad)
    //      + 8 (queued_at) + 8 (executes_at) + 8 (queued_at_slot)
    //      + 32 (pending_content_digest, M-4 Bucket 2 PEN-CROSS-3)
    // = 8 + 32 + 35840 + 8 + 24 + 32 = 35,944 bytes
    // (was 35,912 pre-M-4; +32 for the digest field.)
    pub const SIZE: usize = 8 + 32 + (560 * MAX_CONSTRAINT_ENTRIES) + 1 + 1 + 6 + 8 + 8 + 8 + 32;

    /// Returns true if the timelock period has expired and the update
    /// can be applied.
    pub fn is_ready(&self, current_timestamp: i64) -> bool {
        current_timestamp >= self.executes_at
    }
}

// M-4 close (Bucket 2, PEN-CROSS-3): compile-time pin on the documented byte
// layout. Mirrors the `_PENDING_AGENT_GRANT_SIZE_PIN` pattern used for
// `PendingAgentGrant`. Drift in `SIZE` (or in any field that contributes to
// it) breaks the build — this is the load-bearing reminder that any new
// field on `PendingConstraintsUpdate` MUST also be folded into the
// `canonical_bytes_of_pending_constraints` encoding below, else the
// queue/apply digest invariant silently regresses.
const _PENDING_CONSTRAINTS_SIZE_PIN: () = assert!(
    PendingConstraintsUpdate::SIZE == 35_944,
    "PendingConstraintsUpdate::SIZE drifted from documented 35,944 bytes (M-4 Bucket 2 PEN-CROSS-3 baseline)",
);

/// M-4 close (Bucket 2, Phase 10 PEN-CROSS-3) — canonical byte encoding of the
/// content fields of a `PendingConstraintsUpdate` PDA.
///
/// COVERS:
///   1. `vault: [u8; 32]`                       (32 bytes)
///   2. `entry_count: u8`                       (1 byte)
///   3. `entries[0..entry_count]`               (560 bytes per active entry, raw zero-copy bytes)
///
/// EXCLUDES (intentional — these are re-applied at apply time or are
/// timing-related and would defeat the apply-time recompute path):
///   - `_padding`        (alignment-only)
///   - `bump`            (re-derived by Anchor at apply time)
///   - `queued_at`       (timestamp, varies across SVM clock)
///   - `executes_at`     (derived from queued_at + timelock_duration)
///   - `queued_at_slot`  (slot-bounded freshness, independent invariant)
///   - `pending_content_digest` itself (the field being asserted)
///
/// The active-entry-range encoding (`entries[0..entry_count]`) lets the
/// digest reject ANY mutation to either the count OR the active entry
/// bytes. Inactive entries beyond `entry_count` are NOT bound — Anchor
/// validators ignore them, so a future zero-init drift in the trailing
/// slab cannot regress the digest invariant.
///
/// CALL SITES:
///   - `queue_constraints_update.rs`   — writes the digest after populating
///     the pending PDA. Recorded as the owner-attested content snapshot.
///   - `apply_constraints_update.rs`   — recomputes the digest from the
///     live pending PDA bytes and rejects with
///     `ErrPendingConstraintsDigestMismatch` if the recomputed value
///     diverges from the stored one. Constant-time compare via
///     `ct_eq_32` to deny timing side-channels.
pub fn canonical_bytes_of_pending_constraints(
    pending: &PendingConstraintsUpdate,
) -> Result<Vec<u8>> {
    // Pre-size: 32 (vault) + 1 (entry_count) + 64 * 560 (max entries slab)
    //         = 35,873 bytes worst-case. Active-only path is typically far
    // smaller; allocator picks the right capacity on first push.
    let count = pending.entry_count as usize;
    require!(
        count <= MAX_CONSTRAINT_ENTRIES,
        crate::errors::SigilError::InvalidConstraintConfig
    );

    let mut buf: Vec<u8> = Vec::with_capacity(32 + 1 + count * 560);

    // 1. vault: [u8; 32]
    buf.extend_from_slice(&pending.vault);
    // 2. entry_count: u8
    buf.push(pending.entry_count);
    // 3. entries[0..entry_count]: raw zero-copy byte slabs, 560 bytes each.
    //    bytemuck::bytes_of reinterprets the &ConstraintEntryZC as &[u8] of
    //    the exact struct size. The 560-byte invariant is held by a
    //    const-assert in `state/constraints.rs:357-361`.
    for entry in pending.entries.iter().take(count) {
        buf.extend_from_slice(bytemuck::bytes_of(entry));
    }

    Ok(buf)
}

/// M-4 close (Bucket 2, PEN-CROSS-3) — SHA-256 over the canonical encoding.
///
/// Wraps `canonical_bytes_of_pending_constraints` + solana_program::hash::hash.
/// Used by BOTH `queue_constraints_update` (record) and
/// `apply_constraints_update` (verify) to guarantee a deterministic
/// queue↔apply digest comparison.
pub fn compute_pending_constraints_digest(pending: &PendingConstraintsUpdate) -> Result<[u8; 32]> {
    let bytes = canonical_bytes_of_pending_constraints(pending)?;
    Ok(sha256_hash(&bytes).to_bytes())
}

/// M-4 / M-5 close (Bucket 2, PEN-CROSS-3) — constant-time equality on
/// 32-byte SHA-256 digests.
///
/// SHA-256 outputs are public values, but constant-time compare denies an
/// adversary the ability to amplify a partial-match timing signal via
/// CPI-failure-rate probing across many short-circuited bytes. The compare
/// is byte-by-byte XOR-then-OR-fold: every iteration unconditionally reads
/// both inputs, accumulates into `diff`, and finally checks `diff == 0`.
/// The BPF compiler does not specialise away the loop under release;
/// observed CU cost is ~30 CU vs ~8 CU for `==` on a 32-byte slice — the
/// load-bearing point is determinism, not raw speed.
#[inline]
pub fn ct_eq_32(a: &[u8; 32], b: &[u8; 32]) -> bool {
    let mut diff: u8 = 0;
    for i in 0..32 {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}
