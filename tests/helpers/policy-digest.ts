/**
 * Phase 2 TA-19: canonical policy preview digest helper for LiteSVM tests.
 *
 * Mirrors `programs/sigil/src/utils/policy_digest.rs` byte-for-byte. The SDK
 * has its own copy at `sdk/kit/src/policy/compute-policy-preview-digest.ts`;
 * LiteSVM tests can't easily import the SDK ESM build, so this is a local
 * Node-style implementation.
 *
 * CANONICAL ENCODING (DO NOT REORDER):
 *   1. daily_spending_cap_usd: u64 LE
 *   2. max_transaction_size_usd: u64 LE
 *   3. max_slippage_bps: u16 LE
 *   4. protocol_mode: u8
 *   5. protocols: Vec<Pubkey>  (u32 LE len + 32 bytes each)
 *   6. destination_mode: u8
 *   7. allowed_destinations: Vec<Pubkey>
 *   8. timelock_duration: u64 LE
 *   9. session_expiry_seconds: u64 LE
 *   10. observe_only: bool (1 byte 0/1)
 *   11. has_constraints: bool (1 byte 0/1)
 *   12. has_post_assertions: u8
 */

import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export interface PolicyDigestFields {
  dailySpendingCapUsd: BN | bigint | number;
  maxTransactionSizeUsd: BN | bigint | number;
  maxSlippageBps: number;
  protocolMode: number;
  protocols: PublicKey[];
  destinationMode: number;
  allowedDestinations: PublicKey[];
  timelockDuration: BN | bigint | number;
  sessionExpirySeconds?: BN | bigint | number;
  observeOnly: boolean;
  hasConstraints?: boolean;
  hasPostAssertions?: number;
}

function u64le(v: BN | bigint | number): Buffer {
  const buf = Buffer.alloc(8);
  if (typeof v === "number") {
    buf.writeBigUInt64LE(BigInt(v));
  } else if (typeof v === "bigint") {
    buf.writeBigUInt64LE(v);
  } else {
    buf.writeBigUInt64LE(BigInt(v.toString()));
  }
  return buf;
}

function u32le(v: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(v);
  return buf;
}

function u16le(v: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(v);
  return buf;
}

function u8(v: number): Buffer {
  return Buffer.from([v & 0xff]);
}

/**
 * Returns the SHA-256 digest as a `number[]` of length 32. Anchor 0.32.1's
 * TypeScript codec represents Rust's `[u8; 32]` arg as `number[]`, so callers
 * pass this directly into `.initializeVault(... , digest)` or
 * `.queuePolicyUpdate(... , digest)` without further conversion.
 */
export function computePolicyPreviewDigest(
  fields: PolicyDigestFields,
): number[] {
  const parts: Buffer[] = [];
  parts.push(u64le(fields.dailySpendingCapUsd));
  parts.push(u64le(fields.maxTransactionSizeUsd));
  parts.push(u16le(fields.maxSlippageBps));
  parts.push(u8(fields.protocolMode));
  parts.push(u32le(fields.protocols.length));
  for (const p of fields.protocols) parts.push(p.toBuffer());
  parts.push(u8(fields.destinationMode));
  parts.push(u32le(fields.allowedDestinations.length));
  for (const p of fields.allowedDestinations) parts.push(p.toBuffer());
  parts.push(u64le(fields.timelockDuration));
  parts.push(u64le(fields.sessionExpirySeconds ?? 0));
  parts.push(u8(fields.observeOnly ? 1 : 0));
  parts.push(u8(fields.hasConstraints ? 1 : 0));
  parts.push(u8(fields.hasPostAssertions ?? 0));

  const buf = Buffer.concat(parts);
  return Array.from(createHash("sha256").update(buf).digest());
}

/**
 * Convenience: compute a digest from the args that `initialize_vault` will
 * use. Equivalent to:
 *
 *   computePolicyPreviewDigest({
 *     ...args,
 *     destinationMode: 0,
 *     sessionExpirySeconds: 0,
 *     hasConstraints: false,
 *     hasPostAssertions: 0,
 *   })
 *
 * The on-chain handler is hard-coded to RESTRICTED + no constraints at init.
 */
export function initVaultPreviewDigest(args: {
  dailySpendingCapUsd: BN | bigint | number;
  maxTransactionSizeUsd: BN | bigint | number;
  maxSlippageBps: number;
  protocolMode: number;
  protocols: PublicKey[];
  allowedDestinations: PublicKey[];
  timelockDuration: BN | bigint | number;
  observeOnly?: boolean;
}): number[] {
  return computePolicyPreviewDigest({
    dailySpendingCapUsd: args.dailySpendingCapUsd,
    maxTransactionSizeUsd: args.maxTransactionSizeUsd,
    maxSlippageBps: args.maxSlippageBps,
    protocolMode: args.protocolMode,
    protocols: args.protocols,
    destinationMode: 0,
    allowedDestinations: args.allowedDestinations,
    timelockDuration: args.timelockDuration,
    sessionExpirySeconds: 0,
    observeOnly: args.observeOnly ?? false,
    hasConstraints: false,
    hasPostAssertions: 0,
  });
}

/**
 * Compute the digest of the merged-effective policy that WILL result from
 * applying a `queue_policy_update` over the live policy. Used by LiteSVM
 * tests to bind `newPolicyPreviewDigest` to the queue instruction.
 *
 * Pass the live policy (fetched via `program.account.policyConfig.fetch`)
 * plus a partial-override of the fields the queue is changing. Anything
 * NOT in the override inherits from `live`.
 *
 * `observeOnly` and `hasConstraints` are not mutable via queue_policy_update —
 * supply the current vault's observe_only flag explicitly.
 */
export interface LiveLikePolicy {
  dailySpendingCapUsd: BN | bigint;
  maxTransactionSizeUsd: BN | bigint;
  maxSlippageBps: number;
  protocolMode: number;
  protocols: PublicKey[];
  destinationMode: number;
  allowedDestinations: PublicKey[];
  timelockDuration: BN | bigint;
  sessionExpirySeconds: BN | bigint;
  hasConstraints: boolean;
  hasPostAssertions: number;
}

export interface QueueOverride {
  dailySpendingCapUsd?: BN | bigint | number | null;
  maxTransactionSizeUsd?: BN | bigint | number | null;
  maxSlippageBps?: number | null;
  protocolMode?: number | null;
  protocols?: PublicKey[] | null;
  destinationMode?: number | null;
  allowedDestinations?: PublicKey[] | null;
  timelockDuration?: BN | bigint | number | null;
  sessionExpirySeconds?: BN | bigint | number | null;
}

function pick<T>(override: T | null | undefined, fallback: T): T {
  return override == null ? fallback : override;
}

export function queuePolicyMergedDigest(
  live: LiveLikePolicy,
  override: QueueOverride,
  observeOnly: boolean,
): number[] {
  return computePolicyPreviewDigest({
    dailySpendingCapUsd: pick(override.dailySpendingCapUsd, live.dailySpendingCapUsd),
    maxTransactionSizeUsd: pick(
      override.maxTransactionSizeUsd,
      live.maxTransactionSizeUsd,
    ),
    maxSlippageBps: pick(override.maxSlippageBps, live.maxSlippageBps),
    protocolMode: pick(override.protocolMode, live.protocolMode),
    protocols: pick(override.protocols, live.protocols),
    destinationMode: pick(override.destinationMode, live.destinationMode),
    allowedDestinations: pick(
      override.allowedDestinations,
      live.allowedDestinations,
    ),
    timelockDuration: pick(override.timelockDuration, live.timelockDuration),
    sessionExpirySeconds: pick(
      override.sessionExpirySeconds,
      live.sessionExpirySeconds,
    ),
    observeOnly,
    hasConstraints: live.hasConstraints,
    hasPostAssertions: live.hasPostAssertions,
  });
}

/**
 * Async helper that fetches the live policy + vault from a Program client,
 * then computes the merged digest for a queue. Tests pass the program client,
 * policyPda, vaultPda, and the override object — the helper handles the rest.
 *
 * Typed loosely (`any`) for Program/PolicyConfig/AgentVault because the test
 * helper module sits outside the Anchor-generated types graph.
 */
export async function fetchAndComputeQueueDigest(
  program: any,
  policyPda: PublicKey,
  vaultPda: PublicKey,
  override: QueueOverride,
): Promise<number[]> {
  const policy = await program.account.policyConfig.fetch(policyPda);
  const vault = await program.account.agentVault.fetch(vaultPda);
  const live: LiveLikePolicy = {
    dailySpendingCapUsd: policy.dailySpendingCapUsd,
    maxTransactionSizeUsd: policy.maxTransactionSizeUsd,
    maxSlippageBps: policy.maxSlippageBps,
    protocolMode: policy.protocolMode,
    protocols: policy.protocols,
    destinationMode: policy.destinationMode,
    allowedDestinations: policy.allowedDestinations,
    timelockDuration: policy.timelockDuration,
    sessionExpirySeconds: policy.sessionExpirySeconds,
    hasConstraints: policy.hasConstraints,
    hasPostAssertions: policy.hasPostAssertions,
  };
  return queuePolicyMergedDigest(live, override, !!vault.observeOnly);
}
