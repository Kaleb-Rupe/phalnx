import { z } from "zod";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  loadShieldConfig,
  saveShieldConfig,
  rpcUrlForNetwork,
} from "../config";

/** Phalnx program ID */
const PHALNX_PROGRAM_ID = new PublicKey(
  "4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL",
);

function deriveVaultPDA(
  owner: PublicKey,
  vaultId: number,
): [PublicKey, number] {
  const vaultIdBn = new BN(vaultId);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("vault"),
      owner.toBuffer(),
      vaultIdBn.toArrayLike(Buffer, "le", 8),
    ],
    PHALNX_PROGRAM_ID,
  );
}

export const confirmVaultSchema = z.object({
  owner: z
    .string()
    .optional()
    .describe(
      "Owner public key (base58). Defaults to configured wallet public key.",
    ),
  vaultId: z
    .number()
    .optional()
    .default(0)
    .describe("Vault ID to confirm. Default: 0"),
});

export type ConfirmVaultInput = z.input<typeof confirmVaultSchema>;

/**
 * Confirm a vault exists on-chain and save its address to the local config.
 *
 * This closes the "dead zone" where vault.enabled=true but address/owner/vaultId are null
 * (e.g., after signing a Blink but before the config is updated).
 *
 * Works without PhalnxClient — only needs RPC connection and local config.
 */
export async function confirmVault(
  _client: any,
  input: ConfirmVaultInput,
): Promise<string> {
  try {
    const fileConfig = loadShieldConfig();
    if (!fileConfig) {
      return "Error: Phalnx is not configured. Run `shield_configure` first.";
    }

    // Resolve RPC
    const rpcUrl = rpcUrlForNetwork(fileConfig.network);
    const connection = new Connection(rpcUrl, "confirmed");

    // Resolve owner — from input or from configured wallet
    let ownerStr: string;
    if (input.owner) {
      ownerStr = input.owner;
    } else if (fileConfig.wallet.publicKey) {
      ownerStr = fileConfig.wallet.publicKey;
    } else {
      return "Error: No owner specified and no wallet configured. Provide an owner public key.";
    }

    let ownerPubkey: PublicKey;
    try {
      ownerPubkey = new PublicKey(ownerStr);
    } catch {
      return `Error: Invalid owner public key: ${ownerStr}`;
    }

    const vaultId = input.vaultId ?? 0;

    // Derive PDA and check on-chain (3 attempts, 2s apart)
    const [vaultPda] = deriveVaultPDA(ownerPubkey, vaultId);
    let accountInfo = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      accountInfo = await connection.getAccountInfo(vaultPda);
      if (accountInfo) break;
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
    }

    if (!accountInfo) {
      return [
        "## Vault Not Yet Confirmed",
        "",
        `Checked 3 times over 6 seconds — vault not visible on-chain yet at \`${vaultPda.toBase58()}\`.`,
        "",
        "Transaction may still be propagating (Solana finality typically takes 5–30s).",
        "",
        "**→ Next:** Wait 30 seconds and run `shield_confirm_vault` again.",
        "Or use `shield_discover_vault` to scan all vault IDs for your owner.",
      ].join("\n");
    }

    // Found — update config
    fileConfig.layers.vault.address = vaultPda.toBase58();
    fileConfig.layers.vault.owner = ownerStr;
    fileConfig.layers.vault.vaultId = String(vaultId);
    fileConfig.layers.vault.enabled = true;
    saveShieldConfig(fileConfig);

    return [
      "## Vault Confirmed",
      "",
      `- **Vault Address:** ${vaultPda.toBase58()}`,
      `- **Owner:** ${ownerStr}`,
      `- **Vault ID:** ${vaultId}`,
      `- **Data Size:** ${accountInfo.data.length} bytes`,
      "",
      "Vault address saved to config. Your setup is now complete!",
      "Run `shield_setup_status` to verify.",
      "",
      `**→ Next:** Fund your vault at \`${vaultPda.toBase58()}\` with SOL and USDC, then try \`shield_execute_swap\`.`,
    ].join("\n");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Error confirming vault: ${msg}`;
  }
}

export const confirmVaultTool = {
  name: "shield_confirm_vault",
  description:
    "Confirm a vault exists on-chain and save its address to config. " +
    "Use after signing the vault creation Blink to populate the vault address. " +
    "Defaults to configured wallet as owner with vaultId=0.",
  schema: confirmVaultSchema,
  handler: confirmVault,
};
