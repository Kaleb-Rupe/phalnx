import { searchJupiterTokens } from "@phalnx/sdk";

export async function getTokensResource(query: string): Promise<string> {
  try {
    const tokens = await searchJupiterTokens({ query, limit: 10 });

    return JSON.stringify(
      {
        query,
        resultCount: tokens.length,
        tokens: tokens.map((t) => ({
          address: t.address,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          dailyVolume: t.dailyVolume ?? null,
        })),
      },
      null,
      2,
    );
  } catch {
    return JSON.stringify(
      {
        query,
        error: "Token search failed",
        resultCount: 0,
        tokens: [],
      },
      null,
      2,
    );
  }
}
