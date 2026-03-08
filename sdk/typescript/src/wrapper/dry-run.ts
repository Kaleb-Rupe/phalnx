import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { ResolvedPolicies, TransactionAnalysis } from "./policies";
import { resolvePolicies } from "./policies";
import { analyzeTransaction } from "./inspector";
import { evaluatePolicy, recordTransaction } from "./engine";
import { ShieldState } from "./state";
import type { PolicyViolation } from "./errors";
import { getTokenInfo } from "./registry";
import type { ShieldPolicies } from "./policies";

/**
 * Intent-based input — describe what you want to do without a real transaction.
 */
export interface DryRunIntent {
  /** Token mint (PublicKey or base58 string) */
  mint: PublicKey | string;
  /** Amount in base units (e.g. 500_000_000 for $500 USDC) */
  amount: bigint;
  /** Program IDs the transaction would touch */
  programIds?: (PublicKey | string)[];
}

/**
 * Input for dryRunPolicy — either an intent or a real transaction.
 */
export type DryRunInput =
  | { intent: DryRunIntent }
  | { transaction: VersionedTransaction; signerPublicKey: PublicKey };

/**
 * Per-token spending summary for dry-run results.
 */
export interface DryRunSpendingSummary {
  mint: string;
  symbol?: string;
  currentSpent: bigint;
  limit: bigint;
  remainingAfter: bigint;
  windowMs: number;
}

/**
 * Fee estimate for the dry-run.
 */
export interface FeeEstimate {
  protocolFeeBps: number;
  developerFeeBps: number;
  estimatedFeeUsd: bigint;
}

/**
 * Result of a dry-run policy evaluation.
 */
export interface DryRunResult {
  /** Whether the action would be allowed */
  allowed: boolean;
  /** Policy violations (empty if allowed) */
  violations: PolicyViolation[];
  /** Per-token spending summary after this action */
  spendingSummary: DryRunSpendingSummary[];
  /** Estimated fees */
  estimatedFees: FeeEstimate;
  /** Remaining USD budget across all tokens */
  remainingBudgetUsd: bigint;
}

/**
 * Evaluate policies against a hypothetical action without executing it.
 *
 * Supports two modes:
 * - **Intent mode**: describe what you want to do (mint, amount, programIds)
 * - **Transaction mode**: pass a real VersionedTransaction for full analysis
 *
 * State is isolated — no side effects on the real spending tracker.
 */
export function dryRunPolicy(
  policies: ShieldPolicies | ResolvedPolicies,
  state: ShieldState,
  input: DryRunInput,
): DryRunResult {
  // Resolve policies if needed
  const resolved: ResolvedPolicies =
    "spendLimits" in policies ? policies : resolvePolicies(policies);

  // Create isolated state copy via checkpoint/rollback
  const cp = state.checkpoint();

  try {
    let analysis: TransactionAnalysis;

    if ("intent" in input) {
      // Intent mode — create synthetic analysis
      const intent = input.intent;
      const mintPubkey =
        intent.mint instanceof PublicKey
          ? intent.mint
          : new PublicKey(intent.mint);

      const programPubkeys = (intent.programIds ?? []).map((p) =>
        p instanceof PublicKey ? p : new PublicKey(p),
      );

      analysis = {
        transfers: [
          {
            mint: mintPubkey,
            amount: intent.amount,
            direction: "outgoing" as const,
            destination: PublicKey.default,
          },
        ],
        programIds: programPubkeys,
        estimatedValueLamports: intent.amount,
      };
    } else {
      // Transaction mode — full analysis
      analysis = analyzeTransaction(input.transaction, input.signerPublicKey);
    }

    // Evaluate policies
    const violations = evaluatePolicy(analysis, resolved, state);
    const allowed = violations.length === 0;

    // Record (in isolated state) to compute post-action spending
    if (allowed) {
      recordTransaction(analysis, state);
    }

    // Build spending summary
    const spendingSummary: DryRunSpendingSummary[] = resolved.spendLimits.map(
      (limit) => {
        const windowMs = limit.windowMs ?? 86_400_000;
        const currentSpent = state.getSpendInWindow(limit.mint, windowMs);
        const remaining =
          limit.amount > currentSpent ? limit.amount - currentSpent : BigInt(0);
        const tokenInfo = getTokenInfo(limit.mint);
        return {
          mint: limit.mint,
          symbol: tokenInfo?.symbol,
          currentSpent,
          limit: limit.amount,
          remainingAfter: remaining,
          windowMs,
        };
      },
    );

    // Estimate fees (protocol = 2bps, developer = 0bps default)
    const totalOutgoing = analysis.transfers
      .filter((t) => t.direction === "outgoing")
      .reduce((sum, t) => sum + t.amount, BigInt(0));

    const protocolFeeBps = 2;
    const developerFeeBps = 0;
    const estimatedFeeUsd =
      (totalOutgoing * BigInt(protocolFeeBps + developerFeeBps)) /
      BigInt(10_000);

    // Remaining budget across all tokens
    const remainingBudgetUsd = spendingSummary.reduce(
      (sum, s) => sum + s.remainingAfter,
      BigInt(0),
    );

    return {
      allowed,
      violations,
      spendingSummary,
      estimatedFees: {
        protocolFeeBps,
        developerFeeBps,
        estimatedFeeUsd,
      },
      remainingBudgetUsd,
    };
  } finally {
    // Always rollback — dry run must not affect real state
    state.rollback(cp);
  }
}
