//! Oracle price parsing for Pyth and Switchboard.
//!
//! Supports two oracle types, detected at runtime by account owner:
//!   - **Pyth Receiver** (`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`):
//!     PriceUpdateV2 manual byte parsing.
//!   - **Switchboard On-Demand** (`SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv`):
//!     PullFeed manual byte parsing (submissions array + median).
//!
//! Both parsers return an i128 mantissa with 18 implicit decimals so that
//! `oracle_price_to_usd()` in validate_and_authorize works unchanged.
//!
//! No external crate dependencies — all byte layouts are inlined.

use anchor_lang::prelude::*;

use crate::errors::AgentShieldError;
use crate::state::{
    MAX_CONFIDENCE_BPS, MAX_ORACLE_STALE_SLOTS, MIN_ORACLE_SAMPLES, PYTH_RECEIVER_PROGRAM,
    SWITCHBOARD_ON_DEMAND_PROGRAM,
};

// ─── Oracle source enum ─────────────────────────────────────────────────────

/// Identifies which oracle provided the price.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum OracleSource {
    Pyth = 0,
    Switchboard = 1,
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

/// Parse an oracle price from the provided account, auto-detecting the
/// oracle type by checking the account owner program.
///
/// Returns the price as an i128 mantissa with 18 implicit decimals
/// (same format for both Pyth and Switchboard), plus the oracle source.
pub fn parse_oracle_price(
    account_info: &AccountInfo,
    expected_feed: &Pubkey,
    current_slot: u64,
) -> Result<(i128, OracleSource)> {
    if *account_info.owner == PYTH_RECEIVER_PROGRAM {
        let price = parse_pyth_price(account_info, expected_feed, current_slot)?;
        Ok((price, OracleSource::Pyth))
    } else if *account_info.owner == SWITCHBOARD_ON_DEMAND_PROGRAM {
        let price = parse_switchboard_price(
            account_info,
            expected_feed,
            MAX_ORACLE_STALE_SLOTS as u64,
            MIN_ORACLE_SAMPLES,
            current_slot,
        )?;
        Ok((price, OracleSource::Switchboard))
    } else {
        Err(error!(AgentShieldError::OracleUnsupportedType))
    }
}

// ─── Pyth PriceUpdateV2 parsing ──────────────────────────────────────────────
//
// Borsh-serialized layout (no alignment padding):
//
//   Offset   0: discriminator      [8 bytes]
//   Offset   8: write_authority     [32 bytes]  (Pubkey)
//   Offset  40: verification_level  [1 byte]    (0=Partial, 1=Full)
//   Offset  41: feed_id             [32 bytes]
//   Offset  73: price               [8 bytes]   (i64, LE)
//   Offset  81: conf                [8 bytes]   (u64, LE)
//   Offset  89: exponent            [4 bytes]   (i32, LE)
//   Offset  93: publish_time        [8 bytes]   (i64, LE — unix seconds)
//   Offset 101: prev_publish_time   [8 bytes]
//   Offset 109: ema_price           [8 bytes]
//   Offset 117: ema_conf            [8 bytes]
//   Offset 125: posted_slot         [8 bytes]
//   Total: 133 bytes minimum

const PYTH_MIN_SIZE: usize = 133;
const PYTH_VERIFICATION_OFFSET: usize = 40;
const PYTH_PRICE_OFFSET: usize = 73;
const PYTH_CONF_OFFSET: usize = 81;
const PYTH_EXPONENT_OFFSET: usize = 89;
const PYTH_POSTED_SLOT_OFFSET: usize = 125;

/// Parse a Pyth PriceUpdateV2 account and return the price as an i128
/// mantissa with 18 implicit decimals.
///
/// # Security
/// - Account key must match `expected_feed`
/// - Account owner must be PYTH_RECEIVER_PROGRAM (checked by dispatcher)
/// - Verification level must be Full (1) — Wormhole-verified
/// - Staleness: `posted_slot` must be within `MAX_ORACLE_STALE_SLOTS` of current slot
/// - Confidence: `conf / |price|` must be ≤ `MAX_CONFIDENCE_BPS` (10%)
/// - Price must be positive
fn parse_pyth_price(
    account_info: &AccountInfo,
    expected_feed: &Pubkey,
    current_slot: u64,
) -> Result<i128> {
    // 1. Key must match expected feed
    require!(
        account_info.key() == *expected_feed,
        AgentShieldError::OracleFeedInvalid
    );

    let data = account_info.try_borrow_data()?;

    // 2. Minimum size
    require!(
        data.len() >= PYTH_MIN_SIZE,
        AgentShieldError::OracleFeedInvalid
    );

    // 3. Verification level must be Full (1)
    let verification_level = data[PYTH_VERIFICATION_OFFSET];
    require!(verification_level == 1, AgentShieldError::OracleNotVerified);

    // 4. Read price fields
    let price = i64::from_le_bytes(
        data[PYTH_PRICE_OFFSET..PYTH_PRICE_OFFSET + 8]
            .try_into()
            .map_err(|_| error!(AgentShieldError::OracleFeedInvalid))?,
    );
    let conf = u64::from_le_bytes(
        data[PYTH_CONF_OFFSET..PYTH_CONF_OFFSET + 8]
            .try_into()
            .map_err(|_| error!(AgentShieldError::OracleFeedInvalid))?,
    );
    let exponent = i32::from_le_bytes(
        data[PYTH_EXPONENT_OFFSET..PYTH_EXPONENT_OFFSET + 4]
            .try_into()
            .map_err(|_| error!(AgentShieldError::OracleFeedInvalid))?,
    );
    let posted_slot = u64::from_le_bytes(
        data[PYTH_POSTED_SLOT_OFFSET..PYTH_POSTED_SLOT_OFFSET + 8]
            .try_into()
            .map_err(|_| error!(AgentShieldError::OracleFeedInvalid))?,
    );

    // 5. Staleness check (slot-based, same as Switchboard)
    let min_slot = current_slot.saturating_sub(MAX_ORACLE_STALE_SLOTS as u64);
    require!(posted_slot >= min_slot, AgentShieldError::OracleFeedStale);

    // 6. Price must be positive
    require!(price > 0, AgentShieldError::OracleFeedInvalid);

    // 7. Confidence check: conf * 10000 / price <= MAX_CONFIDENCE_BPS
    let conf_ratio = (conf as u128)
        .checked_mul(10_000)
        .ok_or(AgentShieldError::Overflow)?
        .checked_div(price as u128)
        .ok_or(AgentShieldError::Overflow)?;
    require!(
        conf_ratio <= MAX_CONFIDENCE_BPS as u128,
        AgentShieldError::OracleConfidenceTooWide
    );

    // 8. Normalize to i128 with 18 implicit decimals.
    //    Pyth: price * 10^exponent = USD price.
    //    Normalized: price * 10^(18 + exponent).
    //    exponent is typically -8, so 10^(18 + (-8)) = 10^10.
    let norm_exp = 18i32
        .checked_add(exponent)
        .ok_or(AgentShieldError::Overflow)?;
    require!(norm_exp >= 0, AgentShieldError::OracleFeedInvalid);

    let multiplier = 10i128
        .checked_pow(norm_exp as u32)
        .ok_or(AgentShieldError::Overflow)?;
    let normalized = (price as i128)
        .checked_mul(multiplier)
        .ok_or(AgentShieldError::Overflow)?;

    require!(normalized > 0, AgentShieldError::OracleFeedInvalid);

    Ok(normalized)
}

// ─── Switchboard PullFeed parsing ────────────────────────────────────────────
//
// Layout reference: switchboard-on-demand v0.11.3, `#[repr(C)]` on SBF
// (max alignment = 8 bytes):
//
//   OracleSubmission (64 bytes, stride 64):
//     offset  0: oracle    (Pubkey, 32 bytes)
//     offset 32: slot      (u64, 8 bytes)
//     offset 40: _padding0 ([u8; 8])
//     offset 48: value     (i128, 16 bytes — price with 18 implicit decimals)

/// Number of oracle submissions in a PullFeed account
const SUBMISSION_COUNT: usize = 32;

/// Byte size of one OracleSubmission (repr(C) on SBF)
const SUBMISSION_STRIDE: usize = 64;

/// Byte offset of `slot` (u64) within an OracleSubmission
const SUBMISSION_SLOT_OFFSET: usize = 32;

/// Byte offset of `value` (i128) within an OracleSubmission
const SUBMISSION_VALUE_OFFSET: usize = 48;

/// Byte offset of `oracle` (Pubkey) within an OracleSubmission
const SUBMISSION_ORACLE_OFFSET: usize = 0;

/// Size of the Anchor discriminator
const DISCRIMINATOR_SIZE: usize = 8;

/// Minimum account data size: discriminator + 32 submissions
const MIN_PULL_FEED_SIZE: usize = DISCRIMINATOR_SIZE + SUBMISSION_COUNT * SUBMISSION_STRIDE;

/// Parse a Switchboard PullFeed account and return the median price
/// as an i128 mantissa with 18 implicit decimals.
///
/// # Security
/// - `expected_feed`: must match account key (set by vault owner in PolicyConfig)
/// - Staleness: submissions older than `max_stale_slots` are ignored
/// - Minimum samples: at least `min_samples` valid submissions required
/// - Positive price: median must be > 0
pub fn parse_switchboard_price(
    account_info: &AccountInfo,
    expected_feed: &Pubkey,
    max_stale_slots: u64,
    min_samples: u32,
    current_slot: u64,
) -> Result<i128> {
    // 1. Validate account key matches the oracle_feed stored in PolicyConfig
    require!(
        account_info.key() == *expected_feed,
        AgentShieldError::OracleFeedInvalid
    );

    let data = account_info.try_borrow_data()?;

    // 2. Validate minimum size
    require!(
        data.len() >= MIN_PULL_FEED_SIZE,
        AgentShieldError::OracleFeedInvalid
    );

    // 3. Read valid submissions into a fixed-size buffer
    let mut values = [0i128; SUBMISSION_COUNT];
    let mut count: usize = 0;
    let min_slot = current_slot.saturating_sub(max_stale_slots);

    for i in 0..SUBMISSION_COUNT {
        let base = DISCRIMINATOR_SIZE + i * SUBMISSION_STRIDE;

        // Skip empty submission slots (oracle pubkey is all zeros)
        let oracle_end = base + SUBMISSION_ORACLE_OFFSET + 32;
        if data[base..oracle_end].iter().all(|&b| b == 0) {
            continue;
        }

        // Read slot (u64, little-endian)
        let slot_start = base + SUBMISSION_SLOT_OFFSET;
        let slot = u64::from_le_bytes(
            data[slot_start..slot_start + 8]
                .try_into()
                .map_err(|_| error!(AgentShieldError::OracleFeedInvalid))?,
        );

        // Read value (i128, little-endian)
        let value_start = base + SUBMISSION_VALUE_OFFSET;
        let value = i128::from_le_bytes(
            data[value_start..value_start + 16]
                .try_into()
                .map_err(|_| error!(AgentShieldError::OracleFeedInvalid))?,
        );

        // Filter: must be recent slot AND positive value
        if slot >= min_slot && value > 0 {
            values[count] = value;
            count += 1;
        }
    }

    // 4. Minimum samples check
    require!(
        count as u32 >= min_samples,
        AgentShieldError::OracleFeedStale
    );

    // 5. Sort valid values and compute median
    let valid = &mut values[..count];
    valid.sort_unstable();

    let mid = count / 2;
    let median = if count % 2 == 0 && count > 1 {
        // Even number of samples: average the two middle values
        valid[mid - 1]
            .checked_add(valid[mid])
            .ok_or(AgentShieldError::Overflow)?
            .checked_div(2)
            .ok_or(AgentShieldError::Overflow)?
    } else {
        valid[mid]
    };

    // 6. Final sanity: price must be positive
    require!(median > 0, AgentShieldError::OracleFeedInvalid);

    Ok(median)
}
