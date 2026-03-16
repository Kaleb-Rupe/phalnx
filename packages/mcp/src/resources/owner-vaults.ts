import type { PhalnxClient } from "@phalnx/sdk";
import { toPublicKey, formatBN } from "../utils";
import { BN } from "@coral-xyz/anchor";

export async function getOwnerVaultsResource(
  client: PhalnxClient,
  ownerAddress: string,
): Promise<string> {
  try {
    const owner = toPublicKey(ownerAddress);
    const vaults: Array<{
      vaultId: number;
      address: string;
      status: string;
      agentCount: number;
      totalTransactions: string;
    }> = [];

    // Scan first 10 vault IDs (bounded — prevents unbounded RPC calls)
    for (let id = 0; id < 10; id++) {
      try {
        const vault = await client.fetchVault(owner, new BN(id));
        if (vault) {
          const [pda] = client.getVaultPDA(owner, new BN(id));
          vaults.push({
            vaultId: id,
            address: pda.toBase58(),
            status: Object.keys(vault.status)[0] ?? "unknown",
            agentCount: vault.agents.length,
            totalTransactions: formatBN(vault.totalTransactions),
          });
        }
      } catch {
        // Vault doesn't exist at this ID — skip
      }
    }

    return JSON.stringify(
      {
        owner: ownerAddress,
        vaultCount: vaults.length,
        vaults,
      },
      null,
      2,
    );
  } catch {
    return JSON.stringify(
      {
        owner: ownerAddress,
        error: "Failed to scan vaults for owner",
        vaultCount: 0,
        vaults: [],
      },
      null,
      2,
    );
  }
}
