use anchor_lang::prelude::*;

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
}

impl PendingConstraintsUpdate {
    // SIZE = 8 (disc) + 32 (vault) + 64*560 (entries) + 1+1+6 (flags+pad)
    //      + 8 (queued_at) + 8 (executes_at) + 8 (queued_at_slot)
    // = 8 + 32 + 35840 + 8 + 24 = 35,912 bytes (unchanged — padding absorbed the byte)
    pub const SIZE: usize = 8 + 32 + (560 * MAX_CONSTRAINT_ENTRIES) + 1 + 1 + 6 + 8 + 8 + 8;

    /// Returns true if the timelock period has expired and the update
    /// can be applied.
    pub fn is_ready(&self, current_timestamp: i64) -> bool {
        current_timestamp >= self.executes_at
    }
}
