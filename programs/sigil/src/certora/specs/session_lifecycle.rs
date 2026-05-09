// CVLR Specification: Session PDA Lifecycle
//
// Verifies properties of SessionAuthority::calculate_expiry() by calling
// the actual program function with nondeterministic inputs.
//
// Audit F5-H1: enforcement is now wall-clock based (unix_timestamp i64),
// no longer slot-based (u64). The arithmetic invariants below are unchanged
// modulo the type and saturation domain.

use crate::state::{
    SessionAuthority, MAX_OWNER_SESSION_DURATION_SECONDS, SESSION_DURATION_SECONDS,
};
use cvlr::prelude::*;

// ─────────────────────────────────────────────────────────────────
// Rule 1: calculate_expiry never returns less than the input timestamp
//
// SessionAuthority::calculate_expiry uses saturating_add on i64, so the
// result is always >= now_ts (never wraps backward).
// ─────────────────────────────────────────────────────────────────

#[rule]
pub fn rule_expiry_at_least_now_ts() {
    let now_ts: i64 = nondet();
    cvlr_assume!(now_ts >= 0); // Solana unix_timestamp is always non-negative.
    let expires = SessionAuthority::calculate_expiry(now_ts, SESSION_DURATION_SECONDS as u64);
    cvlr_assert!(expires >= now_ts);
}

// ─────────────────────────────────────────────────────────────────
// Rule 2: calculate_expiry equals now_ts.saturating_add(capped seconds)
//
// Verifies the implementation matches the specification exactly.
// `owner_max_seconds` is capped at MAX_OWNER_SESSION_DURATION_SECONDS
// internally as defense-in-depth; for the default (30s) this cap is a no-op.
// ─────────────────────────────────────────────────────────────────

#[rule]
pub fn rule_expiry_equals_saturating_add() {
    let now_ts: i64 = nondet();
    cvlr_assume!(now_ts >= 0);
    let expires = SessionAuthority::calculate_expiry(now_ts, SESSION_DURATION_SECONDS as u64);
    cvlr_assert!(expires == now_ts.saturating_add(SESSION_DURATION_SECONDS));
}

// ─────────────────────────────────────────────────────────────────
// Rule 3: Session is guaranteed expired after the window
//
// For any creation timestamp T (not near i64::MAX), the session must
// be expired at timestamp T + SESSION_DURATION_SECONDS + 1.
// ─────────────────────────────────────────────────────────────────

#[rule]
pub fn rule_session_expires_after_window() {
    let creation_ts: i64 = nondet();
    cvlr_assume!(creation_ts >= 0);
    cvlr_assume!(creation_ts < i64::MAX - SESSION_DURATION_SECONDS);

    let expires_at =
        SessionAuthority::calculate_expiry(creation_ts, SESSION_DURATION_SECONDS as u64);
    let after_window = creation_ts + SESSION_DURATION_SECONDS + 1;

    // is_expired checks: current_unix_ts > expires_at_timestamp
    cvlr_assert!(after_window > expires_at);
}

// ─────────────────────────────────────────────────────────────────
// Rule 4: Session is not expired at creation timestamp
//
// A freshly created session must NOT be expired at the timestamp it
// was created at (creation_ts <= expires_at).
// ─────────────────────────────────────────────────────────────────

#[rule]
pub fn rule_session_valid_at_creation() {
    let creation_ts: i64 = nondet();
    cvlr_assume!(creation_ts >= 0);
    let expires_at =
        SessionAuthority::calculate_expiry(creation_ts, SESSION_DURATION_SECONDS as u64);

    // is_expired = current_unix_ts > expires_at_timestamp
    // At creation_ts, this must be false
    cvlr_assert!(creation_ts <= expires_at);
}

// ─────────────────────────────────────────────────────────────────
// Rule 5: Saturation at i64::MAX
//
// When now_ts is near i64::MAX, calculate_expiry must saturate to
// i64::MAX rather than wrapping around. Uses concrete values to avoid
// prover sanity-check issues with nondeterministic assumptions near MAX.
// ─────────────────────────────────────────────────────────────────

#[rule]
pub fn rule_expiry_saturates_at_max() {
    // i64::MAX itself must saturate
    let expires_max = SessionAuthority::calculate_expiry(i64::MAX, SESSION_DURATION_SECONDS as u64);
    cvlr_assert!(expires_max == i64::MAX);

    // i64::MAX - 10 is within the saturation zone (< SESSION_DURATION_SECONDS away from MAX)
    let expires_near =
        SessionAuthority::calculate_expiry(i64::MAX - 10, SESSION_DURATION_SECONDS as u64);
    cvlr_assert!(expires_near == i64::MAX);
}

// ─────────────────────────────────────────────────────────────────
// Rule 6: Owner-configured duration is silently capped at the maximum
//
// Even if a caller bypasses queue_policy_update bounds checking,
// calculate_expiry caps the duration at MAX_OWNER_SESSION_DURATION_SECONDS.
// This is defense-in-depth against the F5-H1 vulnerability.
// ─────────────────────────────────────────────────────────────────

#[rule]
pub fn rule_owner_duration_capped() {
    let now_ts: i64 = nondet();
    cvlr_assume!(now_ts >= 0);
    cvlr_assume!(now_ts < i64::MAX - MAX_OWNER_SESSION_DURATION_SECONDS as i64);

    // Attempt to set an excessive duration far beyond the cap
    let huge_duration: u64 = nondet();
    cvlr_assume!(huge_duration > MAX_OWNER_SESSION_DURATION_SECONDS);
    let expires = SessionAuthority::calculate_expiry(now_ts, huge_duration);

    // Result must equal the capped value, not the requested value.
    cvlr_assert!(expires == now_ts + MAX_OWNER_SESSION_DURATION_SECONDS as i64);
}
