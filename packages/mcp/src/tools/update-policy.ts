import { z } from "zod";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type { AgentShieldClient } from "@agent-shield/sdk";
import type { UpdatePolicyParams } from "@agent-shield/sdk";
import { toPublicKey, toBN } from "../utils";
import { formatError } from "../errors";

export const updatePolicySchema = z.object({
  vault: z.string().describe("Vault PDA address (base58)"),
  dailySpendingCapUsd: z
    .string()
    .optional()
    .describe("New daily spending cap in USD base units"),
  maxTransactionSizeUsd: z
    .string()
    .optional()
    .describe("New max transaction size in USD base units"),
  allowedTokens: z
    .array(z.string())
    .optional()
    .describe(
      "New allowed token mints (base58). Max 10. Replaces existing list.",
    ),
  allowedProtocols: z
    .array(z.string())
    .optional()
    .describe(
      "New allowed protocol IDs (base58). Max 10. Replaces existing list.",
    ),
  maxLeverageBps: z
    .number()
    .optional()
    .describe("New max leverage in basis points"),
  canOpenPositions: z
    .boolean()
    .optional()
    .describe("Whether the agent can open new positions"),
  maxConcurrentPositions: z
    .number()
    .optional()
    .describe("New max concurrent positions"),
  developerFeeRate: z
    .number()
    .optional()
    .describe("New developer fee rate (max 500 = 5 BPS)"),
  allowedDestinations: z
    .array(z.string())
    .optional()
    .describe(
      "New allowed destination addresses for agent transfers (base58). Max 10.",
    ),
  timelockDuration: z
    .number()
    .optional()
    .describe(
      "New timelock duration in seconds. Note: if the vault already has a timelock > 0, " +
        "this call will fail — use shield_queue_policy_update instead.",
    ),
});

export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;

export async function updatePolicy(
  client: AgentShieldClient,
  input: UpdatePolicyInput,
): Promise<string> {
  try {
    const params: UpdatePolicyParams = {};

    if (input.dailySpendingCapUsd !== undefined) {
      params.dailySpendingCapUsd = toBN(input.dailySpendingCapUsd);
    }
    if (input.maxTransactionSizeUsd !== undefined) {
      params.maxTransactionSizeUsd = toBN(input.maxTransactionSizeUsd);
    }
    if (input.allowedTokens !== undefined) {
      params.allowedTokens = input.allowedTokens.map((addr) => ({
        mint: toPublicKey(addr),
        oracleFeed: PublicKey.default,
        decimals: 6,
        dailyCapBase: new BN(0),
        maxTxBase: new BN(0),
      }));
    }
    if (input.allowedProtocols !== undefined) {
      params.allowedProtocols = input.allowedProtocols.map(toPublicKey);
    }
    if (input.maxLeverageBps !== undefined) {
      params.maxLeverageBps = input.maxLeverageBps;
    }
    if (input.canOpenPositions !== undefined) {
      params.canOpenPositions = input.canOpenPositions;
    }
    if (input.maxConcurrentPositions !== undefined) {
      params.maxConcurrentPositions = input.maxConcurrentPositions;
    }
    if (input.developerFeeRate !== undefined) {
      params.developerFeeRate = input.developerFeeRate;
    }
    if (input.allowedDestinations !== undefined) {
      params.allowedDestinations = input.allowedDestinations.map(toPublicKey);
    }
    if (input.timelockDuration !== undefined) {
      params.timelockDuration = new BN(input.timelockDuration);
    }

    const sig = await client.updatePolicy(toPublicKey(input.vault), params);

    const updated = Object.keys(params).join(", ") || "none";

    return [
      "## Policy Updated",
      `- **Vault:** ${input.vault}`,
      `- **Fields Updated:** ${updated}`,
      `- **Transaction:** ${sig}`,
    ].join("\n");
  } catch (error) {
    return formatError(error);
  }
}

export const updatePolicyTool = {
  name: "shield_update_policy",
  description:
    "Update the policy configuration for an AgentShield vault. " +
    "Only the fields you provide will be changed. Owner-only operation.",
  schema: updatePolicySchema,
  handler: updatePolicy,
};
