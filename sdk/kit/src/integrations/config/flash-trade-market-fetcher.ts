/**
 * Flash Trade — Dynamic Market Fetcher
 *
 * Reads the on-chain Pool account to discover all active markets dynamically.
 * Falls back to static config in flash-trade-markets.ts if RPC is unavailable.
 *
 * The Pool account stores markets as an Array<Address>. For each market address,
 * the Market account stores targetCustody and collateralCustody addresses.
 */

import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import {
  fetchPool,
  type Pool,
} from "../../generated/protocols/flash-trade/accounts/pool.js";
import {
  fetchMarket,
  type Market,
} from "../../generated/protocols/flash-trade/accounts/market.js";
import type { FlashMarketConfig } from "./flash-trade-markets.js";
import { FLASH_POOL } from "./flash-trade-markets.js";

export interface FetchedFlashMarket extends FlashMarketConfig {
  /** On-chain market address (same as `market` field) */
  address: Address;
}

/**
 * Fetch all active Flash Trade markets from the on-chain Pool account.
 *
 * @param rpc - Solana RPC connection
 * @param poolAddress - Pool address (defaults to mainnet Crypto.1 pool)
 * @returns Array of market configs with addresses
 */
export async function fetchFlashTradeMarkets(
  rpc: Rpc<SolanaRpcApi>,
  poolAddress: Address = FLASH_POOL,
): Promise<FetchedFlashMarket[]> {
  // Fetch the Pool account
  const pool = await fetchPool(rpc, poolAddress);

  const markets: FetchedFlashMarket[] = [];

  // Fetch each Market account in parallel
  const marketPromises = pool.data.markets.map(async (marketAddress) => {
    const market = await fetchMarket(rpc, marketAddress);
    return {
      address: marketAddress,
      market: marketAddress,
      targetCustody: market.data.targetCustody,
      collateralCustody: market.data.collateralCustody,
    } satisfies FetchedFlashMarket;
  });

  const results = await Promise.allSettled(marketPromises);
  for (const result of results) {
    if (result.status === "fulfilled") {
      markets.push(result.value);
    }
    // Skip failed fetches (market may be closed/invalid)
  }

  return markets;
}

/**
 * Create a TTL-cached market fetcher that refreshes at most every `ttlMs` milliseconds.
 *
 * @param rpc - Solana RPC connection
 * @param ttlMs - Cache duration in milliseconds (default: 1 hour)
 * @param poolAddress - Pool address (defaults to mainnet Crypto.1 pool)
 */
export function createCachedMarketFetcher(
  rpc: Rpc<SolanaRpcApi>,
  ttlMs: number = 3_600_000,
  poolAddress?: Address,
): () => Promise<FetchedFlashMarket[]> {
  let cache: FetchedFlashMarket[] | null = null;
  let lastFetchTime = 0;

  return async () => {
    const now = Date.now();
    if (cache && now - lastFetchTime < ttlMs) {
      return cache;
    }

    cache = await fetchFlashTradeMarkets(rpc, poolAddress);
    lastFetchTime = now;
    return cache;
  };
}
