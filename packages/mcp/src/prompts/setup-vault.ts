/**
 * setup-vault prompt — Structured agent workflow for vault initialization.
 *
 * Returns a sequence of tool calls the agent should follow to go from
 * unconfigured → fully operational vault with an active agent.
 */

import { z } from "zod";

export const setupVaultArgsSchema = {
  network: z
    .enum(["devnet", "mainnet-beta"])
    .default("devnet")
    .describe("Target Solana cluster"),
  agentPermissions: z
    .string()
    .optional()
    .describe(
      "Comma-separated permission names (e.g. 'swap,deposit'). Defaults to full permissions.",
    ),
};

export interface SetupVaultArgs {
  network?: string;
  agentPermissions?: string;
}

export function setupVaultPrompt(args: SetupVaultArgs) {
  const network = args.network ?? "devnet";
  const permissions = args.agentPermissions ?? "all";

  return {
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: JSON.stringify(
            {
              workflow: "setup-vault",
              network,
              requestedPermissions: permissions,
              steps: [
                {
                  step: 1,
                  tool: "phalnx_setup",
                  input: { step: "status" },
                  purpose: "Check current configuration state",
                  onSuccess: "If configured, skip to step 3",
                  onFailure: "Continue to step 2",
                },
                {
                  step: 2,
                  tool: "phalnx_setup",
                  input: {
                    step: "configure",
                    params: { network },
                  },
                  purpose: "Generate wallet keypair and set RPC endpoint",
                  onFailure: "STOP — cannot proceed without wallet",
                },
                {
                  step: 3,
                  tool: "phalnx_setup",
                  input: { step: "discoverVault" },
                  purpose:
                    "Find existing vault or determine need to create one",
                  onSuccess: "If vault found, skip to step 5",
                  onFailure: "Continue to step 4",
                },
                {
                  step: 4,
                  tool: "phalnx_manage",
                  input: {
                    action: "createVault",
                    params: {},
                  },
                  purpose: "Create new vault with default policy",
                  onFailure: "STOP — vault creation failed",
                },
                {
                  step: 5,
                  tool: "phalnx_query",
                  input: { query: "vault" },
                  purpose: "Verify vault state and agent registration",
                  check: "Confirm agent is in vault.agents array",
                },
                {
                  step: 6,
                  tool: "phalnx_advise",
                  input: { question: "whatCanIDo" },
                  purpose: "Verify agent permissions and available actions",
                },
              ],
              completionCriteria: {
                vaultActive: true,
                agentRegistered: true,
                permissionsVerified: true,
              },
            },
            null,
            2,
          ),
        },
      },
    ],
  };
}
