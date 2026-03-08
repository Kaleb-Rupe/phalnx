import { z } from "zod";
import type { PhalnxClient } from "@phalnx/sdk";
import { toPublicKey, toBN } from "../utils";
import { formatError } from "../errors";
import {
  loadAgentKeypair,
  type McpConfig,
  type CustodyWalletLike,
} from "../config";

export const executeSwapSchema = z.object({
  vault: z.string().describe("Vault PDA address (base58)"),
  inputMint: z
    .string()
    .describe(
      "Input token mint address (base58) or symbol (e.g., 'USDC', 'SOL')",
    ),
  outputMint: z
    .string()
    .describe(
      "Output token mint address (base58) or symbol (e.g., 'USDC', 'SOL')",
    ),
  amount: z.string().describe("Input amount in token base units"),
  slippageBps: z
    .number()
    .optional()
    .default(50)
    .describe("Slippage tolerance in basis points (default: 50 = 0.5%)"),
});

export type ExecuteSwapInput = z.infer<typeof executeSwapSchema>;

export async function executeSwap(
  client: PhalnxClient,
  config: McpConfig,
  input: ExecuteSwapInput,
  custodyWallet?: CustodyWalletLike | null,
): Promise<string> {
  try {
    let agentPubkey: import("@solana/web3.js").PublicKey;
    let signers: import("@solana/web3.js").Keypair[];

    if (custodyWallet) {
      agentPubkey = custodyWallet.publicKey;
      signers = [];
    } else {
      const agentKeypair = loadAgentKeypair(config);
      agentPubkey = agentKeypair.publicKey;
      signers = [agentKeypair];
    }

    const vaultAddress = toPublicKey(input.vault);
    const vault = await client.fetchVaultByAddress(vaultAddress);

    const isRegistered = vault.agents.some(
      (a) => a.pubkey.toBase58() === agentPubkey.toBase58(),
    );
    if (!isRegistered) {
      return (
        `Agent not registered to vault.\n\n` +
        `**\u2192 Next:** Run \`shield_register_agent\` with agent pubkey \`${agentPubkey.toBase58()}\`, then retry.`
      );
    }

    // Pre-flight policy check
    let precheckSummary = "";
    try {
      const precheck = await client.precheck(
        {
          type: "swap",
          params: {
            inputMint: input.inputMint,
            outputMint: input.outputMint,
            amount: input.amount,
            slippageBps: input.slippageBps,
          },
        },
        vaultAddress,
      );

      if (!precheck.allowed) {
        return [
          "## Swap Denied by Policy",
          `- **Reason:** ${precheck.reason}`,
          `- **Summary:** ${precheck.summary}`,
          precheck.details.spendingCap
            ? `- **Daily Cap:** $${precheck.details.spendingCap.spent24h.toFixed(2)} / $${precheck.details.spendingCap.cap.toFixed(2)} used ($${precheck.details.spendingCap.remaining.toFixed(2)} remaining)`
            : "",
        ]
          .filter(Boolean)
          .join("\n");
      }

      if (precheck.riskFlags.length > 0) {
        precheckSummary = `\n- **Risk Flags:** ${precheck.riskFlags.join(", ")}`;
      }
      if (precheck.details.spendingCap) {
        const cap = precheck.details.spendingCap;
        precheckSummary += `\n- **Daily Cap:** $${cap.spent24h.toFixed(2)} / $${cap.cap.toFixed(2)} used ($${cap.remaining.toFixed(2)} remaining)`;
      }
    } catch {
      // Precheck is best-effort; don't block execution on precheck failure
    }

    const sig = await client.executeJupiterSwap(
      {
        owner: vault.owner,
        vaultId: vault.vaultId,
        agent: agentPubkey,
        inputMint: toPublicKey(input.inputMint),
        outputMint: toPublicKey(input.outputMint),
        amount: toBN(input.amount),
        slippageBps: input.slippageBps,
      },
      signers,
    );

    return [
      "## Swap Executed",
      `- **Vault:** ${input.vault}`,
      `- **Input:** ${input.amount} of ${input.inputMint}`,
      `- **Output Token:** ${input.outputMint}`,
      `- **Slippage:** ${input.slippageBps} BPS`,
      `- **Transaction:** ${sig}`,
      precheckSummary,
    ]
      .filter(Boolean)
      .join("\n");
  } catch (error) {
    return formatError(error);
  }
}

export const executeSwapTool = {
  name: "shield_execute_swap",
  description:
    "Execute a Jupiter token swap through an Phalnx vault. " +
    "Requires PHALNX_AGENT_KEYPAIR_PATH to be set. " +
    "The swap is policy-checked: spending caps, token allowlist, and transaction size limits apply.",
  schema: executeSwapSchema,
  handler: executeSwap,
};
