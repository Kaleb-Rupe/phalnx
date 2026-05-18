/**
 * TA-19 — Canonical policy preview digest (SDK side).
 *
 * Mirrors `programs/sigil/src/utils/policy_digest.rs` exactly. The SDK computes
 * this off-chain, the owner signs `queue_policy_update` / `initialize_vault`
 * with the digest as an arg, and the on-chain handler recomputes it from the
 * resulting policy state. If the two digests do not match the handler rejects
 * with `PolicyPreviewMismatch` (6080).
 *
 * Defense rationale:
 *   - Sequence: SDK builds policy fields → SDK computes digest → owner signs
 *     the transaction (digest is in the instruction data, signed alongside).
 *   - On-chain handler reads the policy fields from the args, re-computes the
 *     same digest, and asserts equality.
 *   - The only ways the two digests can diverge are: (a) an owner blind-signed
 *     mutated fields that the SDK never told them about; (b) a rogue program
 *     tampered with the pending PDA between queue and apply (a future
 *     discriminator-collision attack). Both cases reject — the owner sees a
 *     mismatch error rather than silently committing.
 *
 * CANONICAL ENCODING (FIXED — DO NOT REORDER):
 *   1. daily_spending_cap_usd: u64 LE (8 bytes)
 *   2. max_transaction_size_usd: u64 LE (8 bytes)
 *   3. max_slippage_bps: u16 LE (2 bytes)
 *   4. developer_fee_rate: u16 LE (2 bytes) — PEN-CROSS-6 (Phase 2 close-up)
 *   5. protocol_mode: u8 (1 byte)
 *   6. protocols: Vec<Pubkey> = u32 LE length (4 bytes) ++ each Pubkey 32 bytes
 *   7. destination_mode: u8 (1 byte)
 *   8. allowed_destinations: Vec<Pubkey> = u32 LE length (4 bytes) ++ each Pubkey 32 bytes
 *   9. timelock_duration: u64 LE (8 bytes)
 *   10. session_expiry_seconds: u64 LE (8 bytes)
 *   11. observe_only: bool as 1 byte (0 or 1)
 *   12. has_constraints: bool as 1 byte (0 or 1)
 *   13. has_post_assertions: u8 (1 byte)
 *   14. created_at_slot: u64 LE (8 bytes) — PEN-CROSS-2 (Phase 2 close-up)
 *
 * Total bounded by MAX_ALLOWED_PROTOCOLS=10 + MAX_ALLOWED_DESTINATIONS=10 at
 * 32 bytes each + fixed scalars ≈ 700 bytes worst case.
 */

import { createHash } from "node:crypto";
import type { Address } from "../kit-adapter.js";

/**
 * Canonical preview-fields shape. Matches the on-chain `PolicyPreviewFields`
 * struct in `programs/sigil/src/utils/policy_digest.rs` exactly.
 */
export interface PolicyPreviewFields {
  /** $ × 1e6 (USDC/USDT decimals). e.g. $500 = 500_000_000n. */
  dailySpendingCapUsd: bigint;
  /** $ × 1e6. */
  maxTransactionSizeUsd: bigint;
  /** Basis points (0-5000). */
  maxSlippageBps: number;
  /**
   * Developer fee rate (rate / 1,000,000). Bound by the owner-signed digest
   * since PEN-CROSS-6 (Phase 2 close-up). 0..=MAX_DEVELOPER_FEE_RATE (500).
   */
  developerFeeRate: number;
  /** 1 = ALLOWLIST (Phase 2 Option A). Other values rejected on-chain. */
  protocolMode: number;
  /** Up to MAX_ALLOWED_PROTOCOLS (10) base58-encoded program IDs. */
  protocols: readonly (Address | string)[];
  /** 0 = RESTRICTED (Phase 2 Option A). Other values rejected on-chain. */
  destinationMode: number;
  /** Up to MAX_ALLOWED_DESTINATIONS (10) base58-encoded wallet pubkeys. */
  allowedDestinations: readonly (Address | string)[];
  /** Timelock duration in seconds (>= MIN_TIMELOCK_DURATION=1800). */
  timelockDuration: bigint;
  /** Owner-configurable session expiry (0 = use default 30s). */
  sessionExpirySeconds: bigint;
  /** TA-19: observe-only kill switch (rejects all validate_and_authorize). */
  observeOnly: boolean;
  /** Whether instruction-constraints PDA exists for this vault. */
  hasConstraints: boolean;
  /** Whether post-execution assertions are configured (0 = no, non-zero = yes). */
  hasPostAssertions: number;
  /**
   * PEN-CROSS-2 (Phase 2 close-up): the slot at which `initialize_vault`
   * minted the live policy. Bound by TA-19 at position 14. Closes the
   * close+reinit replay window.
   */
  createdAtSlot: bigint;
}

// ── Base58 decode (no external dep) ──────────────────────────────────────────
//
// Solana pubkeys are base58 strings; we need the raw 32 bytes. The SDK already
// has many base58 helpers downstream, but to avoid the circular import we
// inline a small decoder. It's the standard Bitcoin alphabet.

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
  // Big integer mode: walk digits, base-256 carry
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
  // bytes is little-endian; reverse and prepend leading zeros
  const out = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[leadingZeros + (bytes.length - 1 - i)] = bytes[i]!;
  }
  // Solana addresses MUST decode to exactly 32 bytes
  if (out.length !== 32) {
    throw new Error(
      `base58Decode: expected 32-byte pubkey, got ${out.length} bytes`,
    );
  }
  return out;
}

// ── Encoders ─────────────────────────────────────────────────────────────────

function writeU16Le(view: DataView, offset: number, v: number): number {
  view.setUint16(offset, v, true);
  return offset + 2;
}
function writeU64Le(view: DataView, offset: number, v: bigint): number {
  view.setBigUint64(offset, v, true);
  return offset + 8;
}
function writeU32Le(view: DataView, offset: number, v: number): number {
  view.setUint32(offset, v, true);
  return offset + 4;
}

/**
 * Compute the canonical SHA-256 of the policy preview fields.
 *
 * Returns a 32-byte Uint8Array. Identical to the on-chain helper
 * `compute_policy_preview_digest` for the same input.
 *
 * @throws if any pubkey doesn't base58-decode to exactly 32 bytes
 * @throws if a u64 is negative or out of range
 */
export function computePolicyPreviewDigest(
  fields: PolicyPreviewFields,
): Uint8Array {
  // Pre-size: 8+8+2+1 + 4+32*10 + 1 + 4+32*10 + 8+8+1+1+1 = ~684 bytes worst case
  const protocols = fields.protocols;
  const dests = fields.allowedDestinations;
  // Decode pubkeys first so any error surfaces with a useful message before
  // we start the hash walk.
  const protoBytes = protocols.map((p) => base58Decode(p as string));
  const destBytes = dests.map((p) => base58Decode(p as string));

  const fixedSize =
    8 + // daily_spending_cap_usd
    8 + // max_transaction_size_usd
    2 + // max_slippage_bps
    2 + // developer_fee_rate (PEN-CROSS-6)
    1 + // protocol_mode
    4 + // protocols length prefix
    1 + // destination_mode
    4 + // allowed_destinations length prefix
    8 + // timelock_duration
    8 + // session_expiry_seconds
    1 + // observe_only
    1 + // has_constraints
    1 + // has_post_assertions
    8; // created_at_slot (PEN-CROSS-2)
  const variableSize = protoBytes.length * 32 + destBytes.length * 32;
  const buf = new Uint8Array(fixedSize + variableSize);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let off = 0;
  off = writeU64Le(view, off, fields.dailySpendingCapUsd);
  off = writeU64Le(view, off, fields.maxTransactionSizeUsd);
  off = writeU16Le(view, off, fields.maxSlippageBps);
  // PEN-CROSS-6: developer_fee_rate at position 4 of canonical encoding.
  off = writeU16Le(view, off, fields.developerFeeRate);
  buf[off++] = fields.protocolMode;
  off = writeU32Le(view, off, protoBytes.length);
  for (const pk of protoBytes) {
    buf.set(pk, off);
    off += 32;
  }
  buf[off++] = fields.destinationMode;
  off = writeU32Le(view, off, destBytes.length);
  for (const pk of destBytes) {
    buf.set(pk, off);
    off += 32;
  }
  off = writeU64Le(view, off, fields.timelockDuration);
  off = writeU64Le(view, off, fields.sessionExpirySeconds);
  buf[off++] = fields.observeOnly ? 1 : 0;
  buf[off++] = fields.hasConstraints ? 1 : 0;
  buf[off++] = fields.hasPostAssertions;
  // PEN-CROSS-2: created_at_slot at position 14 of canonical encoding.
  off = writeU64Le(view, off, fields.createdAtSlot);

  // Defensive: assert we wrote exactly what we sized
  if (off !== buf.length) {
    throw new Error(
      `computePolicyPreviewDigest: encoded ${off} bytes, expected ${buf.length}`,
    );
  }

  return new Uint8Array(createHash("sha256").update(buf).digest());
}

/** Equivalent of `Buffer.equals` for two `Uint8Array` digests. */
export function digestsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
