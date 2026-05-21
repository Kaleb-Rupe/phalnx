/**
 * AL3 — `computeSealInputDigest()` per-call intent digest.
 * Phase 9 Batch I (ISC-69..76, 143, 148, 150, 153, 155).
 *
 * SHA-256 over a canonical Borsh-style encoding of the SealInput envelope
 * (vault, agent identity, mint, amount, target protocol, network, sealed
 * instructions). Mirrors the discipline of TA-19's `policy_preview_digest`
 * (`sdk/kit/src/policy/compute-policy-preview-digest.ts`) — same primitive
 * (SHA-256 via the shared `canonical-encode.ts` helper), same APPEND-ONLY
 * field ordering, same byte-equal cross-runtime test fixture pattern.
 *
 * **What this defends against**
 * TA-19 binds the POLICY STATE the owner approved (allowlists, caps,
 * cosign flag, agent set hash). It does NOT bind the specific call the
 * agent is making — a compromised agent can still propose a transfer to
 * an attacker-controlled but still-allowlisted recipient, or reorder
 * instruction account metas to swap a destination, and the policy
 * checks all pass. AL3 closes that gap: the owner approves a SPECIFIC
 * intent (recipient, amount, mint, ix shape) in the preview UI, the SDK
 * hashes that intent into a 32-byte digest, and `executeSeal` rejects
 * if the bundle assembled at submit time produces a different digest.
 *
 * **Canonical encoding (FIXED — DO NOT REORDER)**
 *
 *   1. intent_version: u8 = 1                          (1 byte, reserved
 *                                                       for future format
 *                                                       evolution per
 *                                                       Council ISC-155)
 *   2. network_id: u8                                  (1 byte; 0=devnet,
 *                                                       1=mainnet — binds
 *                                                       AL4 isMainnet so
 *                                                       a mainnet bundle
 *                                                       can't be replayed
 *                                                       through a devnet
 *                                                       preview)
 *   3. vault: Pubkey                                   (32 bytes)
 *   4. agent: Pubkey                                   (32 bytes —
 *                                                       agent IDENTITY,
 *                                                       not signer)
 *   5. token_mint: Pubkey                              (32 bytes)
 *   6. amount: u64 LE                                  (8 bytes)
 *   7. target_protocol: Pubkey                         (32 bytes; system
 *                                                       program if the
 *                                                       caller omitted
 *                                                       targetProtocol)
 *   8. instructions: Vec<Ix>                           (u32 LE length ++
 *                                                       each ix below)
 *
 *   Each ix:
 *     a. program_address: Pubkey                       (32 bytes)
 *     b. accounts: Vec<(address: Pubkey, role: u8)>    (u32 LE length ++
 *                                                       each 33-byte
 *                                                       entry)
 *     c. data: Vec<u8>                                 (u32 LE length ++
 *                                                       data bytes)
 *
 * **Discipline guardrails**
 *
 * - NEVER `JSON.stringify` the input. Object property iteration order is
 *   not stable across engines and silent reorderings would invalidate
 *   the digest invariant. The canonical encoder walks fields explicitly.
 * - 32-byte pubkey comparisons use `Buffer.compare` on raw bytes (NOT
 *   base58 lexicographic) so the byte ordering matches Solana's
 *   `Pubkey::cmp` exactly. Council ISC-150 flagged this as a critical
 *   bug class — base58 lex doesn't preserve the canonical byte ordering
 *   when leading-zero counts differ.
 * - Account meta order is preserved as supplied. Reordering metas — even
 *   identical pubkeys — produces a different digest. This is the load-
 *   bearing protection against "swap recipient slots" attacks.
 * - `intent_version: u8 = 1` at position 1 reserves the discriminant
 *   for future format upgrades. A v2 SealInput format would write
 *   `intent_version: 2` and the on-chain verifier could route to the
 *   correct decoder by reading the first byte.
 *
 * **Canonical input contract (load-bearing — §RP Batch I M-1, M-2)**
 *
 * `seal()` hashes the **pre-rewrite, post-filter** DeFi instructions:
 *
 *   1. ComputeBudget program ixs are NOT in the input (wallet adapters
 *      may prepend their own; the user-approved intent shouldn't pin
 *      a specific budget). seal.ts:493 filters these out before
 *      computing the digest.
 *   2. Top-level System program ixs are NOT in the input (`isProtocolAllowed`
 *      would reject them anyway; seal.ts:493 strips them).
 *   3. Agent-ATA → vault-ATA rewrites happen AFTER the digest is
 *      computed (seal.ts:858 vs :957). The digest reflects what the
 *      USER APPROVED (agent ATAs), not what the SDK SUBMITTED (vault
 *      ATAs). Any future on-chain verifier MUST receive the
 *      pre-rewrite projection as an explicit argument; re-deriving
 *      from the submitted tx bytes is impossible.
 *
 * Any re-implementation that wants to verify a digest produced by
 * `seal()` MUST apply the same filter + use the pre-rewrite ix list.
 */

import type { Address, Instruction } from "../kit-adapter.js";
import {
  base58Decode32,
  sha256,
  writeU32Le,
  writeU64Le,
  writeU8,
} from "../canonical-encode.js";

/**
 * Network discriminant used at canonical position 2. Devnet and mainnet
 * are the two values bound by the digest; testnet and localnet are
 * coerced to devnet for digest purposes (the cap/allowlist contract is
 * the same on all non-mainnet networks).
 */
export const NETWORK_ID_DEVNET = 0 as const;
export const NETWORK_ID_MAINNET = 1 as const;

/**
 * Inputs to {@link computeSealInputDigest}. A narrower projection of
 * `SealParams` containing only the binding fields.
 *
 * `targetProtocol` is optional; when omitted, the system program ID
 * (`11111111111111111111111111111111`) is encoded at canonical position
 * 7. The on-chain verifier MUST mirror this default to keep the digest
 * stable.
 */
export interface SealIntentInput {
  vault: Address | string;
  /**
   * Agent identity pubkey. In V2 (Phase 9) the agent identity IS the
   * signer address — `params.agent.address` from `seal()`. If a future
   * V3 multi-sig flow ever separates signer from identity, this field
   * MUST carry the IDENTITY (the address that was registered in the
   * vault's agent list), not the signer.
   */
  agent: Address | string;
  tokenMint: Address | string;
  amount: bigint;
  targetProtocol?: Address | string;
  network: "devnet" | "mainnet";
  instructions: readonly Pick<Instruction, "programAddress" | "accounts" | "data">[];
}

/** Canonical default for an omitted `targetProtocol` — the system program ID. */
const SYSTEM_PROGRAM_ZEROS = new Uint8Array(32);

/** The single intent version byte we encode at canonical position 1. */
const INTENT_VERSION_V1 = 1;

/**
 * Compute the canonical AL3 intent digest over a `SealIntentInput`.
 *
 * @returns 32-byte SHA-256 digest. Stable across Node, Bun, and the
 * browser (Phase 9 Batch L hex fixtures lock this down).
 *
 * @throws if any pubkey doesn't base58-decode to exactly 32 bytes, if
 *   `amount` is negative, or if `network` isn't `"devnet"` or `"mainnet"`.
 */
export function computeSealInputDigest(input: SealIntentInput): Uint8Array {
  if (input.amount < 0n) {
    throw new Error(
      `computeSealInputDigest: amount must be non-negative, got ${input.amount}`,
    );
  }
  const networkId =
    input.network === "mainnet"
      ? NETWORK_ID_MAINNET
      : input.network === "devnet"
        ? NETWORK_ID_DEVNET
        : -1;
  if (networkId < 0) {
    throw new Error(
      `computeSealInputDigest: network must be 'devnet' or 'mainnet', got ${String(input.network)}`,
    );
  }

  // Decode all pubkeys up front so any malformed input fails before we
  // start the hash walk (clear error messages > corrupt digests).
  const vaultBytes = base58Decode32(input.vault as string);
  const agentBytes = base58Decode32(input.agent as string);
  const tokenMintBytes = base58Decode32(input.tokenMint as string);
  const targetProtocolBytes =
    input.targetProtocol === undefined
      ? SYSTEM_PROGRAM_ZEROS
      : base58Decode32(input.targetProtocol as string);

  // Pre-decode every instruction's pubkeys + data so we can both:
  //   (a) size the output buffer exactly, and
  //   (b) fail-fast on any malformed input before partial encoding.
  interface DecodedIx {
    programAddress: Uint8Array;
    accounts: { address: Uint8Array; role: number }[];
    data: Uint8Array;
  }
  const decodedIxs: DecodedIx[] = input.instructions.map((ix, idx) => {
    if (!ix.programAddress) {
      throw new Error(
        `computeSealInputDigest: ix[${idx}].programAddress is required`,
      );
    }
    const programAddress = base58Decode32(ix.programAddress as string);
    const accounts = (ix.accounts ?? []).map((acc, accIdx) => {
      if (!acc.address) {
        throw new Error(
          `computeSealInputDigest: ix[${idx}].accounts[${accIdx}].address is required`,
        );
      }
      const role = acc.role;
      if (role === undefined || role === null) {
        throw new Error(
          `computeSealInputDigest: ix[${idx}].accounts[${accIdx}].role is required`,
        );
      }
      // §RP Batch I L-1: AccountRole enum values are 0..3 (READONLY,
      // WRITABLE, READONLY_SIGNER, WRITABLE_SIGNER). Reject anything
      // outside that range — a caller bypassing the enum to pass
      // role=257 would silently truncate to 1 in the digest while the
      // submitted tx encodes role=1 too (no exec divergence), but the
      // digest then masks bit-pattern information that a future
      // verifier might rely on.
      if (typeof role !== "number" || role < 0 || role > 3) {
        throw new Error(
          `computeSealInputDigest: ix[${idx}].accounts[${accIdx}].role must be an AccountRole (0..3), got ${String(role)}`,
        );
      }
      return {
        address: base58Decode32(acc.address as string),
        role,
      };
    });
    const data = ix.data ? new Uint8Array(ix.data) : new Uint8Array(0);
    return { programAddress, accounts, data };
  });

  // Compute exact buffer size:
  //   1 (intent_version) + 1 (network_id) + 32 (vault) + 32 (agent) +
  //   32 (token_mint) + 8 (amount) + 32 (target_protocol) + 4 (ix count)
  //   + sum over ixs of [32 (programAddress) + 4 (accounts count) +
  //                       sum (33 per account) + 4 (data length) +
  //                       data.length]
  const FIXED = 1 + 1 + 32 + 32 + 32 + 8 + 32 + 4;
  let ixsBytes = 0;
  for (const ix of decodedIxs) {
    ixsBytes += 32 + 4 + ix.accounts.length * 33 + 4 + ix.data.length;
  }
  const buf = new Uint8Array(FIXED + ixsBytes);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let off = 0;
  off = writeU8(view, off, INTENT_VERSION_V1);
  off = writeU8(view, off, networkId);
  buf.set(vaultBytes, off);
  off += 32;
  buf.set(agentBytes, off);
  off += 32;
  buf.set(tokenMintBytes, off);
  off += 32;
  off = writeU64Le(view, off, input.amount);
  buf.set(targetProtocolBytes, off);
  off += 32;
  off = writeU32Le(view, off, decodedIxs.length);
  for (const ix of decodedIxs) {
    buf.set(ix.programAddress, off);
    off += 32;
    off = writeU32Le(view, off, ix.accounts.length);
    for (const acc of ix.accounts) {
      buf.set(acc.address, off);
      off += 32;
      off = writeU8(view, off, acc.role);
    }
    off = writeU32Le(view, off, ix.data.length);
    buf.set(ix.data, off);
    off += ix.data.length;
  }

  if (off !== buf.length) {
    throw new Error(
      `computeSealInputDigest: encoded ${off} bytes, expected ${buf.length}. ` +
        `If you added a field to SealIntentInput, update the FIXED/ixsBytes ` +
        `sizing AND the encoder body in the SAME commit.`,
    );
  }

  return sha256(buf);
}
