/**
 * Shield — Kit-native Client-Side Policy Enforcement
 *
 * Wraps instruction signing with spending limits, rate limits,
 * program allowlists, and custom checks.
 *
 * Kit differences from web3.js version:
 *   - Works at Instruction[] level, not Transaction level
 *   - Uses analyzeInstructions() from inspector instead of analyzeTransaction()
 *   - Pre-compilation analysis (analyzeInstructions) needs no ALT resolution
 *   - ShieldedSigner (post-compilation) requires AltCache for ALT-compressed accounts
 *   - Address (string) instead of PublicKey throughout
 */

import type {
  Address,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import { getBase64EncodedWireTransaction } from "@solana/kit";
import { analyzeInstructions, type InspectableInstruction, type InstructionAnalysis } from "./inspector.js";
import {
  resolvePolicies,
  type ShieldPolicies,
  type ResolvedPolicies,
  type SpendLimit,
} from "./policies.js";
import { simulateBeforeSend } from "./simulation.js";
import { PHALNX_PROGRAM_ADDRESS } from "./generated/programs/phalnx.js";
import { VALIDATE_AND_AUTHORIZE_DISCRIMINATOR } from "./generated/instructions/validateAndAuthorize.js";
import { FINALIZE_SESSION_DISCRIMINATOR } from "./generated/instructions/finalizeSession.js";
import { ACTION_TYPE_MAP, type IntentAction } from "./intents.js";
import type { AltCache } from "./alt-loader.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PolicyViolation {
  rule: string;
  message: string;
  suggestion?: string;
}

export class ShieldDeniedError extends Error {
  public code?: number;
  constructor(public readonly violations: PolicyViolation[], code?: number) {
    const msgs = violations.map((v) => v.message).join("; ");
    super(`Shield denied: ${msgs}`);
    this.name = "ShieldDeniedError";
    this.code = code;
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

  getTotalSpendInWindow(windowMs: number): bigint {
    const cutoff = Date.now() - windowMs;
    return this.spendEntries
      .filter((e) => e.timestamp >= cutoff)
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
): { violations: PolicyViolation[]; analysis: InstructionAnalysis } {
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

  return { violations, analysis };
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

      const { violations } = evaluateInstructions(
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

      const { violations, analysis } = evaluateInstructions(
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

      // Record the transaction — reuse analysis from evaluateInstructions
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

// ─── Shielded Signer (Pre-Sign Gate) ──────────────────────────────────────

/**
 * Options for the 5-property pre-sign gate.
 */
export interface ShieldedSignerOptions {
  /** Property 3: RPC for fail-closed simulation. */
  rpc?: Rpc<SolanaRpcApi>;
  /** Property 1: Intent context for intent-TX correspondence check. */
  intentContext?: {
    intent: IntentAction;
    expectedOutputMints?: Address[];
  };
  /** Property 5: Session binding context. */
  sessionContext?: {
    sessionPda: Address;
    expirySlot: bigint;
  };
  /** Skip simulation (testing only). */
  skipSimulation?: boolean;
  /** Property 2: Velocity ceiling thresholds. */
  velocityThresholds?: {
    maxTxPerHour?: number;
    maxUsdPerHour?: bigint;
  };
  /** AltCache for resolving ALT-compressed accounts in compiled transactions.
   *  Populated during compose, read synchronously during sign. */
  altCache?: AltCache;
}

/**
 * Create a TransactionSigner that enforces a 5-property pre-sign gate.
 *
 * Intercepts every signing call and runs:
 *   1. Intent-TX correspondence (SOFT — logs warning)
 *   2. Velocity ceiling (HARD — throws)
 *   3. Simulation liveness (HARD — throws)
 *   4. Instruction allowlist via ShieldedContext (HARD — throws)
 *   5. Session binding (SOFT — logs warning)
 *
 * On pass, delegates to the baseSigner. On HARD fail, throws ShieldDeniedError.
 *
 * @param baseSigner - The underlying TransactionSigner to delegate to
 * @param shieldCtx - ShieldedContext providing policy evaluation and state
 * @param options - Optional configuration for each property
 */
export function createShieldedSigner(
  baseSigner: TransactionSigner,
  shieldCtx: ShieldedContext,
  options?: ShieldedSignerOptions,
): TransactionSigner {
  return {
    address: baseSigner.address,
    async modifyAndSignTransactions(
      txs: readonly any[],
    ): Promise<readonly any[]> {
      for (const tx of txs) {
        const instructions = extractInstructionsFromCompiled(tx, options?.altCache);

        // Property 1: Intent-TX correspondence (SOFT)
        if (options?.intentContext) {
          checkIntentCorrespondence(instructions, options.intentContext);
        }

        // Property 2: Velocity ceiling (HARD)
        if (options?.velocityThresholds) {
          checkVelocityCeiling(shieldCtx.state, instructions, baseSigner.address, options.velocityThresholds);
        }

        // Property 3: Simulation liveness (HARD)
        if (options?.rpc && !options?.skipSimulation) {
          let wireBase64: ReturnType<typeof getBase64EncodedWireTransaction>;
          try {
            wireBase64 = getBase64EncodedWireTransaction(tx);
          } catch (encodeErr) {
            // Fail-closed: if we can't encode the TX, block signing
            throw new ShieldDeniedError([
              {
                rule: "simulation",
                message: `Cannot encode transaction for simulation: ${encodeErr instanceof Error ? encodeErr.message : "unknown error"}`,
                suggestion: "Ensure the transaction is properly formed",
              },
            ]);
          }
          const result = await simulateBeforeSend(options.rpc, wireBase64);
          if (!result.success) {
            throw new ShieldDeniedError([
              {
                rule: "simulation",
                message: `Simulation failed: ${result.error?.message ?? "unknown error"}`,
                suggestion: result.error?.suggestion ?? "Check transaction validity",
              },
            ]);
          }
        }

        // Property 4: Instruction allowlist (HARD)
        const checkResult = shieldCtx.check(instructions, baseSigner.address);
        if (!checkResult.allowed) {
          throw new ShieldDeniedError(checkResult.violations);
        }

        // Property 5: Session binding (SOFT)
        if (options?.sessionContext) {
          checkSessionBinding(tx, PHALNX_PROGRAM_ADDRESS);
        }

        // All checks passed — record spend and transaction in shared state
        const analysis = analyzeInstructions(instructions, baseSigner.address);
        for (const transfer of analysis.tokenTransfers) {
          if (transfer.authority === baseSigner.address) {
            shieldCtx.state.recordSpend(transfer.mint ?? "", transfer.amount);
          }
        }
        shieldCtx.state.recordTransaction();
      }

      // Delegate to base signer
      const signer = baseSigner as any;
      if (signer.modifyAndSignTransactions) {
        return signer.modifyAndSignTransactions(txs);
      } else if (signer.signTransactions) {
        const sigs = await signer.signTransactions(txs);
        return txs.map((tx: any, i: number) => ({
          ...tx,
          signatures: { ...tx.signatures, ...sigs[i] },
        }));
      }
      throw new Error(
        "Unsupported signer type: must implement signTransactions or modifyAndSignTransactions",
      );
    },
  } as TransactionSigner;
}

// ─── Internal Helpers (not exported) ────────────────────────────────────────

/**
 * Extract InspectableInstruction[] from a compiled transaction object.
 * Resolves program addresses from staticAccounts[programAddressIndex].
 * When ALTs are used, resolves ALT-compressed account indices via AltCache.
 */
function extractInstructionsFromCompiled(
  tx: any,
  altCache?: AltCache,
): InspectableInstruction[] {
  const msg = tx.compiledMessage;
  if (!msg?.staticAccounts?.length || !msg?.instructions?.length) {
    return [];
  }

  // Build combined account table: static + ALT-resolved
  let accountTable: Address[] = [...msg.staticAccounts];

  if (msg.addressTableLookups?.length && altCache) {
    for (const lookup of msg.addressTableLookups) {
      const altAddress = lookup.lookupTableAddress as Address;
      const resolved = altCache.getCachedAddresses(altAddress);
      if (resolved) {
        for (const idx of lookup.writableIndices ?? []) {
          accountTable.push(resolved[idx]);
        }
        for (const idx of lookup.readonlyIndices ?? []) {
          accountTable.push(resolved[idx]);
        }
      }
    }
  } else if (msg.addressTableLookups?.length) {
    console.warn(
      "[ShieldedSigner] ALT-compressed accounts cannot be resolved without AltCache",
    );
  }

  return msg.instructions.map((ix: any) => ({
    programAddress: accountTable[ix.programAddressIndex] as Address,
    accounts: (ix.accountIndices ?? []).map((i: number) => ({
      address: accountTable[i] as Address,
    })),
    data: ix.data ? new Uint8Array(ix.data) : new Uint8Array(),
  }));
}

/**
 * Property 2: Check velocity ceilings. HARD — throws ShieldDeniedError.
 */
function checkVelocityCeiling(
  state: ShieldState,
  instructions: InspectableInstruction[],
  signerAddress: Address,
  thresholds: NonNullable<ShieldedSignerOptions["velocityThresholds"]>,
): void {
  if (thresholds.maxTxPerHour !== undefined) {
    const count = state.getTransactionCountInWindow(3_600_000);
    if (count >= thresholds.maxTxPerHour) {
      throw new ShieldDeniedError([
        {
          rule: "velocity_ceiling",
          message: `Transaction rate ${count}/${thresholds.maxTxPerHour} per hour exceeded`,
          suggestion: "Wait before sending more transactions",
        },
      ]);
    }
  }

  if (thresholds.maxUsdPerHour !== undefined) {
    const analysis = analyzeInstructions(instructions, signerAddress);
    const currentSpend = state.getTotalSpendInWindow(3_600_000);
    const projectedSpend = currentSpend + analysis.estimatedValue;
    if (projectedSpend > thresholds.maxUsdPerHour) {
      throw new ShieldDeniedError([
        {
          rule: "velocity_ceiling",
          message: `Hourly USD spend ${projectedSpend} exceeds ceiling ${thresholds.maxUsdPerHour}`,
          suggestion: "Reduce transaction amounts or wait for the window to reset",
        },
      ]);
    }
  }
}

/**
 * Property 5: Check session binding (validate+finalize sandwich). SOFT — warns.
 */
function checkSessionBinding(tx: any, programAddress: Address): void {
  const msg = tx.compiledMessage;
  if (!msg?.staticAccounts?.length || !msg?.instructions?.length) {
    console.warn("[ShieldedSigner] Cannot verify session binding: no compiled message");
    return;
  }

  const phalnxIxs = msg.instructions.filter(
    (ix: any) => msg.staticAccounts[ix.programAddressIndex] === programAddress,
  );

  if (phalnxIxs.length === 0) {
    console.warn("[ShieldedSigner] No Phalnx instructions found in transaction");
    return;
  }

  const firstData = phalnxIxs[0].data;
  const lastData = phalnxIxs[phalnxIxs.length - 1].data;

  const hasValidate =
    firstData &&
    firstData.length >= 8 &&
    matchesDiscriminator(firstData, VALIDATE_AND_AUTHORIZE_DISCRIMINATOR);
  const hasFinalize =
    lastData &&
    lastData.length >= 8 &&
    matchesDiscriminator(lastData, FINALIZE_SESSION_DISCRIMINATOR);

  if (!hasValidate || !hasFinalize) {
    console.warn(
      `[ShieldedSigner] Session binding incomplete: validate=${!!hasValidate}, finalize=${!!hasFinalize}`,
    );
  }
}

/**
 * Property 1: Check intent-TX correspondence. SOFT — warns.
 */
function checkIntentCorrespondence(
  instructions: InspectableInstruction[],
  intentContext: NonNullable<ShieldedSignerOptions["intentContext"]>,
): void {
  const entry = ACTION_TYPE_MAP[intentContext.intent.type];
  if (!entry) return;

  // For spending intents, verify at least one non-system program is present
  if (entry.isSpending) {
    const hasNonSystem = instructions.some(
      (ix) => !SYSTEM_PROGRAMS.has(ix.programAddress),
    );
    if (!hasNonSystem) {
      console.warn(
        `[ShieldedSigner] Intent '${intentContext.intent.type}' (spending) but no protocol programs found`,
      );
    }
  }
}

/**
 * Compare first N bytes of data against a discriminator.
 */
function matchesDiscriminator(
  data: Uint8Array | { readonly [index: number]: number; readonly length: number },
  disc: Uint8Array | { readonly [index: number]: number; readonly length: number },
): boolean {
  if (data.length < disc.length) return false;
  for (let i = 0; i < disc.length; i++) {
    if (data[i] !== disc[i]) return false;
  }
  return true;
}
