/**
 * Cross-impl test for TA-19 policy_preview_digest.
 *
 * Pins the SAME fixtures used in the on-chain Rust unit tests at
 * `programs/sigil/src/utils/policy_digest.rs`:
 *
 *   - `digest_known_value_for_minimal_policy`
 *   - `digest_known_value_for_realistic_policy`
 *
 * Both sides assert byte-for-byte equality against the same hex constants. If
 * the canonical encoding diverges in either direction, the two tests fail in
 * lock-step (the goal — not silent acceptance of a divergent format).
 *
 * The test also exercises a few invariants of the SDK helper: determinism,
 * sensitivity to `observe_only`, and sensitivity to protocol slice order.
 */

import { expect } from "chai";
import { computePolicyPreviewDigest } from "../../src/policy/compute-policy-preview-digest.js";

const HEX_MINIMAL =
  "29f9a0caa6851902abe7de24ac30380ef50c220d25d541f8fe1762793152b623";
const HEX_REALISTIC =
  "33d743a9643fcc6d39c30ac5f8c159d6e94d31ce354d6dd3843367773b3a8502";

// Base58 encodings of fixed test pubkeys [1u8;32], [2u8;32], [10u8;32].
// Computed once (see Rust unit-test fixtures `pk(1) / pk(2) / pk(10)`).
const PK_1 = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
const PK_2 = "8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR";
const PK_10 = "gBxS1f6uyyGPuW5MzGBukidSb71jdsCb5fZaoSzULE5";

function toHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

describe("TA-19 — computePolicyPreviewDigest cross-impl pin", () => {
  it("minimal fixture matches on-chain Rust digest byte-for-byte", () => {
    const digest = computePolicyPreviewDigest({
      dailySpendingCapUsd: 0n,
      maxTransactionSizeUsd: 0n,
      maxSlippageBps: 0,
      protocolMode: 1,
      protocols: [],
      destinationMode: 0,
      allowedDestinations: [],
      timelockDuration: 0n,
      sessionExpirySeconds: 0n,
      observeOnly: false,
      hasConstraints: false,
      hasPostAssertions: 0,
    });
    expect(toHex(digest)).to.equal(HEX_MINIMAL);
  });

  it("realistic fixture matches on-chain Rust digest byte-for-byte", () => {
    const digest = computePolicyPreviewDigest({
      dailySpendingCapUsd: 500_000_000n,
      maxTransactionSizeUsd: 100_000_000n,
      maxSlippageBps: 100,
      protocolMode: 1,
      protocols: [PK_1, PK_2],
      destinationMode: 0,
      allowedDestinations: [PK_10],
      timelockDuration: 1800n,
      sessionExpirySeconds: 30n,
      observeOnly: false,
      hasConstraints: false,
      hasPostAssertions: 0,
    });
    expect(toHex(digest)).to.equal(HEX_REALISTIC);
  });

  it("same fields produce the same digest (determinism)", () => {
    const fields = {
      dailySpendingCapUsd: 1n,
      maxTransactionSizeUsd: 1n,
      maxSlippageBps: 50,
      protocolMode: 1,
      protocols: [PK_1],
      destinationMode: 0,
      allowedDestinations: [PK_10],
      timelockDuration: 1800n,
      sessionExpirySeconds: 30n,
      observeOnly: false,
      hasConstraints: false,
      hasPostAssertions: 0,
    } as const;
    const d1 = computePolicyPreviewDigest(fields);
    const d2 = computePolicyPreviewDigest(fields);
    expect(toHex(d1)).to.equal(toHex(d2));
  });

  it("observe_only=true flips the digest", () => {
    const base = {
      dailySpendingCapUsd: 1n,
      maxTransactionSizeUsd: 1n,
      maxSlippageBps: 0,
      protocolMode: 1,
      protocols: [PK_1],
      destinationMode: 0,
      allowedDestinations: [PK_10],
      timelockDuration: 1800n,
      sessionExpirySeconds: 30n,
      observeOnly: false,
      hasConstraints: false,
      hasPostAssertions: 0,
    } as const;
    const d1 = computePolicyPreviewDigest(base);
    const d2 = computePolicyPreviewDigest({ ...base, observeOnly: true });
    expect(toHex(d1)).to.not.equal(toHex(d2));
  });

  it("protocol slice reorder changes the digest (ordered encoding)", () => {
    const a = {
      dailySpendingCapUsd: 1n,
      maxTransactionSizeUsd: 1n,
      maxSlippageBps: 0,
      protocolMode: 1,
      protocols: [PK_1, PK_2],
      destinationMode: 0,
      allowedDestinations: [PK_10],
      timelockDuration: 1800n,
      sessionExpirySeconds: 30n,
      observeOnly: false,
      hasConstraints: false,
      hasPostAssertions: 0,
    } as const;
    const b = { ...a, protocols: [PK_2, PK_1] } as const;
    const d1 = computePolicyPreviewDigest(a);
    const d2 = computePolicyPreviewDigest(b);
    expect(toHex(d1)).to.not.equal(toHex(d2));
  });

  it("rejects malformed pubkey base58", () => {
    expect(() =>
      computePolicyPreviewDigest({
        dailySpendingCapUsd: 0n,
        maxTransactionSizeUsd: 0n,
        maxSlippageBps: 0,
        protocolMode: 1,
        protocols: ["not-a-pubkey"],
        destinationMode: 0,
        allowedDestinations: [],
        timelockDuration: 0n,
        sessionExpirySeconds: 0n,
        observeOnly: false,
        hasConstraints: false,
        hasPostAssertions: 0,
      }),
    ).to.throw(/base58/);
  });
});
