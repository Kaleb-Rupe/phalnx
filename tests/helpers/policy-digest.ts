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
 *   4. developer_fee_rate: u16 LE — PEN-CROSS-6 (Phase 2 close-up)
 *   5. protocol_mode: u8
 *   6. protocols: Vec<Pubkey>  (u32 LE len + 32 bytes each)
 *   7. destination_mode: u8
 *   8. allowed_destinations: Vec<Pubkey>
 *   9. timelock_duration: u64 LE
 *   10. session_expiry_seconds: u64 LE
 *   11. observe_only: bool (1 byte 0/1)
 *   12. has_constraints: bool (1 byte 0/1)
 *   13. has_post_assertions: u8
 *   14. created_at_slot: u64 LE — PEN-CROSS-2 (Phase 2 close-up)
 *   15. operating_hours: u32 LE — TA-05 (Phase 3 pre-exec)
 *   16. auto_promote_grays: bool (1 byte 0/1) — TA-07 (Phase 3 pre-exec)
 *   17. auto_revoke_threshold: u8 — TA-17 (Phase 3 pre-exec)
 *   18. stable_balance_floor: u64 LE — TA-12 (Phase 5 post-exec)
 *   19. per_recipient_daily_cap_usd: u64 LE — TA-14 (Phase 5 post-exec)
 */

import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export interface PolicyDigestFields {
  dailySpendingCapUsd: BN | bigint | number;
  maxTransactionSizeUsd: BN | bigint | number;
  maxSlippageBps: number;
  /**
   * PEN-CROSS-6 (Phase 2 close-up): now part of the canonical digest encoding.
   * Optional with default 0 so legacy callers continue to pin a 0-fee policy.
   */
  developerFeeRate?: number;
  protocolMode: number;
  protocols: PublicKey[];
  destinationMode: number;
  allowedDestinations: PublicKey[];
  timelockDuration: BN | bigint | number;
  sessionExpirySeconds?: BN | bigint | number;
  observeOnly: boolean;
  hasConstraints?: boolean;
  hasPostAssertions?: number;
  /**
   * PEN-CROSS-2 (Phase 2 close-up): now part of the canonical digest encoding.
   * Optional with default 0 so legacy callers continue to compute the digest
   * for vaults whose `policy.created_at_slot` is still 0 (handler captures the
   * actual slot at init).
   */
  createdAtSlot?: BN | bigint | number;
  /**
   * TA-05 (Phase 3 pre-exec): 24-bit UTC operating-hours bitmask. Optional
   * with default 0 so legacy fixtures that don't pass it produce the same
   * inert-hours digest the on-chain init handler now requires. New tests
   * should pass `0x00FFFFFF` (all 24h) explicitly.
   */
  operatingHours?: number;
  /**
   * TA-07 (Phase 3): owner-side toggle to bypass the 24h graylist friction.
   * Default false. Bound by TA-19 at digest position 16.
   */
  autoPromoteGrays?: boolean;
  /**
   * TA-17 (Phase 3): consecutive-failure threshold for agent auto-revoke.
   * Default 0 (legacy callers). Bound at digest position 17. On-chain
   * handler requires this to be in [3, 20] at policy-write time.
   */
  autoRevokeThreshold?: number;
  /**
   * TA-12 (Phase 5 post-exec): owner-chosen hard reserve on combined
   * USDC+USDT vault balance. 6-decimal USDC face value. Default 0
   * (no reserve). Bound at digest position 18.
   */
  stableBalanceFloor?: BN | bigint | number;
  /**
   * TA-14 (Phase 5 post-exec): owner-chosen rolling 24h per-recipient
   * outflow cap. 6-decimal USDC face value. Default 0 (no per-recipient
   * cap). Bound at digest position 19.
   */
  perRecipientDailyCapUsd?: BN | bigint | number;
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
  // PEN-CROSS-6: developer_fee_rate at position 4 of canonical encoding.
  parts.push(u16le(fields.developerFeeRate ?? 0));
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
  // PEN-CROSS-2: created_at_slot at position 14 of canonical encoding.
  parts.push(u64le(fields.createdAtSlot ?? 0));
  // TA-05: operating_hours at position 15 of canonical encoding.
  parts.push(u32le(fields.operatingHours ?? 0));
  // TA-07: auto_promote_grays at position 16.
  parts.push(u8(fields.autoPromoteGrays ? 1 : 0));
  // TA-17: auto_revoke_threshold at position 17.
  parts.push(u8(fields.autoRevokeThreshold ?? 0));
  // TA-12: stable_balance_floor at position 18.
  parts.push(u64le(fields.stableBalanceFloor ?? 0));
  // TA-14: per_recipient_daily_cap_usd at position 19.
  parts.push(u64le(fields.perRecipientDailyCapUsd ?? 0));

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
  /**
   * Optional — defaults to 0 so existing fixtures need no update. The on-chain
   * `initialize_vault` handler will recompute against the caller's
   * `developer_fee_rate` ix arg; the two MUST match.
   */
  developerFeeRate?: number;
  protocolMode: number;
  protocols: PublicKey[];
  allowedDestinations: PublicKey[];
  timelockDuration: BN | bigint | number;
  observeOnly?: boolean;
  /**
   * PEN-CROSS-2 (Phase 2 close-up): the slot at which `initialize_vault`
   * will mint the live policy. The on-chain handler captures
   * `Clock::get()?.slot` at handler entry; the digest the caller signs MUST
   * encode that exact slot. Pass the LiteSVM clock slot here (e.g.
   * `Number(svm.getClock().slot)`). Default is 0, matching LiteSVM's
   * initial clock when `withTransactionHistory(0n)` was used and no time
   * has advanced.
   */
  createdAtSlot?: BN | bigint | number;
  /**
   * TA-05 (Phase 3 pre-exec): operating_hours UTC bitmask. Default 0 — legacy
   * fixtures need no update, but new tests SHOULD pass `0x00FFFFFF` (all 24h)
   * so validate_and_authorize doesn't reject. Upper 8 bits must be zero.
   */
  operatingHours?: number;
  /** TA-07 (Phase 3): owner's graylist-bypass choice. Default false. */
  autoPromoteGrays?: boolean;
  /**
   * TA-17 (Phase 3): consecutive-failure auto-revoke threshold. Default 5
   * for new tests; on-chain handler requires range [3, 20].
   */
  autoRevokeThreshold?: number;
  /**
   * TA-12 (Phase 5): stable_balance_floor in 6-decimal USDC face value.
   * Default 0 (no reserve). Bound at digest position 18.
   */
  stableBalanceFloor?: BN | bigint | number;
  /**
   * TA-14 (Phase 5): per_recipient_daily_cap_usd in 6-decimal USDC face
   * value. Default 0 (no cap). Bound at digest position 19.
   */
  perRecipientDailyCapUsd?: BN | bigint | number;
}): number[] {
  return computePolicyPreviewDigest({
    dailySpendingCapUsd: args.dailySpendingCapUsd,
    maxTransactionSizeUsd: args.maxTransactionSizeUsd,
    maxSlippageBps: args.maxSlippageBps,
    developerFeeRate: args.developerFeeRate ?? 0,
    protocolMode: args.protocolMode,
    protocols: args.protocols,
    destinationMode: 0,
    allowedDestinations: args.allowedDestinations,
    timelockDuration: args.timelockDuration,
    sessionExpirySeconds: 0,
    observeOnly: args.observeOnly ?? false,
    hasConstraints: false,
    hasPostAssertions: 0,
    createdAtSlot: args.createdAtSlot ?? 0,
    operatingHours: args.operatingHours ?? 0,
    autoPromoteGrays: args.autoPromoteGrays ?? false,
    autoRevokeThreshold: args.autoRevokeThreshold ?? 0,
    stableBalanceFloor: args.stableBalanceFloor ?? 0,
    perRecipientDailyCapUsd: args.perRecipientDailyCapUsd ?? 0,
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
  /** PEN-CROSS-6: bound by the canonical digest. */
  developerFeeRate?: number;
  protocolMode: number;
  protocols: PublicKey[];
  destinationMode: number;
  allowedDestinations: PublicKey[];
  timelockDuration: BN | bigint;
  sessionExpirySeconds: BN | bigint;
  hasConstraints: boolean;
  hasPostAssertions: number;
  /**
   * PEN-CROSS-2: bound by the canonical digest. Read from
   * `PolicyConfig.createdAtSlot` (typed as BN by Anchor).
   */
  createdAtSlot?: BN | bigint | number;
  /** TA-05 (Phase 3): bound by the canonical digest at position 15. */
  operatingHours?: number;
  /** TA-07 (Phase 3): bound by the canonical digest at position 16. */
  autoPromoteGrays?: boolean;
  /** TA-17 (Phase 3): bound by the canonical digest at position 17. */
  autoRevokeThreshold?: number;
  /** TA-12 (Phase 5): bound by the canonical digest at position 18. */
  stableBalanceFloor?: BN | bigint | number;
  /** TA-14 (Phase 5): bound by the canonical digest at position 19. */
  perRecipientDailyCapUsd?: BN | bigint | number;
}

export interface QueueOverride {
  dailySpendingCapUsd?: BN | bigint | number | null;
  maxTransactionSizeUsd?: BN | bigint | number | null;
  maxSlippageBps?: number | null;
  developerFeeRate?: number | null;
  protocolMode?: number | null;
  protocols?: PublicKey[] | null;
  destinationMode?: number | null;
  allowedDestinations?: PublicKey[] | null;
  timelockDuration?: BN | bigint | number | null;
  sessionExpirySeconds?: BN | bigint | number | null;
  /** TA-05 (Phase 3): operating_hours override. */
  operatingHours?: number | null;
  /**
   * TA-07/17 (Phase 3): not mutable via queue_policy_update in V1, but the
   * helper signature accepts them for explicit symmetry — null means
   * pass-through from live policy.
   */
  autoPromoteGrays?: boolean | null;
  autoRevokeThreshold?: number | null;
  /** TA-12 (Phase 5): stable_balance_floor override. null = pass-through. */
  stableBalanceFloor?: BN | bigint | number | null;
  /**
   * TA-14 (Phase 5): per_recipient_daily_cap_usd override. null =
   * pass-through from live policy.
   */
  perRecipientDailyCapUsd?: BN | bigint | number | null;
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
    // PEN-CROSS-6: developer_fee_rate flows through the merge identically.
    developerFeeRate: pick(override.developerFeeRate, live.developerFeeRate ?? 0),
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
    // PEN-CROSS-2: created_at_slot is immutable post-init — always sourced
    // from live policy. Queue does NOT mutate it; no override is exposed.
    createdAtSlot: live.createdAtSlot ?? 0,
    // TA-05 (Phase 3): operating_hours is mutable via queue (override) or
    // pass-through from live.
    operatingHours: pick(override.operatingHours, live.operatingHours ?? 0),
    // TA-07/17 (Phase 3): pass-through from live policy (queue does not
    // mutate these in V1, but override is exposed for future flexibility).
    autoPromoteGrays: pick(
      override.autoPromoteGrays,
      live.autoPromoteGrays ?? false,
    ),
    autoRevokeThreshold: pick(
      override.autoRevokeThreshold,
      live.autoRevokeThreshold ?? 0,
    ),
    // TA-12 (Phase 5): merged-effective stable_balance_floor.
    stableBalanceFloor: pick(
      override.stableBalanceFloor,
      live.stableBalanceFloor ?? 0,
    ),
    // TA-14 (Phase 5): merged-effective per-recipient daily cap.
    perRecipientDailyCapUsd: pick(
      override.perRecipientDailyCapUsd,
      live.perRecipientDailyCapUsd ?? 0,
    ),
  });
}

/**
 * PEN-CROSS-3 (Phase 2 close-up): compute the expected post-mutation digest
 * for one of the 4 sibling handlers. Mirrors the SDK helper
 * `siblingHandlerExpectedDigest`.
 *
 * Pass `hasConstraints`/`hasPostAssertions` to override the flag the handler
 * is about to flip. The rest of the digest fields are read off the live
 * PolicyConfig + AgentVault.
 */
export async function siblingHandlerDigest(
  program: any,
  policyPda: PublicKey,
  vaultPda: PublicKey,
  override: { hasConstraints?: boolean; hasPostAssertions?: number },
): Promise<number[]> {
  const policy = await program.account.policyConfig.fetch(policyPda);
  const vault = await program.account.agentVault.fetch(vaultPda);
  return computePolicyPreviewDigest({
    dailySpendingCapUsd: policy.dailySpendingCapUsd,
    maxTransactionSizeUsd: policy.maxTransactionSizeUsd,
    maxSlippageBps: policy.maxSlippageBps,
    developerFeeRate: policy.developerFeeRate ?? 0,
    protocolMode: policy.protocolMode,
    protocols: policy.protocols,
    destinationMode: policy.destinationMode,
    allowedDestinations: policy.allowedDestinations,
    timelockDuration: policy.timelockDuration,
    sessionExpirySeconds: policy.sessionExpirySeconds,
    observeOnly: !!vault.observeOnly,
    hasConstraints:
      override.hasConstraints !== undefined
        ? override.hasConstraints
        : !!policy.hasConstraints,
    hasPostAssertions:
      override.hasPostAssertions !== undefined
        ? override.hasPostAssertions
        : (policy.hasPostAssertions as number),
    createdAtSlot: policy.createdAtSlot ?? 0,
    // TA-05 (Phase 3): sibling handlers never mutate operating_hours.
    operatingHours: policy.operatingHours ?? 0,
    // TA-07/17 (Phase 3): pass through.
    autoPromoteGrays: !!policy.autoPromoteGrays,
    autoRevokeThreshold: policy.autoRevokeThreshold ?? 0,
    // TA-12 (Phase 5): pass-through. Sibling handlers never mutate this.
    stableBalanceFloor: policy.stableBalanceFloor ?? 0,
    // TA-14 (Phase 5): pass-through. Sibling handlers never mutate this.
    perRecipientDailyCapUsd: policy.perRecipientDailyCapUsd ?? 0,
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
    developerFeeRate: policy.developerFeeRate ?? 0,
    protocolMode: policy.protocolMode,
    protocols: policy.protocols,
    destinationMode: policy.destinationMode,
    allowedDestinations: policy.allowedDestinations,
    timelockDuration: policy.timelockDuration,
    sessionExpirySeconds: policy.sessionExpirySeconds,
    hasConstraints: policy.hasConstraints,
    hasPostAssertions: policy.hasPostAssertions,
    createdAtSlot: policy.createdAtSlot ?? 0,
    operatingHours: policy.operatingHours ?? 0,
    autoPromoteGrays: !!policy.autoPromoteGrays,
    autoRevokeThreshold: policy.autoRevokeThreshold ?? 0,
    stableBalanceFloor: policy.stableBalanceFloor ?? 0,
    perRecipientDailyCapUsd: policy.perRecipientDailyCapUsd ?? 0,
  };
  return queuePolicyMergedDigest(live, override, !!vault.observeOnly);
}
