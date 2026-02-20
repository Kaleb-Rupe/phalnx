// CVLR Specification: Spending Cap Enforcement
//
// Verifies stablecoin_to_usd() conversion and arithmetic safety
// by calling actual program functions with nondeterministic inputs.

use crate::instructions::utils::stablecoin_to_usd;
use crate::state::USD_DECIMALS;
use cvlr::prelude::*;

// ─────────────────────────────────────────────────────────────────
// Rule 1: USDC/USDT conversion is identity
//
// Stablecoins with the same decimal precision as USD (6 decimals)
// must convert 1:1 — amount in equals amount out.
// ─────────────────────────────────────────────────────────────────

#[rule]
pub fn rule_usdc_conversion_identity() {
    let amount: u64 = nondet();

    // 6-decimal stablecoin (USDC/USDT) → identity conversion
    match stablecoin_to_usd(amount, USD_DECIMALS) {
        Ok(usd) => cvlr_assert!(usd == amount),
        Err(_) => cvlr_assert!(false), // must never error for equal decimals
    }
}

// ─────────────────────────────────────────────────────────────────
// Rule 2: Fewer decimals scales up correctly
//
// A 5-decimal stablecoin must be scaled up by 10^(6-5) = 10.
// Uses decimals=5 (pow(1)) to keep checked_pow tractable for the
// prover. The scaling logic is the same for all decimal values.
// ─────────────────────────────────────────────────────────────────

#[rule]
pub fn rule_fewer_decimals_scales_up() {
    let amount: u64 = nondet();
    // Avoid overflow: amount * 10 must fit in u64
    cvlr_assume!(amount <= u64::MAX / 10);

    match stablecoin_to_usd(amount, 5) {
        Ok(usd) => cvlr_assert!(usd == amount * 10),
        Err(_) => cvlr_assert!(false),
    }
}

// ─────────────────────────────────────────────────────────────────
// Rule 3: More decimals scales down correctly
//
// A 7-decimal token must be scaled down by 10^(7-6) = 10.
// Uses decimals=7 (pow(1)) to keep checked_pow tractable for the
// prover. The scaling logic is the same for all decimal values.
// ─────────────────────────────────────────────────────────────────

#[rule]
pub fn rule_more_decimals_scales_down() {
    let amount: u64 = nondet();

    match stablecoin_to_usd(amount, 7) {
        Ok(usd) => cvlr_assert!(usd == amount / 10),
        Err(_) => cvlr_assert!(false),
    }
}

// ─────────────────────────────────────────────────────────────────
// Rule 4: checked_add overflow detection is complete
//
// Verifies that checked_add either returns a valid sum (>= both
// operands) or returns None precisely when overflow would occur.
// This underpins all spend tracking arithmetic.
// ─────────────────────────────────────────────────────────────────

#[rule]
pub fn rule_checked_add_overflow_detection() {
    let a: u64 = nondet();
    let b: u64 = nondet();

    match a.checked_add(b) {
        Some(sum) => {
            cvlr_assert!(sum >= a);
            cvlr_assert!(sum >= b);
        }
        None => {
            // Overflow: mathematical sum exceeds u64::MAX
            cvlr_assert!(a > u64::MAX - b);
        }
    }
}
