import { z } from "zod";
import type { PhalnxClient } from "@phalnx/sdk";
import { toPublicKey } from "../utils";
import { formatError } from "../errors";

export const pauseAgentSchema = z.object({
  vault: z.string().describe("Vault PDA address (base58)"),
  agent: z.string().describe("Agent public key to pause (base58)"),
});

export type PauseAgentInput = z.infer<typeof pauseAgentSchema>;

export async function pauseAgent(
  client: PhalnxClient,
  input: PauseAgentInput,
): Promise<string> {
  try {
    const sig = await client.pauseAgent(
      toPublicKey(input.vault),
      toPublicKey(input.agent),
    );

    return [
      "## Agent Paused",
      `- **Vault:** ${input.vault}`,
      `- **Agent:** ${input.agent}`,
      `- **Transaction:** ${sig}`,
      "",
      "The agent is now paused and cannot execute any actions.",
      "Permissions and spend history are preserved.",
      "Use shield_unpause_agent to restore access.",
    ].join("\n");
  } catch (error) {
    return formatError(error);
  }
}

export const pauseAgentTool = {
  name: "shield_pause_agent",
  description:
    "Pause a specific agent — blocks all its actions while preserving permissions and spend history. " +
    "Owner-only. Other agents in the vault are not affected.",
  schema: pauseAgentSchema,
  handler: pauseAgent,
};
