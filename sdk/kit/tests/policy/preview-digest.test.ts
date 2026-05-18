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
import * as fc from "fast-check";
import { createHash } from "node:crypto";
import { computePolicyPreviewDigest } from "../../src/policy/compute-policy-preview-digest.js";

// Post-TA-12 (Phase 5 post-exec): stable_balance_floor appended at position 18
// of the canonical encoding.
// Prior values:
//   Pre-PEN-CROSS-6:
//     HEX_MINIMAL   = 29f9a0caa6851902abe7de24ac30380ef50c220d25d541f8fe1762793152b623
//     HEX_REALISTIC = 33d743a9643fcc6d39c30ac5f8c159d6e94d31ce354d6dd3843367773b3a8502
//   Post-PEN-CROSS-6 (pre-PEN-CROSS-2):
//     HEX_MINIMAL   = 0ad67bf0d81b972c60abe82ebea425d4b30d0ef910bcc7b76584fae36a0f1252
//     HEX_REALISTIC = ed9ac12d21e0f03933bbf789eae99944c311f2ff6f1baff992058307174de316
//   Post-PEN-CROSS-2 (pre-TA-05):
//     HEX_MINIMAL   = 63974a2661afc539fc8f1e55245adcef9e3b91f82a191c757ed3c795e8e59148
//     HEX_REALISTIC = ac54284579f4b8afd714b290ec22df745bddbede9a5b366f17c8db776fab53c7
//   Post-TA-05 (pre-TA-07/17):
//     HEX_MINIMAL   = f48fb07695e4b5da504654ad5281f0d39e9fcff6fa9cde64a463f1d8a8471322
//     HEX_REALISTIC = af3990ea433e3de25baa05627f9a38ab497dffcba1e202aac99343b1de9cfc8c
//   Post-TA-07/17 (pre-TA-12):
//     HEX_MINIMAL   = eec4230cd52f7f567e06e9b197a0dacdc3955808d1a5a256d5975a4ac1177beb
//     HEX_REALISTIC = 35ed9a9f97b0fa21ca581bd45f11b28c2932525101e9be063cc0d2f6bebc3c48
//
// TA-12 fixtures:
//   - HEX_MINIMAL: stableBalanceFloor=0 (no reserve — append 8 zero bytes)
//   - HEX_REALISTIC: stableBalanceFloor=100_000_000 ($100 reserve)
const HEX_MINIMAL =
  "d3e731941e95cb1c426ccc6f2b5c53525c033f498bdb79a593bc86c98508c67a";
const HEX_REALISTIC =
  "6523cb9b64baef661d919c802a8762332d1091cb53e8245d1624f52839fc9c8c";

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
      developerFeeRate: 0,
      protocolMode: 1,
      protocols: [],
      destinationMode: 0,
      allowedDestinations: [],
      timelockDuration: 0n,
      sessionExpirySeconds: 0n,
      observeOnly: false,
      hasConstraints: false,
      hasPostAssertions: 0,
      createdAtSlot: 0n,
      // TA-05: minimal fixture uses inert operating_hours=0
      operatingHours: 0,
      autoPromoteGrays: false,
      autoRevokeThreshold: 0,
      // TA-12: minimal fixture pins floor=0 (no reserve)
      stableBalanceFloor: 0n,
    });
    expect(toHex(digest)).to.equal(HEX_MINIMAL);
  });

  it("realistic fixture matches on-chain Rust digest byte-for-byte", () => {
    const digest = computePolicyPreviewDigest({
      dailySpendingCapUsd: 500_000_000n,
      maxTransactionSizeUsd: 100_000_000n,
      maxSlippageBps: 100,
      developerFeeRate: 0,
      protocolMode: 1,
      protocols: [PK_1, PK_2],
      destinationMode: 0,
      allowedDestinations: [PK_10],
      timelockDuration: 1800n,
      sessionExpirySeconds: 30n,
      observeOnly: false,
      hasConstraints: false,
      hasPostAssertions: 0,
      createdAtSlot: 12345n,
      // TA-05: realistic fixture pins all-hours default
      operatingHours: 0x00ffffff,
      // TA-07: realistic fixture pins auto_promote_grays=false
      autoPromoteGrays: false,
      // TA-17: realistic fixture pins auto_revoke_threshold=5 (the default)
      autoRevokeThreshold: 5,
      // TA-12: realistic fixture pins floor=$100 (100_000_000 in 6-decimal USDC face value)
      stableBalanceFloor: 100_000_000n,
    });
    expect(toHex(digest)).to.equal(HEX_REALISTIC);
  });

  it("same fields produce the same digest (determinism)", () => {
    const fields = {
      dailySpendingCapUsd: 1n,
      maxTransactionSizeUsd: 1n,
      maxSlippageBps: 50,
      developerFeeRate: 0,
      protocolMode: 1,
      protocols: [PK_1],
      destinationMode: 0,
      allowedDestinations: [PK_10],
      timelockDuration: 1800n,
      sessionExpirySeconds: 30n,
      observeOnly: false,
      hasConstraints: false,
      hasPostAssertions: 0,
      createdAtSlot: 0n,
      operatingHours: 0,
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
      developerFeeRate: 0,
      protocolMode: 1,
      protocols: [PK_1],
      destinationMode: 0,
      allowedDestinations: [PK_10],
      timelockDuration: 1800n,
      sessionExpirySeconds: 30n,
      observeOnly: false,
      hasConstraints: false,
      hasPostAssertions: 0,
      createdAtSlot: 0n,
      operatingHours: 0,
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
      developerFeeRate: 0,
      protocolMode: 1,
      protocols: [PK_1, PK_2],
      destinationMode: 0,
      allowedDestinations: [PK_10],
      timelockDuration: 1800n,
      sessionExpirySeconds: 30n,
      observeOnly: false,
      hasConstraints: false,
      hasPostAssertions: 0,
      createdAtSlot: 0n,
      operatingHours: 0,
    } as const;
    const b = { ...a, protocols: [PK_2, PK_1] } as const;
    const d1 = computePolicyPreviewDigest(a);
    const d2 = computePolicyPreviewDigest(b);
    expect(toHex(d1)).to.not.equal(toHex(d2));
  });

  // PEN-CROSS-6 cross-impl pin: developer_fee_rate is bound by the digest.
  // Flipping it from 0 to a non-zero value MUST change the digest.
  it("developer_fee_rate flip changes the digest (PEN-CROSS-6)", () => {
    const base = {
      dailySpendingCapUsd: 500_000_000n,
      maxTransactionSizeUsd: 100_000_000n,
      maxSlippageBps: 100,
      developerFeeRate: 0,
      protocolMode: 1,
      protocols: [PK_1],
      destinationMode: 0,
      allowedDestinations: [PK_10],
      timelockDuration: 1800n,
      sessionExpirySeconds: 30n,
      observeOnly: false,
      hasConstraints: false,
      hasPostAssertions: 0,
      createdAtSlot: 0n,
      operatingHours: 0,
    } as const;
    const d1 = computePolicyPreviewDigest(base);
    const d2 = computePolicyPreviewDigest({ ...base, developerFeeRate: 25 });
    expect(toHex(d1)).to.not.equal(toHex(d2));
  });

  // PEN-CROSS-2 cross-impl pin: created_at_slot is bound by the digest.
  // Two policies with identical fields but distinct slots MUST hash differently.
  it("created_at_slot flip changes the digest (PEN-CROSS-2)", () => {
    const base = {
      dailySpendingCapUsd: 500_000_000n,
      maxTransactionSizeUsd: 100_000_000n,
      maxSlippageBps: 100,
      developerFeeRate: 0,
      protocolMode: 1,
      protocols: [PK_1],
      destinationMode: 0,
      allowedDestinations: [PK_10],
      timelockDuration: 1800n,
      sessionExpirySeconds: 30n,
      observeOnly: false,
      hasConstraints: false,
      hasPostAssertions: 0,
      createdAtSlot: 12345n,
      operatingHours: 0,
    } as const;
    const d1 = computePolicyPreviewDigest(base);
    const d2 = computePolicyPreviewDigest({ ...base, createdAtSlot: 67890n });
    expect(toHex(d1)).to.not.equal(toHex(d2));
  });

  it("rejects malformed pubkey base58", () => {
    expect(() =>
      computePolicyPreviewDigest({
        dailySpendingCapUsd: 0n,
        maxTransactionSizeUsd: 0n,
        maxSlippageBps: 0,
        developerFeeRate: 0,
        protocolMode: 1,
        protocols: ["not-a-pubkey"],
        destinationMode: 0,
        allowedDestinations: [],
        timelockDuration: 0n,
        sessionExpirySeconds: 0n,
        observeOnly: false,
        hasConstraints: false,
        hasPostAssertions: 0,
        createdAtSlot: 0n,
        operatingHours: 0,
      }),
    ).to.throw(/base58/);
  });

  // TA-05 cross-impl pin: operating_hours is bound by the digest.
  // Flipping it from 0 to a non-zero mask MUST change the digest.
  it("operating_hours flip changes the digest (TA-05)", () => {
    const base = {
      dailySpendingCapUsd: 500_000_000n,
      maxTransactionSizeUsd: 100_000_000n,
      maxSlippageBps: 100,
      developerFeeRate: 0,
      protocolMode: 1,
      protocols: [PK_1],
      destinationMode: 0,
      allowedDestinations: [PK_10],
      timelockDuration: 1800n,
      sessionExpirySeconds: 30n,
      observeOnly: false,
      hasConstraints: false,
      hasPostAssertions: 0,
      createdAtSlot: 12345n,
      operatingHours: 0,
    } as const;
    const d1 = computePolicyPreviewDigest(base);
    // 13:00-17:00 UTC = bits 13..17 = 0x1E000
    const d2 = computePolicyPreviewDigest({
      ...base,
      operatingHours: 0x0001e000,
    });
    expect(toHex(d1)).to.not.equal(toHex(d2));
  });

  // TA-07 cross-impl pin: auto_promote_grays is bound by the digest.
  it("auto_promote_grays flip changes the digest (TA-07)", () => {
    const base = {
      dailySpendingCapUsd: 500_000_000n,
      maxTransactionSizeUsd: 100_000_000n,
      maxSlippageBps: 100,
      developerFeeRate: 0,
      protocolMode: 1,
      protocols: [PK_1],
      destinationMode: 0,
      allowedDestinations: [PK_10],
      timelockDuration: 1800n,
      sessionExpirySeconds: 30n,
      observeOnly: false,
      hasConstraints: false,
      hasPostAssertions: 0,
      createdAtSlot: 12345n,
      operatingHours: 0x00ffffff,
      autoPromoteGrays: false,
      autoRevokeThreshold: 5,
    } as const;
    const d1 = computePolicyPreviewDigest(base);
    const d2 = computePolicyPreviewDigest({
      ...base,
      autoPromoteGrays: true,
    });
    expect(toHex(d1)).to.not.equal(toHex(d2));
  });

  // TA-17 cross-impl pin: auto_revoke_threshold is bound by the digest.
  it("auto_revoke_threshold flip changes the digest (TA-17)", () => {
    const base = {
      dailySpendingCapUsd: 500_000_000n,
      maxTransactionSizeUsd: 100_000_000n,
      maxSlippageBps: 100,
      developerFeeRate: 0,
      protocolMode: 1,
      protocols: [PK_1],
      destinationMode: 0,
      allowedDestinations: [PK_10],
      timelockDuration: 1800n,
      sessionExpirySeconds: 30n,
      observeOnly: false,
      hasConstraints: false,
      hasPostAssertions: 0,
      createdAtSlot: 12345n,
      operatingHours: 0x00ffffff,
      autoPromoteGrays: false,
      autoRevokeThreshold: 5,
    } as const;
    const d1 = computePolicyPreviewDigest(base);
    const d2 = computePolicyPreviewDigest({
      ...base,
      autoRevokeThreshold: 3,
    });
    expect(toHex(d1)).to.not.equal(toHex(d2));
  });

  // TA-12 cross-impl pin: stable_balance_floor is bound by the digest.
  // Flipping it from 0 to a non-zero value MUST change the digest —
  // defends against a tampered SDK silently lowering the owner's reserve
  // between queue and apply.
  it("stable_balance_floor flip changes the digest (TA-12)", () => {
    const base = {
      dailySpendingCapUsd: 500_000_000n,
      maxTransactionSizeUsd: 100_000_000n,
      maxSlippageBps: 100,
      developerFeeRate: 0,
      protocolMode: 1,
      protocols: [PK_1],
      destinationMode: 0,
      allowedDestinations: [PK_10],
      timelockDuration: 1800n,
      sessionExpirySeconds: 30n,
      observeOnly: false,
      hasConstraints: false,
      hasPostAssertions: 0,
      createdAtSlot: 12345n,
      operatingHours: 0x00ffffff,
      autoPromoteGrays: false,
      autoRevokeThreshold: 5,
      stableBalanceFloor: 0n,
    } as const;
    const d1 = computePolicyPreviewDigest(base);
    const d2 = computePolicyPreviewDigest({
      ...base,
      stableBalanceFloor: 100_000_000n,
    });
    expect(toHex(d1)).to.not.equal(toHex(d2));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PEN-CROSS-7 (Phase 2 close-up): property test for cross-impl encoding
// parity.
//
// Strategy: for random fixtures, compute the digest via the SDK helper AND
// via a hand-encoded byte buffer written directly in this test. Both must
// match. The hand-encoded path is a deliberate independent implementation of
// the canonical encoding spec — if a future SDK refactor silently drops a
// field or shifts byte order, this property test fails in lock-step. If a
// future Rust handler diverges from the same spec, the existing
// HEX_MINIMAL/HEX_REALISTIC cross-impl pin (above) catches it.
// ─────────────────────────────────────────────────────────────────────────

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// Encode 32 raw bytes back to base58 — minimal helper avoiding extra deps.
function base58Encode(bytes: Uint8Array): string {
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) {
    leadingZeros++;
  }
  const digits: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! * 256;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (let i = 0; i < leadingZeros; i++) out += "1";
  for (let i = digits.length - 1; i >= 0; i--) {
    out += BASE58_ALPHABET[digits[i]!];
  }
  return out;
}

/**
 * Reference encoder — hand-written from the spec in
 * `programs/sigil/src/utils/policy_digest.rs` and
 * `compute-policy-preview-digest.ts`'s docblock. Intentionally re-derived
 * (not imported) so it catches silent encoder drift in the SDK.
 */
function referenceDigest(fields: {
  dailySpendingCapUsd: bigint;
  maxTransactionSizeUsd: bigint;
  maxSlippageBps: number;
  developerFeeRate: number;
  protocolMode: number;
  protocolBytes: readonly Uint8Array[];
  destinationMode: number;
  destinationBytes: readonly Uint8Array[];
  timelockDuration: bigint;
  sessionExpirySeconds: bigint;
  observeOnly: boolean;
  hasConstraints: boolean;
  hasPostAssertions: number;
  createdAtSlot: bigint;
  operatingHours: number;
  autoPromoteGrays: boolean;
  autoRevokeThreshold: number;
  stableBalanceFloor: bigint;
}): string {
  const parts: number[] = [];
  const pushU64 = (v: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(v);
    for (const x of b) parts.push(x);
  };
  const pushU32 = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v);
    for (const x of b) parts.push(x);
  };
  const pushU16 = (v: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v);
    for (const x of b) parts.push(x);
  };
  const pushU8 = (v: number) => parts.push(v & 0xff);

  pushU64(fields.dailySpendingCapUsd);
  pushU64(fields.maxTransactionSizeUsd);
  pushU16(fields.maxSlippageBps);
  pushU16(fields.developerFeeRate);
  pushU8(fields.protocolMode);
  pushU32(fields.protocolBytes.length);
  for (const b of fields.protocolBytes) {
    for (const x of b) parts.push(x);
  }
  pushU8(fields.destinationMode);
  pushU32(fields.destinationBytes.length);
  for (const b of fields.destinationBytes) {
    for (const x of b) parts.push(x);
  }
  pushU64(fields.timelockDuration);
  pushU64(fields.sessionExpirySeconds);
  pushU8(fields.observeOnly ? 1 : 0);
  pushU8(fields.hasConstraints ? 1 : 0);
  pushU8(fields.hasPostAssertions);
  pushU64(fields.createdAtSlot);
  // TA-05: operating_hours at position 15
  pushU32(fields.operatingHours);
  // TA-07: auto_promote_grays at position 16
  pushU8(fields.autoPromoteGrays ? 1 : 0);
  // TA-17: auto_revoke_threshold at position 17
  pushU8(fields.autoRevokeThreshold);
  // TA-12: stable_balance_floor at position 18
  pushU64(fields.stableBalanceFloor);

  const buf = Buffer.from(parts);
  return createHash("sha256").update(buf).digest("hex");
}

describe("TA-19 — property test: SDK encoder == reference encoder (PEN-CROSS-7)", () => {
  it("100 random fixtures match between SDK and hand-encoded reference", () => {
    const pubkeyArb = fc
      .uint8Array({ minLength: 32, maxLength: 32 })
      .map((u8: Uint8Array) => u8 as Uint8Array);

    fc.assert(
      fc.property(
        fc.bigUint({ max: (1n << 64n) - 1n }), // daily_spending_cap_usd
        fc.bigUint({ max: (1n << 64n) - 1n }), // max_transaction_size_usd
        fc.integer({ min: 0, max: 65535 }), // max_slippage_bps
        fc.integer({ min: 0, max: 65535 }), // developer_fee_rate
        fc.integer({ min: 0, max: 255 }), // protocol_mode (handler rejects most, but encoder must handle all)
        fc.array(pubkeyArb, { minLength: 0, maxLength: 10 }), // protocols
        fc.integer({ min: 0, max: 255 }), // destination_mode
        fc.array(pubkeyArb, { minLength: 0, maxLength: 10 }), // allowed_destinations
        fc.bigUint({ max: (1n << 64n) - 1n }), // timelock_duration
        fc.bigUint({ max: (1n << 64n) - 1n }), // session_expiry_seconds
        fc.boolean(), // observe_only
        fc.boolean(), // has_constraints
        fc.integer({ min: 0, max: 255 }), // has_post_assertions
        fc.bigUint({ max: (1n << 64n) - 1n }), // created_at_slot
        fc.integer({ min: 0, max: 0xffffffff }), // operating_hours (TA-05; encoder must handle any u32)
        fc.boolean(), // auto_promote_grays (TA-07)
        fc.integer({ min: 0, max: 255 }), // auto_revoke_threshold (TA-17; encoder handles any u8)
        fc.bigUint({ max: (1n << 64n) - 1n }), // stable_balance_floor (TA-12)
        (
          dailyCap,
          maxTx,
          slippage,
          feeRate,
          protocolMode,
          protocolBytes,
          destinationMode,
          destinationBytes,
          timelock,
          sessionExpiry,
          observeOnly,
          hasConstraints,
          hasPostAssertions,
          createdAtSlot,
          operatingHours,
          autoPromoteGrays,
          autoRevokeThreshold,
          stableBalanceFloor,
        ) => {
          const sdkDigest = computePolicyPreviewDigest({
            dailySpendingCapUsd: dailyCap,
            maxTransactionSizeUsd: maxTx,
            maxSlippageBps: slippage,
            developerFeeRate: feeRate,
            protocolMode,
            protocols: protocolBytes.map((b: Uint8Array) => base58Encode(b)),
            destinationMode,
            allowedDestinations: destinationBytes.map((b: Uint8Array) =>
              base58Encode(b),
            ),
            timelockDuration: timelock,
            sessionExpirySeconds: sessionExpiry,
            observeOnly,
            hasConstraints,
            hasPostAssertions,
            createdAtSlot,
            operatingHours,
            autoPromoteGrays,
            autoRevokeThreshold,
            stableBalanceFloor,
          });
          const refDigest = referenceDigest({
            dailySpendingCapUsd: dailyCap,
            maxTransactionSizeUsd: maxTx,
            maxSlippageBps: slippage,
            developerFeeRate: feeRate,
            protocolMode,
            protocolBytes,
            destinationMode,
            destinationBytes,
            timelockDuration: timelock,
            sessionExpirySeconds: sessionExpiry,
            observeOnly,
            hasConstraints,
            hasPostAssertions,
            createdAtSlot,
            operatingHours,
            autoPromoteGrays,
            autoRevokeThreshold,
            stableBalanceFloor,
          });
          const sdkHex = Array.from(sdkDigest)
            .map((x) => x.toString(16).padStart(2, "0"))
            .join("");
          return sdkHex === refDigest;
        },
      ),
      { numRuns: 100 },
    );
  });
});
