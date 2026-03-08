use anchor_lang::prelude::*;

use crate::errors::PhalnxError;
use crate::state::tracker::{EPOCH_DURATION, NUM_EPOCHS, ROLLING_WINDOW_SECONDS};

/// Number of agent entries per overlay shard.
/// With 7 entries × ~1,184 bytes = 8,288 bytes of entry data.
pub const ENTRIES_PER_SHARD: usize = 7;

/// Per-agent contribution entry within a shard.
/// Tracks each agent's individual spend contributions using the same
/// 144-bucket epoch scheme as the global SpendTracker.
/// 32 (agent) + 8 * 144 (contributions) = 1,184 bytes
#[zero_copy]
pub struct AgentContributionEntry {
    /// Agent pubkey stored as raw bytes (zero_copy requires fixed-size)
    pub agent: [u8; 32],

    /// Per-epoch USD contributions from this agent (same indexing as SpendTracker buckets)
    pub contributions: [u64; NUM_EPOCHS],
}

/// Per-vault overlay PDA tracking per-agent spend contributions.
///
/// Seeds: `[b"agent_spend", vault.key().as_ref(), &[shard_index]]`
///
/// One shard supports up to 7 agents. The shard index (0-based) is stored
/// in AgentVault.treasury_shard. Currently only shard 0 is used.
///
/// Size calculation:
///   8 (discriminator) + 32 (vault) + 8 * 144 (sync_epochs) +
///   1,184 * 7 (entries) + 1 (bump) + 7 (padding) = 9,488 bytes
#[account(zero_copy)]
pub struct AgentSpendOverlay {
    /// Associated vault pubkey
    pub vault: Pubkey, // 32 bytes

    /// Per-epoch sync timestamps — used to detect stale epochs across all entries.
    /// When an epoch is stale (older than the current epoch), all agent contributions
    /// for that epoch index are zeroed during the next access.
    pub sync_epochs: [i64; NUM_EPOCHS], // 1,152 bytes

    /// Agent contribution entries (up to ENTRIES_PER_SHARD agents per shard)
    pub entries: [AgentContributionEntry; ENTRIES_PER_SHARD], // 8,288 bytes

    /// Bump seed for PDA
    pub bump: u8, // 1 byte

    /// Padding for 8-byte alignment
    pub _padding: [u8; 7], // 7 bytes
}
// Total data: 9,480 bytes + 8 (discriminator) = 9,488 bytes

impl AgentSpendOverlay {
    /// Total account size including 8-byte discriminator
    pub const SIZE: usize = 8 + 32 + (8 * NUM_EPOCHS) + (1184 * ENTRIES_PER_SHARD) + 1 + 7;
    // = 9,488

    /// Find the slot index for a given agent, or None if not present.
    pub fn find_agent_slot(&self, agent: &Pubkey) -> Option<usize> {
        let agent_bytes = agent.to_bytes();
        self.entries.iter().position(|e| e.agent == agent_bytes)
    }

    /// Claim an empty slot for a new agent. Returns the slot index, or None if full.
    /// An empty slot has agent == [0u8; 32].
    pub fn claim_slot(&mut self, agent: &Pubkey) -> Option<usize> {
        let zero = [0u8; 32];
        if let Some(idx) = self.entries.iter().position(|e| e.agent == zero) {
            self.entries[idx].agent = agent.to_bytes();
            // contributions are already zero-initialized
            Some(idx)
        } else {
            None
        }
    }

    /// Sync stale epoch buckets for a given slot. Zeroes contributions for
    /// epochs that have rolled past the current window.
    fn sync_and_zero_if_stale(&mut self, clock: &Clock, slot_idx: usize) {
        if clock.unix_timestamp <= 0 {
            return;
        }
        let current_epoch = clock.unix_timestamp / EPOCH_DURATION;
        for i in 0..NUM_EPOCHS {
            let sync_epoch = self.sync_epochs[i];
            if sync_epoch != current_epoch {
                // This epoch index is stale — zero out contributions for this agent
                self.entries[slot_idx].contributions[i] = 0;
            }
        }
    }

    /// Get the rolling 24h USD spend for a specific agent, with boundary correction.
    /// Mirrors SpendTracker::get_rolling_24h_usd but for a single agent.
    pub fn get_agent_rolling_24h_usd(&self, clock: &Clock, slot_idx: usize) -> u64 {
        if clock.unix_timestamp <= 0 || slot_idx >= ENTRIES_PER_SHARD {
            return 0;
        }
        let current_epoch = clock.unix_timestamp / EPOCH_DURATION;
        let window_start_ts = clock.unix_timestamp.saturating_sub(ROLLING_WINDOW_SECONDS);
        let mut total: u128 = 0;

        for i in 0..NUM_EPOCHS {
            let contribution = self.entries[slot_idx].contributions[i];
            if contribution == 0 {
                continue;
            }

            // Use sync_epochs to determine the epoch_id for this bucket index
            let epoch_id = self.sync_epochs[i];
            let bucket_start = epoch_id.saturating_mul(EPOCH_DURATION);
            let bucket_end = bucket_start.saturating_add(EPOCH_DURATION);

            if bucket_end <= window_start_ts || epoch_id > current_epoch {
                continue; // outside window
            }

            if bucket_start >= window_start_ts {
                total = total.saturating_add(contribution as u128);
            } else {
                // Boundary — proportional scaling
                let overlap = bucket_end.checked_sub(window_start_ts).unwrap() as u128;
                let scaled = (contribution as u128)
                    .saturating_mul(overlap)
                    .checked_div(EPOCH_DURATION as u128)
                    .unwrap();
                total = total.saturating_add(scaled);
            }
        }

        if total > u64::MAX as u128 {
            u64::MAX
        } else {
            total as u64
        }
    }

    /// Record an agent's spend contribution in the current epoch.
    pub fn record_agent_contribution(
        &mut self,
        clock: &Clock,
        slot_idx: usize,
        usd_amount: u64,
    ) -> Result<()> {
        if slot_idx >= ENTRIES_PER_SHARD {
            return Ok(()); // silently skip if invalid slot
        }

        // Sync stale epochs first
        self.sync_and_zero_if_stale(clock, slot_idx);

        let current_epoch = clock.unix_timestamp / EPOCH_DURATION;
        let idx = (current_epoch % NUM_EPOCHS as i64) as usize;

        // Update sync epoch for this bucket
        self.sync_epochs[idx] = current_epoch;

        // Add contribution
        self.entries[slot_idx].contributions[idx] = self.entries[slot_idx].contributions[idx]
            .checked_add(usd_amount)
            .ok_or(error!(PhalnxError::Overflow))?;

        Ok(())
    }
}
