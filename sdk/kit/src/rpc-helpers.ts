/**
 * Kit-native RPC helpers for Phalnx TransactionExecutor.
 *
 * - BlockhashCache: Caches getLatestBlockhash with configurable TTL
 * - sendAndConfirmTransaction: Send + poll getSignatureStatuses
 */

import type { Rpc, SolanaRpcApi, Commitment } from "@solana/kit";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Blockhash {
  blockhash: string;
  lastValidBlockHeight: bigint;
}

export interface SendAndConfirmOptions {
  /** Max time to wait for confirmation (ms). Default: 30_000 */
  timeoutMs?: number;
  /** Poll interval (ms). Default: 1_000 */
  pollIntervalMs?: number;
  /** Confirmation commitment. Default: "confirmed" */
  commitment?: Commitment;
}

// ─── BlockhashCache ─────────────────────────────────────────────────────────

const DEFAULT_BLOCKHASH_TTL_MS = 30_000;

export class BlockhashCache {
  private cached: Blockhash | null = null;
  private fetchedAt = 0;
  private readonly ttlMs: number;

  constructor(ttlMs?: number) {
    this.ttlMs = ttlMs ?? DEFAULT_BLOCKHASH_TTL_MS;
  }

  /**
   * Get a blockhash, returning cached value if still within TTL.
   */
  async get(rpc: Rpc<SolanaRpcApi>): Promise<Blockhash> {
    const now = Date.now();
    if (this.cached && now - this.fetchedAt < this.ttlMs) {
      return this.cached;
    }
    return this.refresh(rpc);
  }

  /**
   * Force a fresh blockhash fetch regardless of TTL.
   */
  invalidate(): void {
    this.cached = null;
    this.fetchedAt = 0;
  }

  private async refresh(rpc: Rpc<SolanaRpcApi>): Promise<Blockhash> {
    const result = await rpc
      .getLatestBlockhash({ commitment: "confirmed" })
      .send();

    const value = result.value as {
      blockhash: string;
      lastValidBlockHeight: bigint;
    };
    this.cached = {
      blockhash: value.blockhash,
      lastValidBlockHeight: value.lastValidBlockHeight,
    };
    this.fetchedAt = Date.now();
    return this.cached;
  }
}

// ─── sendAndConfirmTransaction ──────────────────────────────────────────────

/**
 * Send a base64-encoded transaction and poll for confirmation.
 * Throws on timeout or confirmed failure.
 */
export async function sendAndConfirmTransaction(
  rpc: Rpc<SolanaRpcApi>,
  encodedTransaction: string,
  options?: SendAndConfirmOptions,
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 1_000;
  const commitment = options?.commitment ?? "confirmed";

  // Send the transaction
  const signature = await rpc
    .sendTransaction(
      encodedTransaction as any,
      {
        encoding: "base64",
        skipPreflight: false,
        preflightCommitment: commitment,
      } as any,
    )
    .send();

  // Poll for confirmation
  const deadline = Date.now() + timeoutMs;
  let delay = pollIntervalMs;

  while (Date.now() < deadline) {
    const statusResult = await rpc
      .getSignatureStatuses([signature] as any)
      .send();

    const statuses = (statusResult as any).value;
    if (statuses && statuses[0]) {
      const status = statuses[0];

      // Check for error
      if (status.err) {
        throw new Error(
          `Transaction ${signature} failed: ${JSON.stringify(status.err)}`,
        );
      }

      // Check for sufficient confirmation
      const level = status.confirmationStatus;
      if (
        level === "confirmed" ||
        level === "finalized" ||
        (commitment === "processed" && level === "processed")
      ) {
        return signature as string;
      }
    }

    // Exponential backoff: 1s → 1.5s → 2.25s → ...
    await sleep(delay);
    delay = Math.min(delay * (1.3 + Math.random() * 0.4), 5_000);
  }

  throw new Error(
    `Transaction ${signature} confirmation timed out after ${timeoutMs}ms`,
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
