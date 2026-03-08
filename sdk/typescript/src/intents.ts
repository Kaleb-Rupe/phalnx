import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { randomUUID } from "crypto";

export const DEFAULT_INTENT_TTL_MS = 3_600_000; // 1 hour

export type IntentAction =
  | {
      type: "swap";
      params: {
        inputMint: string;
        outputMint: string;
        amount: string;
        slippageBps?: number;
      };
    }
  | {
      type: "openPosition";
      params: {
        market: string;
        side: "long" | "short";
        collateral: string;
        leverage: number;
      };
    }
  | { type: "closePosition"; params: { market: string; positionId?: string } }
  | {
      type: "transfer";
      params: { destination: string; mint: string; amount: string };
    }
  | { type: "deposit"; params: { mint: string; amount: string } }
  | { type: "withdraw"; params: { mint: string; amount: string } };

export type IntentStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "expired"
  | "failed";

export interface TransactionIntent {
  id: string;
  action: IntentAction;
  vault: PublicKey;
  agent: PublicKey;
  status: IntentStatus;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
  summary: string;
  error?: string;
}

export interface IntentStorage {
  save(intent: TransactionIntent): Promise<void>;
  get(id: string): Promise<TransactionIntent | null>;
  list(filter?: {
    status?: IntentStatus;
    vault?: PublicKey;
  }): Promise<TransactionIntent[]>;
  update(
    id: string,
    updates: Partial<Pick<TransactionIntent, "status" | "updatedAt" | "error">>,
  ): Promise<void>;
}

/**
 * Produce a human-readable summary of an intent action.
 */
export function summarizeAction(action: IntentAction): string {
  switch (action.type) {
    case "swap":
      return `Swap ${action.params.amount} of ${action.params.inputMint} → ${action.params.outputMint}`;
    case "openPosition":
      return `Open ${action.params.side} ${action.params.market} position, ${action.params.leverage}x leverage, ${action.params.collateral} collateral`;
    case "closePosition":
      return `Close position on ${action.params.market}${action.params.positionId ? ` (${action.params.positionId})` : ""}`;
    case "transfer":
      return `Transfer ${action.params.amount} of ${action.params.mint} to ${action.params.destination}`;
    case "deposit":
      return `Deposit ${action.params.amount} of ${action.params.mint}`;
    case "withdraw":
      return `Withdraw ${action.params.amount} of ${action.params.mint}`;
  }
}

/**
 * Create a new transaction intent with "pending" status.
 */
export function createIntent(
  action: IntentAction,
  vault: PublicKey,
  agent: PublicKey,
  options?: { ttlMs?: number },
): TransactionIntent {
  const now = Date.now();
  const ttl = options?.ttlMs ?? DEFAULT_INTENT_TTL_MS;

  return {
    id: randomUUID(),
    action,
    vault,
    agent,
    status: "pending",
    createdAt: now,
    expiresAt: now + ttl,
    updatedAt: now,
    summary: summarizeAction(action),
  };
}

/**
 * In-memory intent storage with defensive copies.
 */
export class MemoryIntentStorage implements IntentStorage {
  private readonly _intents = new Map<string, TransactionIntent>();

  private _clone(intent: TransactionIntent): TransactionIntent {
    return {
      ...intent,
      action: {
        ...intent.action,
        params: { ...intent.action.params },
      } as IntentAction,
      vault: new PublicKey(intent.vault.toBytes()),
      agent: new PublicKey(intent.agent.toBytes()),
    };
  }

  async save(intent: TransactionIntent): Promise<void> {
    this._intents.set(intent.id, this._clone(intent));
  }

  async get(id: string): Promise<TransactionIntent | null> {
    const intent = this._intents.get(id);
    return intent ? this._clone(intent) : null;
  }

  async list(filter?: {
    status?: IntentStatus;
    vault?: PublicKey;
  }): Promise<TransactionIntent[]> {
    let results = Array.from(this._intents.values());

    if (filter?.status) {
      results = results.filter((i) => i.status === filter.status);
    }
    if (filter?.vault) {
      const vaultKey = filter.vault.toBase58();
      results = results.filter((i) => i.vault.toBase58() === vaultKey);
    }

    return results.map((i) => this._clone(i));
  }

  async update(
    id: string,
    updates: Partial<Pick<TransactionIntent, "status" | "updatedAt" | "error">>,
  ): Promise<void> {
    const existing = this._intents.get(id);
    if (!existing) {
      throw new Error(`Intent not found: ${id}`);
    }
    if (updates.status !== undefined) existing.status = updates.status;
    if (updates.updatedAt !== undefined) existing.updatedAt = updates.updatedAt;
    if (updates.error !== undefined) existing.error = updates.error;
  }
}
