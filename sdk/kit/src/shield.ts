/**
 * Shield — Kit-native Client-Side Policy Enforcement
 *
 * Wraps instruction signing with spending limits, rate limits,
 * program allowlists, and custom checks.
 *
 * Kit differences from web3.js version:
 *   - Works at Instruction[] level, not Transaction level
 *   - Uses analyzeInstructions() from inspector instead of analyzeTransaction()
 *   - No ALT resolution needed (pre-compilation analysis)
 *   - Address (string) instead of PublicKey throughout
 */

import type { Address } from "@solana/kit";
import { analyzeInstructions, type InspectableInstruction } from "./inspector.js";
import {
  resolvePolicies,
  type ShieldPolicies,
  type ResolvedPolicies,
  type SpendLimit,
} from "./policies.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PolicyViolation {
  rule: string;
  message: string;
  suggestion?: string;
}

export class ShieldDeniedError extends Error {
  constructor(public readonly violations: PolicyViolation[]) {
    const msgs = violations.map((v) => v.message).join("; ");
    super(`Shield denied: ${msgs}`);
    this.name = "ShieldDeniedError";
  }
}

export interface ShieldCheckResult {
  allowed: boolean;
  violations: PolicyViolation[];
}

export interface SpendingSummary {
  tokens: Array<{
    mint: Address;
    symbol?: string;
    spent: bigint;
    limit: bigint;
    remaining: bigint;
    windowMs: number;
  }>;
  rateLimit: {
    count: number;
    limit: number;
    remaining: number;
    windowMs: number;
  };
  isPaused: boolean;
}

// ─── Shield State ───────────────────────────────────────────────────────────

interface SpendEntry {
  mint: string;
  amount: bigint;
  timestamp: number;
}

interface TxEntry {
  timestamp: number;
}

interface Checkpoint {
  spendEntries: SpendEntry[];
  txEntries: TxEntry[];
}

export class ShieldState {
  private spendEntries: SpendEntry[] = [];
  private txEntries: TxEntry[] = [];

  getSpendInWindow(mint: string, windowMs: number): bigint {
    const cutoff = Date.now() - windowMs;
    return this.spendEntries
      .filter((e) => e.mint === mint && e.timestamp >= cutoff)
      .reduce((sum, e) => sum + e.amount, 0n);
  }

  getTransactionCountInWindow(windowMs: number): number {
    const cutoff = Date.now() - windowMs;
    return this.txEntries.filter((e) => e.timestamp >= cutoff).length;
  }

  recordSpend(mint: string, amount: bigint): void {
    this.spendEntries.push({ mint, amount, timestamp: Date.now() });
  }

  recordTransaction(): void {
    this.txEntries.push({ timestamp: Date.now() });
  }

  checkpoint(): Checkpoint {
    return {
      spendEntries: [...this.spendEntries],
      txEntries: [...this.txEntries],
    };
  }

  rollback(cp: Checkpoint): void {
    this.spendEntries = [...cp.spendEntries];
    this.txEntries = [...cp.txEntries];
  }

  reset(): void {
    this.spendEntries = [];
    this.txEntries = [];
  }
}

// ─── Policy Evaluation ──────────────────────────────────────────────────────

/**
 * Evaluate a set of instructions against resolved policies.
 */
export function evaluateInstructions(
  instructions: InspectableInstruction[],
  signerAddress: Address,
  resolved: ResolvedPolicies,
  state: ShieldState,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const analysis = analyzeInstructions(instructions, signerAddress);

  // 1. Program allowlist check
  if (resolved.blockUnknownPrograms && resolved.allowedProtocols) {
    for (const pid of analysis.programIds) {
      if (!SYSTEM_PROGRAMS.has(pid) && !resolved.allowedProtocols.has(pid)) {
        violations.push({
          rule: "program_allowlist",
          message: `Program ${pid} is not in the allowed list`,
          suggestion: "Use a protocol that is explicitly allowed by the policy",
        });
      }
    }
  }

  // 2. Spend limit check
  if (resolved.spendLimits) {
    for (const limit of resolved.spendLimits) {
      const windowMs = limit.windowMs ?? 86_400_000;
      const currentSpend = state.getSpendInWindow(limit.mint, windowMs);
      const txSpend = analysis.tokenTransfers
        .filter(
          (t) =>
            t.authority === signerAddress &&
            (t.mint === limit.mint || t.mint === null),
        )
        .reduce((sum, t) => sum + t.amount, 0n);

      if (currentSpend + txSpend > limit.amount) {
        violations.push({
          rule: "spend_limit",
          message: `Spend limit exceeded for ${limit.mint}: ${currentSpend + txSpend} > ${limit.amount}`,
          suggestion: "Reduce the transaction amount or wait for the rolling window to reset",
        });
      }
    }
  }

  // 3. Rate limit check
  if (resolved.rateLimit) {
    const count = state.getTransactionCountInWindow(resolved.rateLimit.windowMs);
    if (count >= resolved.rateLimit.maxTransactions) {
      violations.push({
        rule: "rate_limit",
        message: `Rate limit exceeded: ${count}/${resolved.rateLimit.maxTransactions} transactions in window`,
        suggestion: "Wait before sending more transactions",
      });
    }
  }

  // 4. Custom check
  if (resolved.customCheck) {
    const customAnalysis = {
      programIds: analysis.programIds,
      transfers: analysis.tokenTransfers.map((t) => ({
        mint: (t.mint ?? "") as Address,
        amount: t.amount,
        direction: (t.authority === signerAddress ? "outgoing" : "unknown") as
          | "outgoing"
          | "incoming"
          | "unknown",
        destination: t.destination,
      })),
      estimatedValueLamports: analysis.estimatedValue,
    };

    const customResult = resolved.customCheck(customAnalysis);
    if (!customResult.allowed) {
      violations.push({
        rule: "custom",
        message: customResult.reason ?? "Custom policy check failed",
      });
    }
  }

  return violations;
}

const SYSTEM_PROGRAMS = new Set<string>([
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
]);

// ─── Shield Function ────────────────────────────────────────────────────────

export interface ShieldOptions {
  onDenied?: (error: ShieldDeniedError) => void;
  onApproved?: () => void;
  onPolicyUpdate?: (policies: ShieldPolicies) => void;
  onPause?: () => void;
  onResume?: () => void;
}

export interface ShieldedContext {
  /** Check instructions against policies without recording */
  check(
    instructions: InspectableInstruction[],
    signerAddress: Address,
  ): ShieldCheckResult;

  /** Check and record — throws ShieldDeniedError if denied */
  enforce(
    instructions: InspectableInstruction[],
    signerAddress: Address,
  ): void;

  /** Current resolved policies */
  readonly resolvedPolicies: ResolvedPolicies;

  /** Whether enforcement is paused */
  readonly isPaused: boolean;

  /** Update policies */
  updatePolicies(policies: ShieldPolicies): void;

  /** Reset spending state */
  resetState(): void;

  /** Pause enforcement */
  pause(): void;

  /** Resume enforcement */
  resume(): void;

  /** Get spending summary */
  getSpendingSummary(): SpendingSummary;

  /** Internal state (for testing) */
  readonly state: ShieldState;
}

/**
 * Create a Kit-native shield context for client-side policy enforcement.
 *
 * Unlike the web3.js shield() which wraps wallet signing,
 * this works at the instruction level:
 * - check() validates instructions without side effects
 * - enforce() validates and records, throwing on violation
 */
export function shield(
  policies?: ShieldPolicies,
  options?: ShieldOptions,
): ShieldedContext {
  let resolved = resolvePolicies(policies);
  const state = new ShieldState();
  let paused = false;

  return {
    check(
      instructions: InspectableInstruction[],
      signerAddress: Address,
    ): ShieldCheckResult {
      if (paused) {
        return {
          allowed: false,
          violations: [
            {
              rule: "paused",
              message: "Shield is paused — all operations blocked until resume()",
              suggestion: "Call resume() to re-enable",
            },
          ],
        };
      }

      const violations = evaluateInstructions(
        instructions,
        signerAddress,
        resolved,
        state,
      );

      return { allowed: violations.length === 0, violations };
    },

    enforce(
      instructions: InspectableInstruction[],
      signerAddress: Address,
    ): void {
      if (paused) {
        const error = new ShieldDeniedError([
          {
            rule: "paused",
            message: "Shield is paused — all operations blocked until resume()",
            suggestion: "Call resume() to re-enable",
          },
        ]);
        options?.onDenied?.(error);
        throw error;
      }

      const violations = evaluateInstructions(
        instructions,
        signerAddress,
        resolved,
        state,
      );

      if (violations.length > 0) {
        const error = new ShieldDeniedError(violations);
        options?.onDenied?.(error);
        throw error;
      }

      // Record the transaction
      const analysis = analyzeInstructions(instructions, signerAddress);
      for (const transfer of analysis.tokenTransfers) {
        if (transfer.authority === signerAddress) {
          state.recordSpend(transfer.mint ?? "", transfer.amount);
        }
      }
      state.recordTransaction();
      options?.onApproved?.();
    },

    get resolvedPolicies(): ResolvedPolicies {
      return resolved;
    },

    get isPaused(): boolean {
      return paused;
    },

    updatePolicies(newPolicies: ShieldPolicies): void {
      resolved = resolvePolicies(newPolicies);
      options?.onPolicyUpdate?.(newPolicies);
    },

    resetState(): void {
      state.reset();
    },

    pause(): void {
      paused = true;
      options?.onPause?.();
    },

    resume(): void {
      paused = false;
      options?.onResume?.();
    },

    getSpendingSummary(): SpendingSummary {
      const tokens = (resolved.spendLimits ?? []).map(
        (limit: SpendLimit) => {
          const windowMs = limit.windowMs ?? 86_400_000;
          const spent = state.getSpendInWindow(limit.mint, windowMs);
          const remaining = limit.amount > spent ? limit.amount - spent : 0n;
          return {
            mint: limit.mint as Address,
            spent,
            limit: limit.amount,
            remaining,
            windowMs,
          };
        },
      );

      const rl = resolved.rateLimit ?? { maxTransactions: 60, windowMs: 3_600_000 };
      const txCount = state.getTransactionCountInWindow(rl.windowMs);

      return {
        tokens,
        rateLimit: {
          count: txCount,
          limit: rl.maxTransactions,
          remaining: Math.max(0, rl.maxTransactions - txCount),
          windowMs: rl.windowMs,
        },
        isPaused: paused,
      };
    },

    get state(): ShieldState {
      return state;
    },
  };
}
