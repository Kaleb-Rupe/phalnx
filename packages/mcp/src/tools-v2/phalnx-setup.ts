/**
 * phalnx_setup — One-time setup and onboarding.
 * Works even without a configured SDK client.
 */

import { z } from "zod";
import type { PhalnxClient } from "@phalnx/sdk";
import { formatError } from "../errors";
import { type McpConfig, type CustodyWalletLike } from "../config";

// Re-use existing setup tool handlers
import { setupStatus } from "../tools/setup-status";
import { configure } from "../tools/configure";
import { configureFromFile } from "../tools/configure-from-file";
import { fundWallet } from "../tools/fund-wallet";
import { discoverVault } from "../tools/discover-vault";
import { confirmVault } from "../tools/confirm-vault";
import { provision } from "../tools/provision";

export const phalnxSetupSchema = z.object({
  step: z
    .enum([
      "status",
      "configure",
      "configureFromFile",
      "fundWallet",
      "discoverVault",
      "confirmVault",
      "provision",
    ])
    .describe("Setup step to execute"),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Step-specific parameters"),
});

export type PhalnxSetupInput = z.infer<typeof phalnxSetupSchema>;

export async function phalnxSetup(
  client: PhalnxClient | null,
  config: McpConfig | null,
  input: PhalnxSetupInput,
  _custodyWallet?: CustodyWalletLike | null,
): Promise<string> {
  try {
    const params = input.params ?? {};

    switch (input.step) {
      case "status":
        return setupStatus(null, params as any);
      case "configure":
        return configure(null, params as any);
      case "configureFromFile":
        return configureFromFile(null, params as any);
      case "fundWallet":
        return fundWallet(null, params as any);
      case "discoverVault":
        return discoverVault(client, params as any);
      case "confirmVault":
        return confirmVault(client, params as any);
      case "provision":
        return provision(client, params as any);
      default:
        return `Unknown setup step: ${input.step}`;
    }
  } catch (error) {
    return formatError(error);
  }
}
