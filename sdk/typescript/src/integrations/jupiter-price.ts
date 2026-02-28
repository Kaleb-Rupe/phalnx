// ---------------------------------------------------------------------------
// Jupiter Price API v3
// ---------------------------------------------------------------------------
// Real-time token pricing for agent trading decisions. Read-only.
// API: GET /price/v3?ids={mints}&showExtraInfo={bool}
// ---------------------------------------------------------------------------

import { jupiterFetch } from "./jupiter-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JupiterPriceData {
  id: string;
  type: string;
  price: string;
  extraInfo?: {
    lastSwappedPrice?: {
      lastJupiterSellAt: number;
      lastJupiterSellPrice: string;
      lastJupiterBuyAt: number;
      lastJupiterBuyPrice: string;
    };
    quotedPrice?: {
      buyPrice: string;
      buyAt: number;
      sellPrice: string;
      sellAt: number;
    };
    confidenceLevel?: string;
    depth?: {
      buyPriceImpactRatio?: Record<string, number>;
      sellPriceImpactRatio?: Record<string, number>;
    };
  };
}

export interface JupiterPriceResponse {
  data: Record<string, JupiterPriceData>;
  timeTaken: number;
}

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

/**
 * Fetch prices for up to 50 token mints from Jupiter Price API v3.
 *
 * @param params.ids - Array of token mint addresses (max 50).
 * @param params.showExtraInfo - Include confidence level, depth, and quoted prices.
 */
export async function getJupiterPrices(params: {
  ids: string[];
  showExtraInfo?: boolean;
}): Promise<JupiterPriceResponse> {
  if (params.ids.length === 0) {
    return { data: {}, timeTaken: 0 };
  }

  if (params.ids.length > 50) {
    throw new Error(
      "Jupiter Price API supports a maximum of 50 mints per request",
    );
  }

  const qs = new URLSearchParams({
    ids: params.ids.join(","),
  });

  if (params.showExtraInfo) {
    qs.set("showExtraInfo", "true");
  }

  return jupiterFetch<JupiterPriceResponse>(`/price/v3?${qs.toString()}`);
}

/**
 * Get the USD price for a single token mint.
 * Returns null if the token is not found or has no price.
 */
export async function getTokenPriceUsd(mint: string): Promise<number | null> {
  const response = await getJupiterPrices({ ids: [mint] });
  const data = response.data[mint];
  if (!data || !data.price) return null;
  const price = parseFloat(data.price);
  return isNaN(price) ? null : price;
}
