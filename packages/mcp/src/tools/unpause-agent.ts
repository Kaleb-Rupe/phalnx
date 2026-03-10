import { z } from "zod";
import type { PhalnxClient } from "@phalnx/sdk";
import { toPublicKey } from "../utils";
import { formatError } from "../errors";

export const unpauseAgentSchema = z.object({
  vault: z.string().describe("Vault PDA address (base58)"),
  agent: z.string().describe("Agent public key to unpause (base58)"),
});

export type UnpauseAgentInput = z.infer<typeof unpauseAgentSchema>;

export async function unpauseAgent(
  client: PhalnxClient,
  input: UnpauseAgentInput,
): Promise<string> {
  try {
    const sig = await client.unpauseAgent(
      toPublicKey(input.vault),
      toPublicKey(input.agent),
    );

    return [
      "## Agent Unpaused",
      `- **Vault:** ${input.vault}`,
      `- **Agent:** ${input.agent}`,
      `- **Transaction:** ${sig}`,
      "",
      "The agent can now execute actions again.",
      "Permissions and spend history were preserved during the pause.",
    ].join("\n");
  } catch (error) {
    return formatError(error);
  }
}

export const unpauseAgentTool = {
  name: "shield_unpause_agent",
  description:
    "Unpause a paused agent — restores its ability to execute actions. " +
    "Owner-only. The agent's permissions and spend history are unchanged.",
  schema: unpauseAgentSchema,
  handler: unpauseAgent,
};
