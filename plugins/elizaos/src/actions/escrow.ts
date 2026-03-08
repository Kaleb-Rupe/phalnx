import { getOrCreateShieldedWallet } from "../client-factory";

export const createEscrowAction = {
  name: "SHIELD_CREATE_ESCROW",
  similes: ["CREATE_ESCROW", "ESCROW_CREATE", "NEW_ESCROW"],
  description:
    "Create an inter-vault escrow deposit with optional condition hash and expiry.",
  validate: async (_runtime: any, _message: any) => true,
  handler: async (
    _runtime: any,
    _message: any,
    _state: any,
    _options: any,
    callback: (response: any) => void,
  ) => {
    try {
      const { wallet } = await getOrCreateShieldedWallet(_runtime);
      const summary = wallet.getSpendingSummary();
      callback({
        text: `Escrow creation requires on-chain transaction composition.\nWallet: ${summary.isPaused ? "PAUSED" : "ACTIVE"}\nUse SDK buildCreateEscrow() to execute.`,
        content: { success: true, action: "create_escrow" },
      });
      return true;
    } catch (error: any) {
      callback({
        text: `Failed: ${error.message}`,
        content: { success: false, error: error.message },
      });
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Create an escrow to vault ABC for 100 USDC" },
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Escrow creation requires on-chain transaction composition.",
          action: "SHIELD_CREATE_ESCROW",
        },
      },
    ],
  ],
};

export const settleEscrowAction = {
  name: "SHIELD_SETTLE_ESCROW",
  similes: ["SETTLE_ESCROW", "ESCROW_SETTLE", "CLAIM_ESCROW"],
  description:
    "Settle an active escrow, releasing funds to the destination vault.",
  validate: async (_runtime: any, _message: any) => true,
  handler: async (
    _runtime: any,
    _message: any,
    _state: any,
    _options: any,
    callback: (response: any) => void,
  ) => {
    try {
      callback({
        text: "Escrow settlement requires destination agent authorization.\nUse SDK buildSettleEscrow() to execute.",
        content: { success: true, action: "settle_escrow" },
      });
      return true;
    } catch (error: any) {
      callback({
        text: `Failed: ${error.message}`,
        content: { success: false, error: error.message },
      });
      return false;
    }
  },
  examples: [
    [
      { user: "{{user1}}", content: { text: "Settle escrow XYZ" } },
      {
        user: "{{agentName}}",
        content: {
          text: "Escrow settlement requires destination agent authorization.",
          action: "SHIELD_SETTLE_ESCROW",
        },
      },
    ],
  ],
};

export const refundEscrowAction = {
  name: "SHIELD_REFUND_ESCROW",
  similes: ["REFUND_ESCROW", "ESCROW_REFUND", "CANCEL_ESCROW"],
  description: "Refund an expired escrow, returning funds to the source vault.",
  validate: async (_runtime: any, _message: any) => true,
  handler: async (
    _runtime: any,
    _message: any,
    _state: any,
    _options: any,
    callback: (response: any) => void,
  ) => {
    try {
      callback({
        text: "Escrow refund only available after expiry.\nCap is NOT reversed (prevents cap-washing).\nUse SDK buildRefundEscrow() to execute.",
        content: { success: true, action: "refund_escrow" },
      });
      return true;
    } catch (error: any) {
      callback({
        text: `Failed: ${error.message}`,
        content: { success: false, error: error.message },
      });
      return false;
    }
  },
  examples: [
    [
      { user: "{{user1}}", content: { text: "Refund expired escrow ABC" } },
      {
        user: "{{agentName}}",
        content: {
          text: "Escrow refund only available after expiry.",
          action: "SHIELD_REFUND_ESCROW",
        },
      },
    ],
  ],
};
