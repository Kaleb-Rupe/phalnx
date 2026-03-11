/**
 * phalnx_manage — Owner-only vault management actions.
 */

import { z } from "zod";
import type { PhalnxClient } from "@phalnx/sdk";
import { formatError } from "../errors";
import {
  loadShieldConfig,
  type McpConfig,
  type CustodyWalletLike,
} from "../config";

// Import existing tool handlers for delegation
import { createVault } from "../tools/create-vault";
import { deposit } from "../tools/deposit";
import { withdraw } from "../tools/withdraw";
import { registerAgent } from "../tools/register-agent";
import { revokeAgent } from "../tools/revoke-agent";
import { updatePolicy } from "../tools/update-policy";
import { queuePolicyUpdate } from "../tools/queue-policy-update";
import { applyPendingPolicy } from "../tools/apply-pending-policy";
import { cancelPendingPolicy } from "../tools/cancel-pending-policy";
import { freezeVault } from "../tools/freeze-vault";
import { reactivateVault } from "../tools/reactivate-vault";
import { pauseAgent } from "../tools/pause-agent";
import { unpauseAgent } from "../tools/unpause-agent";
import { updateAgentPermissions } from "../tools/update-agent-permissions";
import { createConstraints } from "../tools/create-constraints";
import { updateConstraints } from "../tools/update-constraints";
import { closeConstraints } from "../tools/close-constraints";
import { queueConstraintsUpdate as queueConstraintsUpdateHandler } from "../tools/queue-constraints-update";
import { applyConstraintsUpdate } from "../tools/apply-constraints-update";
import { cancelConstraintsUpdate } from "../tools/cancel-constraints-update";
import { syncPositions } from "../tools/sync-positions";
import { closeSettledEscrow } from "../tools/close-settled-escrow";
import { squadsCreateMultisig } from "../tools/squads-create-multisig";
import { squadsProposeAction } from "../tools/squads-propose-action";
import { squadsApprove } from "../tools/squads-approve";
import { squadsReject } from "../tools/squads-reject";
import { squadsExecute } from "../tools/squads-execute";

export const phalnxManageSchema = z.object({
  action: z
    .enum([
      "createVault",
      "deposit",
      "withdraw",
      "registerAgent",
      "revokeAgent",
      "updatePolicy",
      "queuePolicyUpdate",
      "applyPendingPolicy",
      "cancelPendingPolicy",
      "freezeVault",
      "reactivateVault",
      "pauseAgent",
      "unpauseAgent",
      "updateAgentPermissions",
      "createConstraints",
      "updateConstraints",
      "closeConstraints",
      "queueConstraintsUpdate",
      "applyConstraintsUpdate",
      "cancelConstraintsUpdate",
      "syncPositions",
      "closeSettledEscrow",
      "squadsCreate",
      "squadsPropose",
      "squadsApprove",
      "squadsReject",
      "squadsExecute",
    ])
    .describe("Management action to execute"),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Action-specific parameters"),
  vault: z.string().optional().describe("Vault PDA address (base58)"),
});

export type PhalnxManageInput = z.infer<typeof phalnxManageSchema>;

export async function phalnxManage(
  client: PhalnxClient,
  config: McpConfig,
  input: PhalnxManageInput,
  _custodyWallet?: CustodyWalletLike | null,
): Promise<string> {
  try {
    const defaultVault = loadShieldConfig()?.layers.vault.address ?? undefined;
    const params = {
      ...(input.params ?? {}),
      vault: input.vault ?? (input.params?.vault as string) ?? defaultVault,
    };

    // Delegate to the appropriate existing handler.
    // Signatures: 2-arg (client, input), 3-arg (client, config, input)
    switch (input.action) {
      // 2-arg handlers: (client, input)
      case "createVault":
        return createVault(client, params as any);
      case "deposit":
        return deposit(client, params as any);
      case "withdraw":
        return withdraw(client, params as any);
      case "registerAgent":
        return registerAgent(client, params as any);
      case "revokeAgent":
        return revokeAgent(client, params as any);
      case "updatePolicy":
        return updatePolicy(client, params as any);
      case "queuePolicyUpdate":
        return queuePolicyUpdate(client, params as any);
      case "applyPendingPolicy":
        return applyPendingPolicy(client, params as any);
      case "cancelPendingPolicy":
        return cancelPendingPolicy(client, params as any);
      case "freezeVault":
        return freezeVault(client, params as any);
      case "reactivateVault":
        return reactivateVault(client, params as any);
      case "pauseAgent":
        return pauseAgent(client, params as any);
      case "unpauseAgent":
        return unpauseAgent(client, params as any);
      case "updateAgentPermissions":
        return updateAgentPermissions(client, params as any);
      case "createConstraints":
        return createConstraints(client, params as any);
      case "updateConstraints":
        return updateConstraints(client, params as any);
      case "closeConstraints":
        return closeConstraints(client, params as any);
      case "queueConstraintsUpdate":
        return queueConstraintsUpdateHandler(client, params as any);
      case "applyConstraintsUpdate":
        return applyConstraintsUpdate(client, params as any);
      case "cancelConstraintsUpdate":
        return cancelConstraintsUpdate(client, params as any);
      case "closeSettledEscrow":
        return closeSettledEscrow(client, params as any);

      // 3-arg handlers: (client, config, input)
      case "syncPositions":
        return syncPositions(client, config, params as any);
      case "squadsCreate":
        return squadsCreateMultisig(client, config, params as any);
      case "squadsPropose":
        return squadsProposeAction(client, config, params as any);
      case "squadsApprove":
        return squadsApprove(client, config, params as any);
      case "squadsReject":
        return squadsReject(client, config, params as any);
      case "squadsExecute":
        return squadsExecute(client, config, params as any);

      default:
        return `Unknown management action: ${input.action}`;
    }
  } catch (error) {
    return formatError(error);
  }
}
