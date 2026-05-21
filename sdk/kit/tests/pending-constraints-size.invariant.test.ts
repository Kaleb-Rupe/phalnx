/**
 * Phase 9 Batch G — SIZE invariant ratchet for PENDING_CONSTRAINTS_SIZE
 * (ISC-95, ISC-96, ISC-97).
 *
 * The SDK-side `PENDING_CONSTRAINTS_SIZE` constant
 * (`sdk/kit/src/dashboard/constraint-builders.ts:85`) MUST equal the
 * size that the on-chain `queue_constraints_update.rs:79` handler asserts
 * via Anchor's `InvalidConstraintsAccountSize` error. Drift between the
 * two silently rejects every constraint update.
 *
 * On-chain ground truth: 35_912 bytes (Phase 6 TA-15 sizing — see
 * `programs/sigil/src/state/constraints.rs::SIZE`). Phase 9 Batch G
 * derived this number from `programs/sigil/src/state/constraints.rs`
 * after a fresh `anchor build --no-idl` cycle; subsequent on-chain
 * schema additions MUST update both the const AND this expected value
 * in the same commit (or this test screams loudly).
 *
 * The expected value is intentionally hardcoded in this test (vs. derived
 * from the constant under test) — that's the whole point of an invariant
 * ratchet. Drift surfaces as a test failure, not silently as an accepted
 * mismatch.
 */

import { describe, it } from "mocha";
import { expect } from "chai";
import { PENDING_CONSTRAINTS_SIZE } from "../src/dashboard/constraint-builders.js";

const EXPECTED_PENDING_CONSTRAINTS_SIZE = 35_912;

describe("Sized account invariants — drift gate for on-chain schema changes", () => {
  it("PENDING_CONSTRAINTS_SIZE matches the on-chain handler assertion", () => {
    expect(
      PENDING_CONSTRAINTS_SIZE,
      "PENDING_CONSTRAINTS_SIZE drifted from the on-chain " +
        "queue_constraints_update.rs InvalidConstraintsAccountSize check. " +
        "Update both the const in sdk/kit/src/dashboard/constraint-builders.ts " +
        "AND this expected value AND the Rust-side state/constraints.rs::SIZE " +
        "in the same commit.",
    ).to.equal(EXPECTED_PENDING_CONSTRAINTS_SIZE);
  });
});
