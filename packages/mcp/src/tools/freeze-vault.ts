import { z } from "zod";
import type { PhalnxClient } from "@phalnx/sdk";
import { toPublicKey } from "../utils";
import { formatError } from "../errors";

export const freezeVaultSchema = z.object({
  vault: z.string().describe("Vault PDA address (base58)"),
});

export type FreezeVaultInput = z.infer<typeof freezeVaultSchema>;

export async function freezeVault(
  client: PhalnxClient,
  input: FreezeVaultInput,
): Promise<string> {
  try {
    const sig = await client.freezeVault(toPublicKey(input.vault));

    return [
      "## Vault Frozen",
      `- **Vault:** ${input.vault}`,
      `- **Transaction:** ${sig}`,
      "",
      "The vault is now FROZEN. All agent actions are blocked.",
      "Agent entries and spend history are preserved.",
      "Use shield_reactivate_vault to unfreeze when ready.",
    ].join("\n");
  } catch (error) {
    return formatError(error);
  }
}

export const freezeVaultTool = {
  name: "shield_freeze_vault",
  description:
    "Freeze a vault immediately — blocks all agent actions while preserving agent entries. " +
    "Owner-only emergency action. Use shield_reactivate_vault to unfreeze.",
  schema: freezeVaultSchema,
  handler: freezeVault,
};
