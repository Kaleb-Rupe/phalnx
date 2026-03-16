import type { PhalnxClient } from "@phalnx/sdk";
import { toPublicKey, formatBN, permissionsToActions } from "../utils";

export async function getAgentsResource(
  client: PhalnxClient,
  vaultAddress: string,
): Promise<string> {
  try {
    const vault = toPublicKey(vaultAddress);
    const vaultAccount = await client.fetchVaultByAddress(vault);

    const agents = vaultAccount.agents.map((a) => ({
      pubkey: a.pubkey.toBase58(),
      permissions: a.permissions.toString(),
      allowedActions: permissionsToActions(a.permissions.toString()),
      spendingLimitUsd: formatBN(a.spendingLimitUsd),
      paused: !!(a as any).paused,
    }));

    return JSON.stringify(
      {
        vault: vaultAddress,
        agentCount: agents.length,
        maxAgents: 10,
        agents,
      },
      null,
      2,
    );
  } catch {
    return JSON.stringify(
      {
        vault: vaultAddress,
        error: "Vault not found or agents unavailable",
        agentCount: 0,
        maxAgents: 10,
        agents: [],
      },
      null,
      2,
    );
  }
}
