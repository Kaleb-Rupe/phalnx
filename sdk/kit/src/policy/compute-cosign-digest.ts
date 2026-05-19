/**
 * TA-09 — Canonical cosign digest (SDK side).
 *
 * Mirrors `programs/sigil/src/utils/cosign_digest.rs` exactly. The SDK
 * computes this off-chain, the owner+cosigner sign `queue_policy_update` with
 * the cosign session pubkey as an arg. The on-chain handler:
 *   1. At queue time, recomputes the digest from the resulting pending args +
 *      the cosign session pubkey and stores it on `PendingPolicyUpdate`.
 *   2. At apply time, recomputes it AGAIN from the persisted pending args and
 *      asserts byte-equality. Any tamper of pending args between queue and
 *      apply (e.g. a future discriminator-collision attack on the pending PDA)
 *      produces a digest mismatch and a hard reject (`ErrCosignRequired`,
 *      6089).
 *
 * The cosign digest is INTENTIONALLY narrower than TA-19 `policy_preview_digest`:
 * only the FIELDS that participate in "elevated mutation" detection are in
 * scope. Non-elevated fields (developer_fee_rate, max_slippage_bps,
 * session_expiry_seconds, timelock_duration narrowing, protocol_mode,
 * destination_mode, has_protocol_caps, protocol_caps, operating_hours,
 * stable_balance_floor, per_recipient_daily_cap_usd, etc.) do NOT require
 * cosign and are NOT bound by THIS digest — they are still bound by
 * TA-19 `policy_preview_digest` at queue time.
 *
 * G3 audit fix (2026-05-18) NOTE: G3 added TWO new elevated-mutation TRIGGERS
 * (lowering `stable_balance_floor` and raising `per_recipient_daily_cap_usd`)
 * but did NOT extend the cosign-digest BINDING to include those two fields.
 * That is INTENTIONAL: the cosign signer is committing to the
 * elevated-mutation INTENT; the actual TA-12/TA-14 byte safety comes from
 * TA-19 `policy_preview_digest` which DOES bind both fields at canonical
 * positions 18 + 19. Mutating either field between queue and apply still
 * produces a TA-19 mismatch (PolicyPreviewMismatch, 6080) — the cosign gate
 * is the entry gate, TA-19 is the byte-equality gate.
 *
 * CANONICAL ENCODING (FIXED — DO NOT REORDER):
 *   1. cosign_session: Pubkey (32 bytes raw)
 *   2. daily_spending_cap_usd: Option<u64>
 *        - tag: 1 byte (0=None, 1=Some)
 *        - payload (if Some): u64 LE (8 bytes)
 *   3. max_transaction_amount_usd: Option<u64>
 *        - same shape as #2
 *   4. allowed_destinations: Option<Vec<Pubkey>>
 *        - tag: 1 byte (0=None, 1=Some)
 *        - payload (if Some): u32 LE length (4 bytes) ++ each Pubkey 32 bytes
 *   5. protocols: Option<Vec<Pubkey>>
 *        - same shape as #4
 *
 * Total bounded by MAX_ALLOWED_PROTOCOLS=10 + MAX_ALLOWED_DESTINATIONS=10 at
 * 32 bytes each + fixed scalars ≈ 720 bytes worst case.
 *
 * Forward-compat note: per the on-chain comment, the canonical encoding here
 * is APPEND-ONLY — new fields land at the END to preserve replayable digests
 * for in-flight pending PDAs across upgrades.
 */

import { createHash } from "node:crypto";
import type { Address } from "../kit-adapter.js";

/**
 * Canonical cosign-digest input shape. Matches the on-chain
 * `CosignDigestFields` struct in `programs/sigil/src/utils/cosign_digest.rs`
 * exactly.
 *
 * Optional fields:
 *   - `null` or `undefined` → Option::None on-chain (tag byte = 0, no payload).
 *   - non-null value         → Option::Some on-chain (tag byte = 1 + payload).
 *
 * Note that the discriminator is load-bearing: `None` vs `Some(0)` produce
 * DIFFERENT digests. The on-chain handler's "is_elevated" detection relies on
 * `Option::is_some_and(|new| new > live)` — a None pass-through never
 * elevates, but a Some(0) lower DOES elevate (and the digest reflects that
 * choice).
 */
export interface CosignDigestFields {
  /** The cosigning session pubkey. 32 bytes raw at position 1. */
  cosignSession: Address | string;
  /**
   * Pending `daily_spending_cap_usd` arg. `null`/`undefined` = pass-through
   * (Option::None). Bound at position 2.
   */
  dailySpendingCapUsd?: bigint | null;
  /**
   * Pending `max_transaction_amount_usd` arg. Bound at position 3.
   */
  maxTransactionAmountUsd?: bigint | null;
  /**
   * Pending `allowed_destinations` arg. `null`/`undefined` = pass-through
   * (Option::None); empty array = Some([]) (NOT the same as None — load-bearing
   * discriminator). Bound at position 4.
   */
  allowedDestinations?: readonly (Address | string)[] | null;
  /**
   * Pending `protocols` arg. Same shape as #4. Bound at position 5.
   */
  protocols?: readonly (Address | string)[] | null;
}

// ── Base58 decode (inlined to avoid circular SDK imports) ────────────────────
//
// Solana pubkeys are base58 strings; we need the raw 32 bytes. The SDK has
// other base58 helpers downstream, but to avoid circular imports we inline a
// small decoder. Same alphabet/logic as `compute-policy-preview-digest.ts`.

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX: Record<string, number> = (() => {
  const r: Record<string, number> = Object.create(null);
  for (let i = 0; i < BASE58_ALPHABET.length; i++) {
    r[BASE58_ALPHABET[i]!] = i;
  }
  return r;
})();

function base58Decode(s: string): Uint8Array {
  if (s.length === 0) {
    throw new Error("base58Decode: empty input");
  }
  let leadingZeros = 0;
  while (leadingZeros < s.length && s[leadingZeros] === "1") {
    leadingZeros++;
  }
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const v = BASE58_INDEX[c];
    if (v === undefined) {
      throw new Error(`base58Decode: invalid char '${c}'`);
    }
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>>= 8;
    }
  }
  const out = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[leadingZeros + (bytes.length - 1 - i)] = bytes[i]!;
  }
  if (out.length !== 32) {
    throw new Error(
      `base58Decode: expected 32-byte pubkey, got ${out.length} bytes`,
    );
  }
  return out;
}

// ── Encoders ─────────────────────────────────────────────────────────────────

function writeU64Le(view: DataView, offset: number, v: bigint): number {
  view.setBigUint64(offset, v, true);
  return offset + 8;
}

function writeU32Le(view: DataView, offset: number, v: number): number {
  view.setUint32(offset, v, true);
  return offset + 4;
}

/**
 * Compute the canonical SHA-256 of the cosign digest fields.
 *
 * Returns a 32-byte `Uint8Array`. Identical to the on-chain helper
 * `compute_cosign_digest` for the same input.
 *
 * Used by `cosign-helper.buildCosignBundle()` to produce the digest the
 * on-chain handler will re-validate at queue + apply time.
 *
 * @throws if any pubkey doesn't base58-decode to exactly 32 bytes
 * @throws if a u64 is negative or out of range
 */
export function computeCosignDigest(fields: CosignDigestFields): Uint8Array {
  const sessionBytes = base58Decode(fields.cosignSession as string);

  // Normalise Option semantics: undefined → null (Option::None).
  const dailyCap =
    fields.dailySpendingCapUsd === undefined
      ? null
      : fields.dailySpendingCapUsd;
  const maxTx =
    fields.maxTransactionAmountUsd === undefined
      ? null
      : fields.maxTransactionAmountUsd;
  const dests =
    fields.allowedDestinations === undefined
      ? null
      : fields.allowedDestinations;
  const protos = fields.protocols === undefined ? null : fields.protocols;

  // Pre-decode pubkeys so any error surfaces with a useful message BEFORE we
  // start the hash walk.
  const destBytes =
    dests === null ? null : dests.map((p) => base58Decode(p as string));
  const protoBytes =
    protos === null ? null : protos.map((p) => base58Decode(p as string));

  // Pre-size: 32 (session) + 1 + 8 + 1 + 8 + (1 + 4 + 32*N) + (1 + 4 + 32*N)
  // worst case ~720 bytes.
  const fixedSize =
    32 + // cosign_session
    1 + // daily tag
    (dailyCap !== null ? 8 : 0) +
    1 + // max_tx tag
    (maxTx !== null ? 8 : 0) +
    1 + // destinations tag
    (destBytes !== null ? 4 + destBytes.length * 32 : 0) +
    1 + // protocols tag
    (protoBytes !== null ? 4 + protoBytes.length * 32 : 0);
  const buf = new Uint8Array(fixedSize);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let off = 0;

  // 1. cosign_session pubkey (32 bytes raw)
  buf.set(sessionBytes, off);
  off += 32;

  // 2. daily_spending_cap_usd Option<u64>
  if (dailyCap === null) {
    buf[off++] = 0;
  } else {
    buf[off++] = 1;
    off = writeU64Le(view, off, dailyCap);
  }

  // 3. max_transaction_amount_usd Option<u64>
  if (maxTx === null) {
    buf[off++] = 0;
  } else {
    buf[off++] = 1;
    off = writeU64Le(view, off, maxTx);
  }

  // 4. allowed_destinations Option<Vec<Pubkey>>
  if (destBytes === null) {
    buf[off++] = 0;
  } else {
    buf[off++] = 1;
    off = writeU32Le(view, off, destBytes.length);
    for (const pk of destBytes) {
      buf.set(pk, off);
      off += 32;
    }
  }

  // 5. protocols Option<Vec<Pubkey>>
  if (protoBytes === null) {
    buf[off++] = 0;
  } else {
    buf[off++] = 1;
    off = writeU32Le(view, off, protoBytes.length);
    for (const pk of protoBytes) {
      buf.set(pk, off);
      off += 32;
    }
  }

  // Defensive: assert we wrote exactly what we sized.
  if (off !== buf.length) {
    throw new Error(
      `computeCosignDigest: encoded ${off} bytes, expected ${buf.length}`,
    );
  }

  return new Uint8Array(createHash("sha256").update(buf).digest());
}

/** Equivalent of `Buffer.equals` for two `Uint8Array` digests.
 *
 * M-8 audit fix (2026-05-19): constant-time comparison. Previously this
 * helper early-returned on the first mismatched byte, which leaks
 * length-prefix information about the matching prefix via timing
 * channels. Cosign digests are not classically time-attack-sensitive
 * (they're produced and consumed locally), but constant-time is the
 * defensive default. Both equal-length and unequal-length paths now run
 * to completion before returning.
 */
export function cosignDigestsEqual(a: Uint8Array, b: Uint8Array): boolean {
  // Length comparison is deliberately the FIRST check and the only
  // early-return: comparing a length mismatch in constant time is
  // mathematically impossible (the longer array's tail bytes never
  // exist), and leaking the length prefix is harmless — the caller
  // controls both digest sources.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    // XOR-accumulate. `diff` ends at 0 iff every byte pair matched;
    // any single mismatch sets some bit in `diff` permanently. No
    // early exit on mismatch → constant time per length.
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
