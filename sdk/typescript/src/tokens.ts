import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  USDC_MINT_DEVNET,
  USDC_MINT_MAINNET,
  USDT_MINT_DEVNET,
  USDT_MINT_MAINNET,
} from "./types";

export interface ResolvedToken {
  mint: PublicKey;
  decimals: number;
  symbol: string;
}

type Network = "devnet" | "mainnet-beta";

/** Well-known tokens with hardcoded mints and decimals */
const WELL_KNOWN_TOKENS: Record<
  string,
  Record<Network, { mint: PublicKey; decimals: number }>
> = {
  USDC: {
    devnet: { mint: USDC_MINT_DEVNET, decimals: 6 },
    "mainnet-beta": { mint: USDC_MINT_MAINNET, decimals: 6 },
  },
  USDT: {
    devnet: { mint: USDT_MINT_DEVNET, decimals: 6 },
    "mainnet-beta": { mint: USDT_MINT_MAINNET, decimals: 6 },
  },
  SOL: {
    devnet: {
      mint: new PublicKey("So11111111111111111111111111111111111111112"),
      decimals: 9,
    },
    "mainnet-beta": {
      mint: new PublicKey("So11111111111111111111111111111111111111112"),
      decimals: 9,
    },
  },
  WSOL: {
    devnet: {
      mint: new PublicKey("So11111111111111111111111111111111111111112"),
      decimals: 9,
    },
    "mainnet-beta": {
      mint: new PublicKey("So11111111111111111111111111111111111111112"),
      decimals: 9,
    },
  },
  JUP: {
    devnet: {
      mint: new PublicKey("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"),
      decimals: 6,
    },
    "mainnet-beta": {
      mint: new PublicKey("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"),
      decimals: 6,
    },
  },
  BONK: {
    devnet: {
      mint: new PublicKey("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"),
      decimals: 5,
    },
    "mainnet-beta": {
      mint: new PublicKey("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"),
      decimals: 5,
    },
  },
  PYTH: {
    devnet: {
      mint: new PublicKey("HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3"),
      decimals: 6,
    },
    "mainnet-beta": {
      mint: new PublicKey("HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3"),
      decimals: 6,
    },
  },
  WIF: {
    devnet: {
      mint: new PublicKey("EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"),
      decimals: 6,
    },
    "mainnet-beta": {
      mint: new PublicKey("EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"),
      decimals: 6,
    },
  },
  JITO: {
    devnet: {
      mint: new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"),
      decimals: 9,
    },
    "mainnet-beta": {
      mint: new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"),
      decimals: 9,
    },
  },
  RAY: {
    devnet: {
      mint: new PublicKey("4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"),
      decimals: 6,
    },
    "mainnet-beta": {
      mint: new PublicKey("4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"),
      decimals: 6,
    },
  },
};

/**
 * Check if a string is a valid base58 public key.
 */
function isBase58PublicKey(value: string): boolean {
  try {
    new PublicKey(value);
    return value.length >= 32 && value.length <= 44;
  } catch {
    return false;
  }
}

/**
 * Resolve a token symbol or mint address to a ResolvedToken.
 *
 * Resolution order:
 * 1. Well-known tokens (USDC, USDT, SOL, etc.) — instant, no network call
 * 2. Valid base58 address — accept as-is with provided or default decimals
 *
 * For chain lookups or Jupiter search, callers should use `searchTokens()` separately.
 */
export function resolveToken(
  tokenOrMint: string,
  network: Network = "mainnet-beta",
): ResolvedToken | null {
  // 1. Check well-known tokens (case-insensitive)
  const upper = tokenOrMint.toUpperCase();
  const known = WELL_KNOWN_TOKENS[upper];
  if (known) {
    const entry = known[network];
    return { mint: entry.mint, decimals: entry.decimals, symbol: upper };
  }

  // 2. Check if it's a valid base58 public key
  if (isBase58PublicKey(tokenOrMint)) {
    return {
      mint: new PublicKey(tokenOrMint),
      decimals: 6, // default; caller should fetch actual decimals if needed
      symbol: tokenOrMint.slice(0, 4) + "...",
    };
  }

  return null;
}

/**
 * Convert a human-readable amount to base units.
 * Example: toBaseUnits(100, 6) === BN(100_000_000)
 */
export function toBaseUnits(amount: number | string, decimals: number): BN {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  const multiplier = Math.pow(10, decimals);
  // Use string conversion to avoid floating-point precision issues
  const baseUnits = Math.round(num * multiplier);
  return new BN(baseUnits.toString());
}

/**
 * Convert base units to a human-readable amount.
 * Example: fromBaseUnits(BN(100_000_000), 6) === 100
 */
export function fromBaseUnits(amount: BN, decimals: number): number {
  const divisor = Math.pow(10, decimals);
  return amount.toNumber() / divisor;
}
