import type { AgentShieldClient } from "@agent-shield/sdk";
import { toPublicKey, formatBN, formatTimestamp } from "../utils";

export async function getSpendingResource(
  client: AgentShieldClient,
  vaultAddress: string,
): Promise<string> {
  try {
    const vault = toPublicKey(vaultAddress);
    const tracker = await client.fetchTracker(vault);
    const policy = await client.fetchPolicy(vault);

    const cap = policy.dailySpendingCapUsd;
    const spends = tracker.rollingSpends.map((entry) => ({
      tokenIndex: entry.tokenIndex,
      usdAmount: formatBN(entry.usdAmount),
      timestamp: formatTimestamp(entry.timestamp),
      percentOfCap: cap.isZero()
        ? "N/A"
        : `${entry.usdAmount.muln(100).div(cap).toNumber()}%`,
      remaining: cap.isZero() ? "N/A" : formatBN(cap.sub(entry.usdAmount)),
    }));

    return JSON.stringify(
      {
        vault: vaultAddress,
        dailySpendingCapUsd: formatBN(cap),
        rollingSpends: spends,
        totalRecentTransactions: tracker.recentTransactions.length,
      },
      null,
      2,
    );
  } catch {
    return JSON.stringify(
      {
        vault: vaultAddress,
        error: "Spending data not found — vault may not exist",
        dailySpendingCapUsd: "0",
        rollingSpends: [],
        totalRecentTransactions: 0,
      },
      null,
      2,
    );
  }
}
