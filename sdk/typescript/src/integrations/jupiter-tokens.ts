// ---------------------------------------------------------------------------
// Jupiter Token API v2
// ---------------------------------------------------------------------------
// Token search and verification. Helps agents avoid scam tokens using
// isSus flag and organicScore. Read-only.
// ---------------------------------------------------------------------------

import { jupiterFetch } from "./jupiter-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JupiterTokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  tags?: string[];
  dailyVolume?: number;
  freezeAuthority?: string | null;
  mintAuthority?: string | null;
  permanentDelegate?: string | null;
  extensions?: Record<string, unknown>;
  /** True if the token is flagged as suspicious. */
  isSus?: boolean;
  /** Organic activity score (higher = more legitimate). */
  organicScore?: number;
}

export type TrendingInterval = "5m" | "1h" | "6h" | "24h";

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

/**
 * Search for tokens by name, symbol, or address.
 *
 * @param params.query - Search query (name, symbol, or mint address).
 * @param params.limit - Max results to return (default 10, max 50).
 */
export async function searchJupiterTokens(params: {
  query: string;
  limit?: number;
}): Promise<JupiterTokenInfo[]> {
  const qs = new URLSearchParams({
    query: params.query,
  });
  if (params.limit) {
    qs.set("limit", Math.min(params.limit, 50).toString());
  }

  return jupiterFetch<JupiterTokenInfo[]>(`/tokens/v2/search?${qs.toString()}`);
}

/**
 * Get trending tokens by time interval.
 *
 * @param interval - Time interval: "5m", "1h", "6h", or "24h" (default "24h").
 */
export async function getTrendingTokens(
  interval: TrendingInterval = "24h",
): Promise<JupiterTokenInfo[]> {
  return jupiterFetch<JupiterTokenInfo[]>(`/tokens/v2/trending/${interval}`);
}

/**
 * Check if a token is flagged as suspicious based on Jupiter's verification.
 * Uses the isSus flag and checks for freeze/mint authorities.
 */
export function isTokenSuspicious(token: JupiterTokenInfo): boolean {
  if (token.isSus) return true;
  if (token.freezeAuthority) return true;
  if (token.mintAuthority) return true;
  if (token.permanentDelegate) return true;
  return false;
}
