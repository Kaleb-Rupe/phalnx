/**
 * emergency-freeze prompt — Structured emergency response procedure.
 *
 * Guides an agent through threat assessment, vault freeze, and
 * post-freeze verification. Agent-first: all steps are tool calls
 * with structured inputs, not prose instructions.
 */

import { z } from "zod";

export const emergencyFreezeArgsSchema = {
  reason: z
    .enum([
      "suspicious_activity",
      "compromised_key",
      "policy_violation",
      "manual",
    ])
    .describe("Why the freeze is being initiated"),
  vault: z
    .string()
    .optional()
    .describe("Vault address to freeze (uses configured vault if omitted)"),
};

export interface EmergencyFreezeArgs {
  reason: string;
  vault?: string;
}

export function emergencyFreezePrompt(args: EmergencyFreezeArgs) {
  const vaultParam = args.vault ? { vault: args.vault } : {};

  return {
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: JSON.stringify(
            {
              workflow: "emergency-freeze",
              severity: "CRITICAL",
              reason: args.reason,
              steps: [
                {
                  step: 1,
                  tool: "phalnx_query",
                  input: {
                    query: "vault",
                    params: vaultParam,
                  },
                  purpose: "Capture pre-freeze vault state for audit trail",
                  record: [
                    "vaultStatus",
                    "agentCount",
                    "totalTransactions",
                    "openPositions",
                  ],
                },
                {
                  step: 2,
                  tool: "phalnx_query",
                  input: {
                    query: "spending",
                    params: vaultParam,
                  },
                  purpose: "Record current spending state before freeze",
                  record: ["totalSpent24h", "remainingCapUsd"],
                },
                {
                  step: 3,
                  tool: "phalnx_manage",
                  input: {
                    action: "freezeVault",
                    params: vaultParam,
                  },
                  purpose:
                    "FREEZE the vault — all agent operations blocked immediately",
                  critical: true,
                  onFailure: {
                    action: "ESCALATE",
                    message:
                      "Freeze failed — vault may still be operational. Notify owner immediately.",
                  },
                },
                {
                  step: 4,
                  tool: "phalnx_query",
                  input: {
                    query: "vault",
                    params: vaultParam,
                  },
                  purpose: "Verify vault status is now 'frozen'",
                  check: "status === 'frozen'",
                  onFailure: {
                    action: "RETRY_STEP_3",
                    message: "Vault not frozen — retry freeze operation",
                  },
                },
                {
                  step: 5,
                  tool: "phalnx_query",
                  input: {
                    query: "activity",
                    params: vaultParam,
                  },
                  purpose: "Review recent activity for suspicious transactions",
                  analyze: "Flag any unexpected transfers or position changes",
                },
              ],
              postFreeze: {
                vaultState: "frozen",
                agentOperations: "blocked",
                ownerOperations: "allowed (withdraw, reactivate)",
                nextSteps: [
                  "Investigate root cause using activity log",
                  "If compromised key: revoke agent, generate new keypair",
                  "If false alarm: reactivate vault with phalnx_manage action='reactivateVault'",
                  "Review policy for tighter constraints",
                ],
              },
              auditFields: {
                timestamp: "ISO 8601",
                reason: args.reason,
                initiator: "agent",
                preFreeze: "captured in steps 1-2",
                postFreeze: "captured in steps 4-5",
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
