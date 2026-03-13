import type { Address, TransactionSigner } from "@solana/kit";

// ─── Error Code Constants ───────────────────────────────────────────────────

export const COMPOSE_ERROR_CODES = Object.freeze({
  MISSING_PARAM: "MISSING_PARAM",
  INVALID_PARAM: "INVALID_PARAM",
  INVALID_BIGINT: "INVALID_BIGINT",
  INVALID_SIDE: "INVALID_SIDE",
  UNSUPPORTED_ACTION: "UNSUPPORTED_ACTION",
} as const);

export type ComposeErrorCode = typeof COMPOSE_ERROR_CODES[keyof typeof COMPOSE_ERROR_CODES];

// ─── Error Classes ──────────────────────────────────────────────────────────

export class ComposeError extends Error {
  constructor(
    public readonly protocol: string,
    public readonly code: string,
    message: string,
  ) {
    super(`[${protocol}] ${message}`);
    this.name = "ComposeError";
  }
}

export class FlashTradeComposeError extends ComposeError {
  constructor(code: string, message: string) {
    super("flash-trade", code, message);
    this.name = "FlashTradeComposeError";
  }
}

export class KaminoComposeError extends ComposeError {
  constructor(code: string, message: string) {
    super("kamino", code, message);
    this.name = "KaminoComposeError";
  }
}

// ─── Shared Factories ───────────────────────────────────────────────────────

export function createSafeBigInt(
  makeError: (field: string, value: unknown) => Error,
): (value: unknown, field: string) => bigint {
  return function safeBigInt(value: unknown, field: string): bigint {
    try {
      return BigInt(value as string | number | bigint);
    } catch {
      throw makeError(field, value);
    }
  };
}

export function createRequireField(
  makeError: (field: string) => Error,
): <T>(params: Record<string, unknown>, field: string) => T {
  return function requireField<T>(params: Record<string, unknown>, field: string): T {
    const val = params[field];
    if (val === undefined || val === null) {
      throw makeError(field);
    }
    return val as T;
  };
}

/**
 * Compose-time placeholder signer. signTransactions MUST throw —
 * prevents placeholder signers from being used for real transactions.
 */
export function addressAsSigner(address: Address): TransactionSigner {
  return {
    address,
    signTransactions: async () => { throw new Error("addressAsSigner is for compose-time only"); },
  } as unknown as TransactionSigner;
}
