import { expect } from "chai";
import {
  ACTION_TYPE_MAP,
  DEFAULT_INTENT_TTL_MS,
  summarizeAction,
  resolveProtocolActionType,
  type IntentAction,
  type IntentActionType,
  type ProtocolRegistryLike,
} from "../src/intents.js";
import { ActionType } from "../src/generated/types/actionType.js";
import {
  validateIntentInput,
  type ValidationResult,
} from "../src/intent-validator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Valid base58 address for tests (USDC devnet) */
const VALID_ADDRESS = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const VALID_ADDRESS_2 = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** All 31+ intent action type strings */
const ALL_INTENT_TYPES: IntentActionType[] = Object.keys(
  ACTION_TYPE_MAP,
) as IntentActionType[];

function expectValid(result: ValidationResult): void {
  expect(
    result.valid,
    `Expected valid but got errors: ${JSON.stringify(result.errors)}`,
  ).to.be.true;
  expect(result.errors).to.have.length(0);
}

function expectInvalid(result: ValidationResult, minErrors = 1): void {
  expect(result.valid).to.be.false;
  expect(result.errors.length).to.be.at.least(minErrors);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("intents", () => {
  describe("DEFAULT_INTENT_TTL_MS", () => {
    it("equals 1 hour in milliseconds", () => {
      expect(DEFAULT_INTENT_TTL_MS).to.equal(3_600_000);
    });
  });

  describe("ACTION_TYPE_MAP", () => {
    it("has entries for all 35 IntentAction types", () => {
      // 21 base + 5 drift + 7 kamino + 1 protocol + 1 passthrough = 35
      expect(ALL_INTENT_TYPES.length).to.equal(35);
    });

    it("every entry has an ActionType enum value and isSpending boolean", () => {
      for (const key of ALL_INTENT_TYPES) {
        const entry = ACTION_TYPE_MAP[key];
        expect(entry, `Missing entry for ${key}`).to.exist;
        expect(typeof entry.actionType).to.equal("number");
        expect(typeof entry.isSpending).to.equal("boolean");
      }
    });

    it("swap maps to ActionType.Swap and isSpending=true", () => {
      expect(ACTION_TYPE_MAP.swap.actionType).to.equal(ActionType.Swap);
      expect(ACTION_TYPE_MAP.swap.isSpending).to.be.true;
    });

    it("closePosition maps to ActionType.ClosePosition and isSpending=false", () => {
      expect(ACTION_TYPE_MAP.closePosition.actionType).to.equal(
        ActionType.ClosePosition,
      );
      expect(ACTION_TYPE_MAP.closePosition.isSpending).to.be.false;
    });

    it("all 9 spending base types have isSpending=true", () => {
      const spendingTypes: IntentActionType[] = [
        "swap",
        "openPosition",
        "increasePosition",
        "deposit",
        "transfer",
        "addCollateral",
        "placeLimitOrder",
        "swapAndOpenPosition",
        "createEscrow",
      ];
      for (const t of spendingTypes) {
        expect(ACTION_TYPE_MAP[t].isSpending, `${t} should be spending`).to.be
          .true;
      }
    });

    it("all 12 non-spending base types have isSpending=false", () => {
      const nonSpendingTypes: IntentActionType[] = [
        "closePosition",
        "decreasePosition",
        "withdraw",
        "removeCollateral",
        "placeTriggerOrder",
        "editTriggerOrder",
        "cancelTriggerOrder",
        "editLimitOrder",
        "cancelLimitOrder",
        "closeAndSwapPosition",
        "settleEscrow",
        "refundEscrow",
      ];
      for (const t of nonSpendingTypes) {
        expect(ACTION_TYPE_MAP[t].isSpending, `${t} should be non-spending`).to
          .be.false;
      }
    });

    it("drift types map to correct base ActionTypes", () => {
      expect(ACTION_TYPE_MAP.driftDeposit.actionType).to.equal(
        ActionType.Deposit,
      );
      expect(ACTION_TYPE_MAP.driftWithdraw.actionType).to.equal(
        ActionType.Withdraw,
      );
      expect(ACTION_TYPE_MAP.driftPerpOrder.actionType).to.equal(
        ActionType.OpenPosition,
      );
      expect(ACTION_TYPE_MAP.driftSpotOrder.actionType).to.equal(
        ActionType.Swap,
      );
      expect(ACTION_TYPE_MAP.driftCancelOrder.actionType).to.equal(
        ActionType.CancelLimitOrder,
      );
    });

    it("kamino types map to correct base ActionTypes", () => {
      expect(ACTION_TYPE_MAP.kaminoDeposit.actionType).to.equal(
        ActionType.Deposit,
      );
      expect(ACTION_TYPE_MAP.kaminoBorrow.actionType).to.equal(
        ActionType.Withdraw,
      );
      expect(ACTION_TYPE_MAP.kaminoRepay.actionType).to.equal(
        ActionType.Deposit,
      );
      expect(ACTION_TYPE_MAP.kaminoWithdraw.actionType).to.equal(
        ActionType.Withdraw,
      );
    });

    it("protocol and passthrough default to Swap", () => {
      expect(ACTION_TYPE_MAP.protocol.actionType).to.equal(ActionType.Swap);
      expect(ACTION_TYPE_MAP.passthrough.actionType).to.equal(ActionType.Swap);
    });
  });

  describe("summarizeAction", () => {
    it("produces non-empty string for every action type", () => {
      const testActions: IntentAction[] = [
        {
          type: "swap",
          params: {
            inputMint: VALID_ADDRESS,
            outputMint: VALID_ADDRESS_2,
            amount: "1000000",
          },
        },
        {
          type: "openPosition",
          params: {
            market: "SOL-PERP",
            side: "long",
            collateral: "100",
            leverage: 5,
          },
        },
        { type: "closePosition", params: { market: "SOL-PERP" } },
        {
          type: "transfer",
          params: {
            destination: VALID_ADDRESS,
            mint: VALID_ADDRESS_2,
            amount: "500",
          },
        },
        { type: "deposit", params: { mint: VALID_ADDRESS, amount: "1000" } },
        { type: "withdraw", params: { mint: VALID_ADDRESS, amount: "1000" } },
        {
          type: "increasePosition",
          params: {
            market: "SOL-PERP",
            side: "long",
            sizeDelta: "100",
            collateralAmount: "50",
          },
        },
        {
          type: "decreasePosition",
          params: { market: "SOL-PERP", side: "short", sizeDelta: "50" },
        },
        {
          type: "addCollateral",
          params: { market: "SOL-PERP", side: "long", collateralAmount: "25" },
        },
        {
          type: "removeCollateral",
          params: {
            market: "SOL-PERP",
            side: "long",
            collateralDeltaUsd: "10",
          },
        },
        {
          type: "placeTriggerOrder",
          params: {
            market: "SOL-PERP",
            side: "long",
            triggerPrice: "150",
            deltaSizeAmount: "100",
            isStopLoss: true,
          },
        },
        {
          type: "editTriggerOrder",
          params: {
            market: "SOL-PERP",
            side: "long",
            orderId: "abc",
            triggerPrice: "155",
            deltaSizeAmount: "100",
            isStopLoss: false,
          },
        },
        {
          type: "cancelTriggerOrder",
          params: {
            market: "SOL-PERP",
            side: "long",
            orderId: "abc",
            isStopLoss: true,
          },
        },
        {
          type: "placeLimitOrder",
          params: {
            market: "SOL-PERP",
            side: "long",
            reserveAmount: "100",
            sizeAmount: "200",
            limitPrice: "140",
          },
        },
        {
          type: "editLimitOrder",
          params: {
            market: "SOL-PERP",
            side: "short",
            orderId: "xyz",
            reserveAmount: "100",
            sizeAmount: "200",
            limitPrice: "140",
          },
        },
        {
          type: "cancelLimitOrder",
          params: { market: "SOL-PERP", side: "long", orderId: "xyz" },
        },
        {
          type: "swapAndOpenPosition",
          params: {
            inputMint: VALID_ADDRESS,
            outputMint: VALID_ADDRESS_2,
            amount: "1000",
            market: "SOL-PERP",
            side: "long",
            sizeAmount: "500",
            leverageBps: 50000,
          },
        },
        {
          type: "closeAndSwapPosition",
          params: {
            market: "SOL-PERP",
            side: "short",
            outputMint: VALID_ADDRESS,
          },
        },
        {
          type: "createEscrow",
          params: {
            destinationVault: VALID_ADDRESS,
            amount: "1000",
            mint: VALID_ADDRESS_2,
            expiresInSeconds: 86400,
          },
        },
        {
          type: "settleEscrow",
          params: { sourceVault: VALID_ADDRESS, escrowId: "esc-1" },
        },
        {
          type: "refundEscrow",
          params: { destinationVault: VALID_ADDRESS, escrowId: "esc-1" },
        },
        {
          type: "driftDeposit",
          params: { mint: VALID_ADDRESS, amount: "500", marketIndex: 0 },
        },
        {
          type: "driftWithdraw",
          params: { mint: VALID_ADDRESS, amount: "500", marketIndex: 0 },
        },
        {
          type: "driftPerpOrder",
          params: {
            marketIndex: 0,
            side: "long",
            amount: "100",
            orderType: "market",
          },
        },
        {
          type: "driftSpotOrder",
          params: {
            marketIndex: 1,
            side: "short",
            amount: "200",
            orderType: "limit",
          },
        },
        { type: "driftCancelOrder", params: { orderId: 42 } },
        {
          type: "kaminoDeposit",
          params: {
            tokenMint: "USDC",
            amount: "1000",
            obligation: VALID_ADDRESS,
          },
        },
        {
          type: "kaminoBorrow",
          params: {
            tokenMint: "USDC",
            amount: "500",
            obligation: VALID_ADDRESS,
          },
        },
        {
          type: "kaminoRepay",
          params: {
            tokenMint: "USDC",
            amount: "500",
            obligation: VALID_ADDRESS,
          },
        },
        {
          type: "kaminoWithdraw",
          params: {
            tokenMint: "USDC",
            amount: "1000",
            obligation: VALID_ADDRESS,
          },
        },
        {
          type: "kaminoVaultDeposit",
          params: { kvault: VALID_ADDRESS, amount: "1000" },
        },
        {
          type: "kaminoVaultWithdraw",
          params: { kvault: VALID_ADDRESS, amount: "1000" },
        },
        {
          type: "kaminoMultiply",
          params: { depositToken: "USDC", borrowToken: "SOL", amount: "1000" },
        },
        {
          type: "protocol",
          params: { protocolId: "custom-dex", action: "swap" },
        },
        {
          type: "passthrough",
          params: {
            programId: VALID_ADDRESS,
            instructions: [
              {
                programId: VALID_ADDRESS,
                keys: [],
                data: "AQID",
              },
            ],
            actionType: "swap",
          },
        },
      ];

      // Verify we covered every type
      const coveredTypes = new Set(testActions.map((a) => a.type));
      for (const t of ALL_INTENT_TYPES) {
        expect(coveredTypes.has(t), `Missing summarize test for ${t}`).to.be
          .true;
      }

      for (const action of testActions) {
        const summary = summarizeAction(action);
        expect(summary, `Empty summary for ${action.type}`).to.be.a("string");
        expect(
          summary.length,
          `Summary too short for ${action.type}`,
        ).to.be.greaterThan(0);
      }
    });

    it("swap summary includes mints and amount", () => {
      const summary = summarizeAction({
        type: "swap",
        params: {
          inputMint: "USDC",
          outputMint: "SOL",
          amount: "1000000",
        },
      });
      expect(summary).to.include("USDC");
      expect(summary).to.include("SOL");
      expect(summary).to.include("1000000");
    });

    it("closePosition summary includes positionId when present", () => {
      const withId = summarizeAction({
        type: "closePosition",
        params: { market: "SOL-PERP", positionId: "pos-123" },
      });
      expect(withId).to.include("pos-123");

      const withoutId = summarizeAction({
        type: "closePosition",
        params: { market: "SOL-PERP" },
      });
      expect(withoutId).to.not.include("pos-");
    });

    it("placeTriggerOrder summary distinguishes stop-loss vs take-profit", () => {
      const sl = summarizeAction({
        type: "placeTriggerOrder",
        params: {
          market: "SOL-PERP",
          side: "long",
          triggerPrice: "100",
          deltaSizeAmount: "50",
          isStopLoss: true,
        },
      });
      expect(sl).to.include("stop-loss");

      const tp = summarizeAction({
        type: "placeTriggerOrder",
        params: {
          market: "SOL-PERP",
          side: "long",
          triggerPrice: "100",
          deltaSizeAmount: "50",
          isStopLoss: false,
        },
      });
      expect(tp).to.include("take-profit");
    });
  });

  describe("resolveProtocolActionType", () => {
    it("returns registry entry when protocol and action match", () => {
      const registry: ProtocolRegistryLike = {
        getByProtocolId: (id: string) => {
          if (id === "marinade") {
            return {
              metadata: {
                supportedActions: new Map([
                  [
                    "stake",
                    { actionType: ActionType.Deposit, isSpending: true },
                  ],
                ]),
              },
            };
          }
          return undefined;
        },
      };

      const result = resolveProtocolActionType(registry, "marinade", "stake");
      expect(result.actionType).to.equal(ActionType.Deposit);
      expect(result.isSpending).to.be.true;
    });

    it("falls back to default for unknown protocol", () => {
      const registry: ProtocolRegistryLike = {
        getByProtocolId: () => undefined,
      };

      const result = resolveProtocolActionType(
        registry,
        "unknown-protocol",
        "doSomething",
      );
      expect(result.actionType).to.equal(ActionType.Swap);
      expect(result.isSpending).to.be.true;
    });

    it("falls back to default for unknown action on known protocol", () => {
      const registry: ProtocolRegistryLike = {
        getByProtocolId: (id: string) => {
          if (id === "marinade") {
            return {
              metadata: {
                supportedActions: new Map([
                  [
                    "stake",
                    { actionType: ActionType.Deposit, isSpending: true },
                  ],
                ]),
              },
            };
          }
          return undefined;
        },
      };

      const result = resolveProtocolActionType(
        registry,
        "marinade",
        "unknownAction",
      );
      expect(result.actionType).to.equal(ActionType.Swap);
      expect(result.isSpending).to.be.true;
    });
  });
});

describe("intent-validator", () => {
  describe("validateIntentInput - error cases", () => {
    it("catches negative amount", () => {
      const result = validateIntentInput({
        type: "swap",
        params: {
          inputMint: VALID_ADDRESS,
          outputMint: VALID_ADDRESS_2,
          amount: "-100",
        },
      });
      expectInvalid(result);
      expect(result.errors[0].context["field"]).to.equal("amount");
    });

    it("catches NaN amount", () => {
      const result = validateIntentInput({
        type: "deposit",
        params: { mint: VALID_ADDRESS, amount: "not-a-number" },
      });
      expectInvalid(result);
      expect(result.errors[0].message).to.include("not a valid number");
    });

    it("catches empty string amount", () => {
      const result = validateIntentInput({
        type: "withdraw",
        params: { mint: VALID_ADDRESS, amount: "" },
      });
      expectInvalid(result);
    });

    it("catches invalid base58 address", () => {
      const result = validateIntentInput({
        type: "transfer",
        params: {
          destination: "0xNotBase58!!!",
          mint: VALID_ADDRESS,
          amount: "100",
        },
      });
      expectInvalid(result);
      expect(result.errors[0].context["field"]).to.equal("destination");
    });

    it("catches overflow u64 amount", () => {
      const result = validateIntentInput({
        type: "deposit",
        params: { mint: VALID_ADDRESS, amount: "99999999999999999999" },
      });
      expectInvalid(result);
      expect(result.errors[0].message).to.include("u64");
    });

    it("catches zero amount", () => {
      const result = validateIntentInput({
        type: "deposit",
        params: { mint: VALID_ADDRESS, amount: "0" },
      });
      expectInvalid(result);
      expect(result.errors[0].message).to.include("positive");
    });
  });

  describe("validateIntentInput - valid cases", () => {
    it("valid swap passes", () => {
      const result = validateIntentInput({
        type: "swap",
        params: {
          inputMint: VALID_ADDRESS,
          outputMint: VALID_ADDRESS_2,
          amount: "1000000",
          slippageBps: 50,
        },
      });
      expectValid(result);
    });

    it("valid openPosition passes", () => {
      const result = validateIntentInput({
        type: "openPosition",
        params: {
          market: "SOL-PERP",
          side: "long",
          collateral: "100",
          leverage: 5,
        },
      });
      expectValid(result);
    });

    it("valid transfer passes", () => {
      const result = validateIntentInput({
        type: "transfer",
        params: {
          destination: VALID_ADDRESS,
          mint: VALID_ADDRESS_2,
          amount: "500000000",
        },
      });
      expectValid(result);
    });

    it("valid createEscrow passes", () => {
      const result = validateIntentInput({
        type: "createEscrow",
        params: {
          destinationVault: VALID_ADDRESS,
          amount: "1000000",
          mint: VALID_ADDRESS_2,
          expiresInSeconds: 86400,
        },
      });
      expectValid(result);
    });

    it("valid deposit passes", () => {
      const result = validateIntentInput({
        type: "deposit",
        params: { mint: VALID_ADDRESS, amount: "500" },
      });
      expectValid(result);
    });

    it("valid withdraw passes", () => {
      const result = validateIntentInput({
        type: "withdraw",
        params: { mint: VALID_ADDRESS, amount: "500" },
      });
      expectValid(result);
    });
  });

  describe("validateIntentInput - spot-check all types", () => {
    it("closePosition with valid market", () => {
      expectValid(
        validateIntentInput({
          type: "closePosition",
          params: { market: "SOL-PERP" },
        }),
      );
    });

    it("increasePosition with valid params", () => {
      expectValid(
        validateIntentInput({
          type: "increasePosition",
          params: {
            market: "SOL-PERP",
            side: "long",
            sizeDelta: "100",
            collateralAmount: "50",
          },
        }),
      );
    });

    it("decreasePosition with valid params", () => {
      expectValid(
        validateIntentInput({
          type: "decreasePosition",
          params: { market: "SOL-PERP", side: "short", sizeDelta: "50" },
        }),
      );
    });

    it("addCollateral with valid params", () => {
      expectValid(
        validateIntentInput({
          type: "addCollateral",
          params: { market: "SOL-PERP", side: "long", collateralAmount: "25" },
        }),
      );
    });

    it("removeCollateral with valid params", () => {
      expectValid(
        validateIntentInput({
          type: "removeCollateral",
          params: {
            market: "SOL-PERP",
            side: "long",
            collateralDeltaUsd: "10",
          },
        }),
      );
    });

    it("placeTriggerOrder with valid params", () => {
      expectValid(
        validateIntentInput({
          type: "placeTriggerOrder",
          params: {
            market: "SOL-PERP",
            side: "long",
            triggerPrice: "150",
            deltaSizeAmount: "100",
            isStopLoss: true,
          },
        }),
      );
    });

    it("placeLimitOrder with valid params", () => {
      expectValid(
        validateIntentInput({
          type: "placeLimitOrder",
          params: {
            market: "SOL-PERP",
            side: "long",
            reserveAmount: "100",
            sizeAmount: "200",
            limitPrice: "140",
          },
        }),
      );
    });

    it("cancelLimitOrder with valid params", () => {
      expectValid(
        validateIntentInput({
          type: "cancelLimitOrder",
          params: { market: "SOL-PERP", side: "long", orderId: "ord-1" },
        }),
      );
    });

    it("settleEscrow with valid params", () => {
      expectValid(
        validateIntentInput({
          type: "settleEscrow",
          params: { sourceVault: VALID_ADDRESS, escrowId: "esc-1" },
        }),
      );
    });

    it("refundEscrow with valid params", () => {
      expectValid(
        validateIntentInput({
          type: "refundEscrow",
          params: { destinationVault: VALID_ADDRESS, escrowId: "esc-1" },
        }),
      );
    });

    it("driftDeposit with valid params", () => {
      expectValid(
        validateIntentInput({
          type: "driftDeposit",
          params: { mint: VALID_ADDRESS, amount: "500", marketIndex: 0 },
        }),
      );
    });

    it("driftPerpOrder with valid params", () => {
      expectValid(
        validateIntentInput({
          type: "driftPerpOrder",
          params: {
            marketIndex: 0,
            side: "long",
            amount: "100",
            orderType: "market",
          },
        }),
      );
    });

    it("kaminoDeposit with valid params", () => {
      expectValid(
        validateIntentInput({
          type: "kaminoDeposit",
          params: {
            tokenMint: "USDC",
            amount: "1000",
            obligation: VALID_ADDRESS,
          },
        }),
      );
    });

    it("kaminoDeposit rejects missing obligation", () => {
      const result = validateIntentInput({
        type: "kaminoDeposit",
        params: { tokenMint: "USDC", amount: "1000", obligation: "" },
      } as IntentAction);
      expectInvalid(result);
      expect(result.errors[0].context["field"]).to.equal("obligation");
    });

    it("kaminoDeposit rejects missing tokenMint", () => {
      const result = validateIntentInput({
        type: "kaminoDeposit",
        params: { tokenMint: "", amount: "1000", obligation: VALID_ADDRESS },
      } as IntentAction);
      expectInvalid(result);
      expect(result.errors[0].context["field"]).to.equal("tokenMint");
    });

    it("protocol with valid params", () => {
      expectValid(
        validateIntentInput({
          type: "protocol",
          params: { protocolId: "custom-dex", action: "swap" },
        }),
      );
    });

    it("passthrough with valid params", () => {
      expectValid(
        validateIntentInput({
          type: "passthrough",
          params: {
            programId: VALID_ADDRESS,
            instructions: [
              {
                programId: VALID_ADDRESS,
                keys: [],
                data: "AQID",
              },
            ],
            actionType: "swap",
          },
        }),
      );
    });
  });

  describe("validateIntentInput - escrow duration edge cases", () => {
    it("rejects duration exceeding MAX_ESCROW_DURATION", () => {
      const result = validateIntentInput({
        type: "createEscrow",
        params: {
          destinationVault: VALID_ADDRESS,
          amount: "1000",
          mint: VALID_ADDRESS_2,
          expiresInSeconds: 2_592_001,
        },
      });
      expectInvalid(result);
      expect(result.errors[0].message).to.include("maximum");
    });

    it("rejects zero duration", () => {
      const result = validateIntentInput({
        type: "createEscrow",
        params: {
          destinationVault: VALID_ADDRESS,
          amount: "1000",
          mint: VALID_ADDRESS_2,
          expiresInSeconds: 0,
        },
      });
      expectInvalid(result);
    });

    it("accepts MAX_ESCROW_DURATION exactly", () => {
      expectValid(
        validateIntentInput({
          type: "createEscrow",
          params: {
            destinationVault: VALID_ADDRESS,
            amount: "1000",
            mint: VALID_ADDRESS_2,
            expiresInSeconds: 2_592_000,
          },
        }),
      );
    });
  });

  describe("validateIntentInput - slippage edge cases", () => {
    it("rejects slippage > 5000 (on-chain MAX_SLIPPAGE_BPS)", () => {
      const result = validateIntentInput({
        type: "swap",
        params: {
          inputMint: VALID_ADDRESS,
          outputMint: VALID_ADDRESS_2,
          amount: "100",
          slippageBps: 5001,
        },
      });
      expectInvalid(result);
    });

    it("rejects negative slippage", () => {
      const result = validateIntentInput({
        type: "swap",
        params: {
          inputMint: VALID_ADDRESS,
          outputMint: VALID_ADDRESS_2,
          amount: "100",
          slippageBps: -1,
        },
      });
      expectInvalid(result);
    });

    it("accepts slippage=0", () => {
      expectValid(
        validateIntentInput({
          type: "swap",
          params: {
            inputMint: VALID_ADDRESS,
            outputMint: VALID_ADDRESS_2,
            amount: "100",
            slippageBps: 0,
          },
        }),
      );
    });
  });

  describe("validateIntentInput - error structure", () => {
    it("errors have correct AgentError shape", () => {
      const result = validateIntentInput({
        type: "swap",
        params: {
          inputMint: "bad",
          outputMint: "also-bad",
          amount: "-1",
        },
      });
      expectInvalid(result);
      for (const err of result.errors) {
        expect(err.code).to.equal("INTENT_VALIDATION_FAILED");
        expect(err.category).to.equal("INPUT_VALIDATION");
        expect(err.retryable).to.be.false;
        expect(err.recovery_actions)
          .to.be.an("array")
          .with.length.greaterThan(0);
        expect(err.context).to.have.property("field");
        expect(err.context).to.have.property("received");
      }
    });
  });
});
