import { getOrCreateShieldedWallet } from "../client-factory";

/**
 * Shield Status Provider — injects shield enforcement state and
 * policy summary into every agent conversation turn.
 */
export const shieldStatusProvider = {
  name: "AGENT_SHIELD_STATUS",
  description:
    "Provides current AgentShield enforcement state, wallet address, and pause status",

  get: async (runtime: any, _message: any, _state: any) => {
    try {
      const { wallet, publicKey } = await getOrCreateShieldedWallet(runtime);

      const paused = wallet.isPaused;
      const summary = wallet.getSpendingSummary();

      const tokenLines = summary.tokens.map((t) => {
        const label = t.symbol ?? t.mint.slice(0, 8) + "...";
        return `${label}: ${t.spent.toString()} / ${t.limit.toString()}`;
      });

      const text = [
        `AgentShield: ${publicKey.toBase58()}`,
        `Enforcement: ${paused ? "PAUSED" : "ACTIVE"}`,
        `Spending: ${tokenLines.join(", ") || "no limits configured"}`,
        `Rate limit: ${summary.rateLimit.count}/${summary.rateLimit.limit}`,
      ].join("\n");

      return {
        text,
        values: {
          walletAddress: publicKey.toBase58(),
          isPaused: paused.toString(),
          tokenCount: summary.tokens.length.toString(),
          rateLimitUsage: `${summary.rateLimit.count}/${summary.rateLimit.limit}`,
        },
      };
    } catch (error: any) {
      return {
        text: `AgentShield: Unable to fetch status — ${error.message}`,
        values: {},
      };
    }
  },
};
