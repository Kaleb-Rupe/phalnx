use crate::errors::SigilError;
use crate::state::MAX_ALLOWED_PROTOCOLS;
use anchor_lang::prelude::*;

/// 10-minute epoch duration in seconds
pub const EPOCH_DURATION: i64 = 600;

/// Number of epochs in a 24-hour window (144 × 10 min = 24h)
pub const NUM_EPOCHS: usize = 144;

/// Rolling window duration in seconds (24 hours)
pub const ROLLING_WINDOW_SECONDS: i64 = 86_400;

/// TA-14 (Phase 5 post-exec): maximum tracked recipients per vault.
/// Fixed-size array — Vec NOT permitted in zero-copy account per F-14.
/// 10 simultaneous unique recipients per rolling 24h window. When all
/// 10 slots are within their windows and an 11th unique recipient
/// appears, the call rejects (NEVER LRU/churn-eviction — per §RP
/// requirement, ONLY age-based eviction permitted).
pub const MAX_PER_RECIPIENT_ENTRIES: usize = 10;

/// Zero-copy 144-epoch circular buffer for rolling 24h USD spend tracking.
/// Each bucket covers a 10-minute epoch. Boundary correction ensures
/// functionally exact accuracy (~$0.000001 worst-case rounding).
/// Rounding direction: slightly permissive (under-counts by at most $0.000001).
///
/// Seeds: `[b"tracker", vault.key().as_ref()]`
#[account(zero_copy)]
pub struct SpendTracker {
    /// Associated vault pubkey
    pub vault: Pubkey, // 32 bytes

    /// 144 epoch buckets for rolling 24h spend tracking
    pub buckets: [EpochBucket; NUM_EPOCHS], // 2,304 bytes (144 × 16)

    /// Per-protocol rolling 24h counters. Enforcement wired in
    /// `finalize_session.rs:313-322` (stablecoin input) and lines 401-411
    /// (non-stablecoin input). See `policy.protocol_caps` for the cap
    /// values and `PolicyConfig::get_protocol_cap` for the lookup logic.
    /// Per-protocol entries are populated by `record_protocol_spend()`
    /// when `policy.has_protocol_caps == true`.
    ///
    /// TA-13 ratification (Phase 5): the prior doc-comment claimed
    /// "zeroed, no enforcement yet" — this was stale. The enforcement
    /// has lived in `finalize_session` since Phase 2; this comment was
    /// the only artifact suggesting otherwise.
    pub protocol_counters: [ProtocolSpendCounter; MAX_ALLOWED_PROTOCOLS], // 480 bytes (10 × 48)

    /// Epoch of most recent record_spend() call. Enables early exit in get_rolling_24h_usd().
    /// Zero-initialized — value 0 correctly triggers early exit (current_epoch >> 144).
    pub last_write_epoch: i64, // 8 bytes

    /// Bump seed for PDA
    pub bump: u8, // 1 byte

    /// Padding for 8-byte alignment
    pub _padding: [u8; 7], // 7 bytes

    /// TA-14 (Phase 5 post-exec invariant #2): per-recipient rolling 24h
    /// outflow counters. Bounded to `MAX_PER_RECIPIENT_ENTRIES` (10)
    /// entries — Vec NOT permitted in zero-copy account per F-14.
    /// 10 × 48 = 480 bytes. Each entry tracks one recipient pubkey
    /// (resolved from the SPL TokenAccount.owner field — NOT the ATA
    /// pubkey) and their rolling-24h outflow USD total.
    pub per_recipient: [PerRecipientCounter; MAX_PER_RECIPIENT_ENTRIES], // 480 bytes

    /// TA-14 (Phase 5): how many `per_recipient` slots are currently
    /// active. New entries occupy `per_recipient[per_recipient_count]`
    /// then this counter increments. Eviction is AGE-BASED only — slots
    /// whose 24h window has elapsed are eligible; LRU/churn-eviction is
    /// EXPLICITLY REJECTED per §RP requirement (prevents an attacker
    /// recycling slots by paying many distinct recipients to bypass
    /// the cap).
    pub per_recipient_count: u8, // 1 byte

    /// Padding for 8-byte alignment after the new u8 counter.
    pub _padding_recipient: [u8; 7], // 7 bytes
}
// Total data: 2,824 + 480 + 1 + 7 = 3,312 bytes
//             + 8 (discriminator) = 3,320 bytes

/// A single epoch bucket tracking aggregate USD spend.
/// 16 bytes per bucket. USD-only — rate limiting stays client-side.
#[derive(Default)]
#[zero_copy]
pub struct EpochBucket {
    /// Epoch identifier: unix_timestamp / EPOCH_DURATION
    pub epoch_id: i64, // 8 bytes

    /// Aggregate USD spent in this epoch (6 decimals)
    pub usd_amount: u64, // 8 bytes
}

/// Per-protocol spend counter using simple 24h window.
/// When current_epoch - window_start >= 144, the window is expired and resets to 0.
/// 48 bytes per entry (32 + 8 + 8).
#[zero_copy]
pub struct ProtocolSpendCounter {
    /// Protocol program ID
    pub protocol: [u8; 32],
    /// Window start timestamp (for future rolling window)
    pub window_start: i64,
    /// Accumulated spend in window (for future cap enforcement)
    pub window_spend: u64,
}

/// TA-14 (Phase 5 post-exec): per-recipient rolling 24h outflow counter.
/// 48 bytes per entry (32 + 8 + 8).
///
/// `recipient` is resolved from the SPL TokenAccount.owner field — NOT
/// the ATA pubkey. The §RP brief explicitly flags ATA-vs-owner confusion
/// as the attack class to defend against.
///
/// `window_start` is the Unix timestamp at which the current 24h window
/// began. When `now - window_start >= 86400` the slot is eligible for
/// age-based eviction.
///
/// `window_spend_usd` is the accumulated 6-decimal USDC face value spent
/// to this recipient in the active window.
#[zero_copy]
#[repr(C)]
pub struct PerRecipientCounter {
    /// Recipient wallet pubkey (NOT the ATA pubkey — Pod-compatible
    /// `[u8; 32]` since zero-copy accounts can't hold Pubkey directly).
    pub recipient: [u8; 32],
    /// Unix timestamp at which the active rolling 24h window started.
    /// Zero indicates an empty slot.
    pub window_start: i64,
    /// Accumulated 6-decimal USDC face value spent to `recipient` in
    /// the active 24h window.
    pub window_spend_usd: u64,
}

impl SpendTracker {
    /// Total account size including 8-byte discriminator.
    /// 8 disc + 32 vault + 144*16 buckets + 10*48 protocol_counters +
    /// 8 last_write_epoch + 1 bump + 7 pad +
    /// 10*48 per_recipient + 1 per_recipient_count + 7 pad
    /// = 8 + 32 + 2304 + 480 + 8 + 1 + 7 + 480 + 1 + 7 = 3328 bytes
    pub const SIZE: usize = 8
        + 32
        + (16 * NUM_EPOCHS)
        + (48 * MAX_ALLOWED_PROTOCOLS)
        + 8
        + 1
        + 7
        + (48 * MAX_PER_RECIPIENT_ENTRIES) // [TA-14] per_recipient
        + 1 // per_recipient_count
        + 7; // _padding_recipient

    /// Record a spend in the current epoch bucket.
    /// If the bucket is from a different epoch, reset it first.
    pub fn record_spend(&mut self, clock: &Clock, usd_amount: u64) -> Result<()> {
        require!(clock.unix_timestamp > 0, SigilError::Overflow);
        // Safe: EPOCH_DURATION is a non-zero constant (600)
        let current_epoch = clock.unix_timestamp.checked_div(EPOCH_DURATION).unwrap();
        let idx = (current_epoch % NUM_EPOCHS as i64) as usize;

        if self.buckets[idx].epoch_id != current_epoch {
            self.buckets[idx] = EpochBucket {
                epoch_id: current_epoch,
                usd_amount: 0,
            };
        }

        self.buckets[idx].usd_amount = self.buckets[idx]
            .usd_amount
            .checked_add(usd_amount)
            .ok_or(error!(SigilError::Overflow))?;

        self.last_write_epoch = current_epoch;

        Ok(())
    }

    /// Get the rolling 24h USD spend total with boundary correction.
    ///
    /// Iterates all 144 buckets, summing those within the 24h window.
    /// The oldest bucket that straddles the window boundary is
    /// proportionally scaled for functionally exact accuracy.
    /// Worst-case rounding error: $0.000001 (1 unit at 6 decimals).
    pub fn get_rolling_24h_usd(&self, clock: &Clock) -> u64 {
        if clock.unix_timestamp <= 0 {
            return 0;
        }
        // Safe: EPOCH_DURATION is a non-zero constant (600)
        let current_epoch = clock.unix_timestamp.checked_div(EPOCH_DURATION).unwrap();

        // Early exit: if no writes in 144+ epochs, all data is expired
        if current_epoch - self.last_write_epoch > NUM_EPOCHS as i64 {
            return 0;
        }

        let window_start_ts = clock.unix_timestamp.saturating_sub(ROLLING_WINDOW_SECONDS);
        let mut total: u128 = 0;

        for bucket in &self.buckets {
            if bucket.usd_amount == 0 {
                continue;
            }

            let bucket_start = bucket.epoch_id.saturating_mul(EPOCH_DURATION);
            let bucket_end = bucket_start.saturating_add(EPOCH_DURATION);

            if bucket_end <= window_start_ts || bucket.epoch_id > current_epoch {
                continue; // entirely outside window
            }

            if bucket_start >= window_start_ts {
                // Fully inside window — count 100%
                total = total.saturating_add(bucket.usd_amount as u128);
            } else {
                // Boundary bucket — proportional scaling
                // Safe: bucket_end > window_start_ts (checked above), EPOCH_DURATION non-zero
                let overlap = bucket_end.checked_sub(window_start_ts).unwrap() as u128;
                let scaled = (bucket.usd_amount as u128)
                    .saturating_mul(overlap)
                    .checked_div(EPOCH_DURATION as u128)
                    .unwrap();
                total = total.saturating_add(scaled);
            }
        }

        // Cap at u64::MAX
        if total > u64::MAX as u128 {
            u64::MAX
        } else {
            total as u64
        }
    }

    /// Get per-protocol spend within the current simple 24h window.
    /// Returns 0 if no counter exists or window has expired (>= 144 epochs old).
    ///
    /// KNOWN LIMITATION: Uses a simple 24h window (resets entirely on expiry),
    /// not the proportional boundary correction used by the global rolling cap.
    /// At the window boundary, accumulated per-protocol spend resets to 0,
    /// allowing brief overspend relative to the per-protocol cap. The global
    /// rolling cap (get_rolling_24h_usd) provides the primary enforcement and
    /// is NOT subject to this reset behavior.
    pub fn get_protocol_spend(&self, clock: &Clock, protocol_id: &Pubkey) -> u64 {
        if clock.unix_timestamp <= 0 {
            return 0;
        }
        let current_epoch = clock.unix_timestamp.checked_div(EPOCH_DURATION).unwrap();
        let protocol_bytes = protocol_id.to_bytes();

        for counter in &self.protocol_counters {
            if counter.protocol == protocol_bytes {
                // Check if window is still valid (< 144 epochs = 24h)
                if current_epoch - counter.window_start < NUM_EPOCHS as i64 {
                    return counter.window_spend;
                }
                return 0; // Window expired
            }
        }
        0 // No counter found
    }

    /// Record per-protocol spend. Finds or allocates a counter slot by protocol ID.
    /// Uses simple 24h window — resets entirely when window expires.
    ///
    /// KNOWN LIMITATION: Same simple-window behavior as get_protocol_spend().
    /// See that function's doc comment for details on the boundary reset behavior.
    pub fn record_protocol_spend(
        &mut self,
        clock: &Clock,
        protocol_id: &Pubkey,
        usd_amount: u64,
    ) -> Result<()> {
        require!(clock.unix_timestamp > 0, SigilError::Overflow);
        let current_epoch = clock.unix_timestamp.checked_div(EPOCH_DURATION).unwrap();
        let protocol_bytes = protocol_id.to_bytes();
        let empty_bytes = [0u8; 32];

        // Scan for existing counter or empty slot
        let mut empty_slot: Option<usize> = None;
        for i in 0..self.protocol_counters.len() {
            if self.protocol_counters[i].protocol == protocol_bytes {
                // Found existing counter
                if current_epoch - self.protocol_counters[i].window_start >= NUM_EPOCHS as i64 {
                    // Window expired — reset
                    self.protocol_counters[i].window_start = current_epoch;
                    self.protocol_counters[i].window_spend = usd_amount;
                } else {
                    // Window still valid — accumulate
                    self.protocol_counters[i].window_spend = self.protocol_counters[i]
                        .window_spend
                        .checked_add(usd_amount)
                        .ok_or(error!(SigilError::Overflow))?;
                }
                return Ok(());
            }
            if empty_slot.is_none() && self.protocol_counters[i].protocol == empty_bytes {
                empty_slot = Some(i);
            }
        }

        // Not found — allocate empty slot
        if let Some(idx) = empty_slot {
            self.protocol_counters[idx].protocol = protocol_bytes;
            self.protocol_counters[idx].window_start = current_epoch;
            self.protocol_counters[idx].window_spend = usd_amount;
            Ok(())
        } else {
            Err(error!(SigilError::ProtocolCapExceeded))
        }
    }

    /// TA-14 (Phase 5 post-exec invariant #2): get the rolling 24h
    /// outflow USD total to `recipient`. Returns 0 if the recipient has
    /// no active counter or the counter's window has elapsed.
    ///
    /// Window expiry: `now - counter.window_start >= 86400`. The counter
    /// is treated as inert when expired (returns 0 here); actual eviction
    /// happens in `record_recipient_spend()`.
    pub fn get_recipient_spend(&self, clock: &Clock, recipient: &Pubkey) -> u64 {
        if clock.unix_timestamp <= 0 {
            return 0;
        }
        let now = clock.unix_timestamp;
        let recipient_bytes = recipient.to_bytes();
        let active = (self.per_recipient_count as usize).min(self.per_recipient.len());
        for i in 0..active {
            let entry = &self.per_recipient[i];
            if entry.recipient == recipient_bytes {
                // Window expired → entry inert; report 0.
                if now.saturating_sub(entry.window_start) >= ROLLING_WINDOW_SECONDS {
                    return 0;
                }
                return entry.window_spend_usd;
            }
        }
        0
    }

    /// TA-14 (Phase 5): record `usd_amount` outflow to `recipient`.
    /// AGE-BASED eviction only — no LRU/churn-eviction permitted.
    ///
    /// Algorithm:
    ///   1. If the recipient already has a slot:
    ///      a. If the slot's window has elapsed (≥ 24h since window_start),
    ///         reset to a fresh window starting at `now` with
    ///         `window_spend_usd = usd_amount`.
    ///      b. Otherwise accumulate `usd_amount` into the active window
    ///         (checked add — `Overflow` on u64::MAX overflow).
    ///   2. If the recipient has no slot:
    ///      a. If `per_recipient_count < MAX_PER_RECIPIENT_ENTRIES`,
    ///         allocate the next free slot at index `per_recipient_count`
    ///         and increment.
    ///      b. Otherwise scan for an entry whose window has elapsed
    ///         (`now - window_start >= 86400`) — among eligible entries,
    ///         pick the one with the OLDEST `window_start`. Overwrite
    ///         it with the new recipient.
    ///      c. If NO entry has an elapsed window, REJECT with
    ///         `ErrRecipientCapExceeded`. Critical: this is the no-churn
    ///         guarantee — an attacker who has filled all 10 slots within
    ///         the last 24h cannot recycle them by paying new recipients.
    ///
    /// Caller is expected to perform the cap-vs-spend check BEFORE this
    /// record helper (so the cap rejection happens at the require! site
    /// in finalize_session, not inside this state mutator).
    pub fn record_recipient_spend(
        &mut self,
        clock: &Clock,
        recipient: &Pubkey,
        usd_amount: u64,
    ) -> Result<()> {
        require!(clock.unix_timestamp > 0, SigilError::Overflow);
        let now = clock.unix_timestamp;
        let recipient_bytes = recipient.to_bytes();
        let active = (self.per_recipient_count as usize).min(self.per_recipient.len());

        // 1) Existing slot path
        for i in 0..active {
            if self.per_recipient[i].recipient == recipient_bytes {
                let window_age = now.saturating_sub(self.per_recipient[i].window_start);
                if window_age >= ROLLING_WINDOW_SECONDS {
                    // Window elapsed — reset to fresh window. NOT churn-
                    // eviction (same recipient is restarting their own
                    // window after natural expiry, which the no-churn
                    // rule explicitly permits).
                    self.per_recipient[i].window_start = now;
                    self.per_recipient[i].window_spend_usd = usd_amount;
                } else {
                    // Accumulate into active window.
                    self.per_recipient[i].window_spend_usd = self.per_recipient[i]
                        .window_spend_usd
                        .checked_add(usd_amount)
                        .ok_or(error!(SigilError::Overflow))?;
                }
                return Ok(());
            }
        }

        // 2a) Allocate new slot if any are free
        if active < MAX_PER_RECIPIENT_ENTRIES {
            let idx = active;
            self.per_recipient[idx].recipient = recipient_bytes;
            self.per_recipient[idx].window_start = now;
            self.per_recipient[idx].window_spend_usd = usd_amount;
            self.per_recipient_count = self
                .per_recipient_count
                .checked_add(1)
                .ok_or(error!(SigilError::Overflow))?;
            return Ok(());
        }

        // 2b) Array full — AGE-BASED eviction. Scan ALL slots looking
        // for entries with elapsed windows. Among eligible entries,
        // pick the one with the OLDEST window_start.
        let mut oldest_idx: Option<usize> = None;
        let mut oldest_ts: i64 = i64::MAX;
        for i in 0..MAX_PER_RECIPIENT_ENTRIES {
            let entry_age = now.saturating_sub(self.per_recipient[i].window_start);
            if entry_age >= ROLLING_WINDOW_SECONDS {
                // Eligible — pick the oldest.
                if self.per_recipient[i].window_start < oldest_ts {
                    oldest_idx = Some(i);
                    oldest_ts = self.per_recipient[i].window_start;
                }
            }
        }

        // 2c) No eligible slot — REJECT. Defends against churn-eviction.
        let Some(idx) = oldest_idx else {
            return Err(error!(SigilError::ErrRecipientCapExceeded));
        };

        // Evict and install the new recipient.
        self.per_recipient[idx].recipient = recipient_bytes;
        self.per_recipient[idx].window_start = now;
        self.per_recipient[idx].window_spend_usd = usd_amount;
        Ok(())
    }
}
