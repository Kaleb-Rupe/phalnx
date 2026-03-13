/**
 * Flash Trade Compose Tests — Codama pre-generated builders
 *
 * Tests instruction building with static account configs.
 * No RPC, no protocol SDK needed.
 */

import { expect } from "chai";
import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import type { ProtocolContext } from "../src/integrations/protocol-handler.js";
import { dispatchFlashTradeCompose } from "../src/integrations/flash-compose.js";
import { FlashTradeHandler } from "../src/integrations/t2-handlers.js";
import { FlashTradeComposeError, COMPOSE_ERROR_CODES } from "../src/integrations/compose-errors.js";
import { PERPETUALS_PROGRAM } from "../src/integrations/config/flash-trade-markets.js";
import { JUPITER_PROGRAM_ADDRESS } from "../src/types.js";
import { OPEN_POSITION_DISCRIMINATOR } from "../src/generated/protocols/flash-trade/instructions/openPosition.js";
import { CLOSE_POSITION_DISCRIMINATOR } from "../src/generated/protocols/flash-trade/instructions/closePosition.js";
import { INCREASE_SIZE_DISCRIMINATOR } from "../src/generated/protocols/flash-trade/instructions/increaseSize.js";
import { DECREASE_SIZE_DISCRIMINATOR } from "../src/generated/protocols/flash-trade/instructions/decreaseSize.js";
import { ADD_COLLATERAL_DISCRIMINATOR } from "../src/generated/protocols/flash-trade/instructions/addCollateral.js";
import { REMOVE_COLLATERAL_DISCRIMINATOR } from "../src/generated/protocols/flash-trade/instructions/removeCollateral.js";
import { PLACE_TRIGGER_ORDER_DISCRIMINATOR } from "../src/generated/protocols/flash-trade/instructions/placeTriggerOrder.js";
import { EDIT_TRIGGER_ORDER_DISCRIMINATOR } from "../src/generated/protocols/flash-trade/instructions/editTriggerOrder.js";
import { CANCEL_TRIGGER_ORDER_DISCRIMINATOR } from "../src/generated/protocols/flash-trade/instructions/cancelTriggerOrder.js";
import { PLACE_LIMIT_ORDER_DISCRIMINATOR } from "../src/generated/protocols/flash-trade/instructions/placeLimitOrder.js";
import { EDIT_LIMIT_ORDER_DISCRIMINATOR } from "../src/generated/protocols/flash-trade/instructions/editLimitOrder.js";
import { SWAP_AND_OPEN_DISCRIMINATOR } from "../src/generated/protocols/flash-trade/instructions/swapAndOpen.js";
import { CLOSE_AND_SWAP_DISCRIMINATOR } from "../src/generated/protocols/flash-trade/instructions/closeAndSwap.js";

// ─── Test Context ────────────────────────────────────────────────────────────

const FAKE_VAULT = "11111111111111111111111111111111" as Address;
const FAKE_OWNER = "22222222222222222222222222222222" as Address;
const FAKE_AGENT = "33333333333333333333333333333333" as Address;
const FAKE_POSITION = "44444444444444444444444444444444" as Address;
const FAKE_ORDER = "55555555555555555555555555555555" as Address;

function makeCtx(): ProtocolContext {
  return {
    rpc: {} as Rpc<SolanaRpcApi>,
    network: "mainnet-beta",
    vault: FAKE_VAULT,
    owner: FAKE_OWNER,
    vaultId: 1n,
    agent: FAKE_AGENT,
  };
}

const DEFAULT_PRICE = { price: "150000000000", exponent: -9 };

function matchDiscriminator(data: Uint8Array | ArrayLike<number>, expected: ArrayLike<number>): boolean {
  for (let i = 0; i < 8; i++) {
    if (data[i] !== expected[i]) return false;
  }
  return true;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Flash Trade Compose (Codama)", () => {
  const ctx = makeCtx();

  describe("openPosition", () => {
    it("builds instruction with correct program address", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "openPosition", {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        side: "long",
        priceWithSlippage: DEFAULT_PRICE,
        collateralAmount: "1000000000",
        sizeAmount: "5000000000",
      });
      expect(result.instructions).to.have.length(1);
      expect(result.instructions[0].programAddress).to.equal(PERPETUALS_PROGRAM);
    });

    it("returns additionalSigners (ephemeral position keypair)", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "openPosition", {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        side: "long",
        priceWithSlippage: DEFAULT_PRICE,
        collateralAmount: "1000000000",
        sizeAmount: "5000000000",
      });
      expect(result.additionalSigners).to.have.length(1);
    });

    it("has correct discriminator", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "openPosition", {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        side: "long",
        priceWithSlippage: DEFAULT_PRICE,
        collateralAmount: "1000000000",
        sizeAmount: "5000000000",
      });
      expect(matchDiscriminator(result.instructions[0].data!, OPEN_POSITION_DISCRIMINATOR)).to.be.true;
    });

    it("has correct account count (19)", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "openPosition", {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        side: "long",
        priceWithSlippage: DEFAULT_PRICE,
        collateralAmount: "1000000000",
        sizeAmount: "5000000000",
      });
      expect(result.instructions[0].accounts!.length).to.equal(19);
    });
  });

  describe("closePosition", () => {
    it("builds with correct discriminator and no additionalSigners", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "closePosition", {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        side: "long",
        priceWithSlippage: DEFAULT_PRICE,
        positionPubKey: FAKE_POSITION,
      });
      expect(result.instructions).to.have.length(1);
      expect(result.instructions[0].programAddress).to.equal(PERPETUALS_PROGRAM);
      expect(matchDiscriminator(result.instructions[0].data!, CLOSE_POSITION_DISCRIMINATOR)).to.be.true;
      expect(result.additionalSigners).to.be.undefined;
    });
  });

  describe("increasePosition", () => {
    it("builds correctly", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "increasePosition", {
        targetSymbol: "BTC",
        collateralSymbol: "USDC",
        side: "short",
        priceWithSlippage: DEFAULT_PRICE,
        sizeDelta: "100000000",
        positionPubKey: FAKE_POSITION,
      });
      expect(result.instructions).to.have.length(1);
      expect(matchDiscriminator(result.instructions[0].data!, INCREASE_SIZE_DISCRIMINATOR)).to.be.true;
    });
  });

  describe("decreasePosition", () => {
    it("builds correctly with no additionalSigners", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "decreasePosition", {
        targetSymbol: "ETH",
        collateralSymbol: "ETH",
        side: "long",
        priceWithSlippage: DEFAULT_PRICE,
        sizeDelta: "50000000",
        positionPubKey: FAKE_POSITION,
      });
      expect(result.instructions).to.have.length(1);
      expect(matchDiscriminator(result.instructions[0].data!, DECREASE_SIZE_DISCRIMINATOR)).to.be.true;
      expect(result.additionalSigners).to.be.undefined;
    });
  });

  describe("addCollateral", () => {
    it("builds correctly", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "addCollateral", {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        side: "long",
        amount: "500000000",
        positionPubKey: FAKE_POSITION,
      });
      expect(result.instructions).to.have.length(1);
      expect(matchDiscriminator(result.instructions[0].data!, ADD_COLLATERAL_DISCRIMINATOR)).to.be.true;
    });
  });

  describe("removeCollateral", () => {
    it("builds correctly with no additionalSigners", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "removeCollateral", {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        side: "long",
        amount: "100000000",
        positionPubKey: FAKE_POSITION,
      });
      expect(result.instructions).to.have.length(1);
      expect(matchDiscriminator(result.instructions[0].data!, REMOVE_COLLATERAL_DISCRIMINATOR)).to.be.true;
      expect(result.additionalSigners).to.be.undefined;
    });
  });

  describe("placeTriggerOrder", () => {
    it("returns additionalSigners (ephemeral order)", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "placeTriggerOrder", {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        receiveSymbol: "USDC",
        side: "long",
        triggerPrice: DEFAULT_PRICE,
        deltaSizeAmount: "1000000000",
        isStopLoss: true,
        positionPubKey: FAKE_POSITION,
      });
      expect(result.additionalSigners).to.have.length(1);
      expect(matchDiscriminator(result.instructions[0].data!, PLACE_TRIGGER_ORDER_DISCRIMINATOR)).to.be.true;
    });
  });

  describe("editTriggerOrder", () => {
    it("builds with no additionalSigners", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "editTriggerOrder", {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        receiveSymbol: "USDC",
        side: "long",
        orderId: 0,
        triggerPrice: DEFAULT_PRICE,
        deltaSizeAmount: "500000000",
        isStopLoss: false,
        positionPubKey: FAKE_POSITION,
        orderPubKey: FAKE_ORDER,
      });
      expect(result.instructions).to.have.length(1);
      expect(matchDiscriminator(result.instructions[0].data!, EDIT_TRIGGER_ORDER_DISCRIMINATOR)).to.be.true;
      expect(result.additionalSigners).to.be.undefined;
    });
  });

  describe("cancelTriggerOrder", () => {
    it("builds with minimal accounts", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "cancelTriggerOrder", {
        orderId: 1,
        isStopLoss: true,
        orderPubKey: FAKE_ORDER,
      });
      expect(result.instructions).to.have.length(1);
      expect(matchDiscriminator(result.instructions[0].data!, CANCEL_TRIGGER_ORDER_DISCRIMINATOR)).to.be.true;
      expect(result.additionalSigners).to.be.undefined;
    });
  });

  describe("placeLimitOrder", () => {
    it("returns additionalSigners (position + order keypairs)", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "placeLimitOrder", {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        reserveSymbol: "USDC",
        receiveSymbol: "USDC",
        side: "long",
        limitPrice: DEFAULT_PRICE,
        reserveAmount: "1000000",
        sizeAmount: "5000000000",
        stopLossPrice: { price: "100000000000", exponent: -9 },
        takeProfitPrice: { price: "200000000000", exponent: -9 },
      });
      expect(result.additionalSigners).to.have.length(2);
      expect(matchDiscriminator(result.instructions[0].data!, PLACE_LIMIT_ORDER_DISCRIMINATOR)).to.be.true;
    });
  });

  describe("editLimitOrder", () => {
    it("builds with no additionalSigners", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "editLimitOrder", {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        reserveSymbol: "USDC",
        receiveSymbol: "USDC",
        side: "long",
        orderId: 0,
        limitPrice: DEFAULT_PRICE,
        sizeAmount: "3000000000",
        stopLossPrice: { price: "100000000000", exponent: -9 },
        takeProfitPrice: { price: "200000000000", exponent: -9 },
        positionPubKey: FAKE_POSITION,
        orderPubKey: FAKE_ORDER,
      });
      expect(result.instructions).to.have.length(1);
      expect(matchDiscriminator(result.instructions[0].data!, EDIT_LIMIT_ORDER_DISCRIMINATOR)).to.be.true;
      expect(result.additionalSigners).to.be.undefined;
    });
  });

  describe("cancelLimitOrder", () => {
    it("uses editLimitOrder with sizeAmount=0 pattern", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "cancelLimitOrder", {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        reserveSymbol: "USDC",
        receiveSymbol: "USDC",
        side: "long",
        orderId: 0,
        positionPubKey: FAKE_POSITION,
        orderPubKey: FAKE_ORDER,
      });
      expect(result.instructions).to.have.length(1);
      // cancelLimitOrder reuses editLimitOrder
      expect(matchDiscriminator(result.instructions[0].data!, EDIT_LIMIT_ORDER_DISCRIMINATOR)).to.be.true;
    });
  });

  describe("swapAndOpen", () => {
    it("returns additionalSigners and prepends swap instructions", async () => {
      const fakeSwapIx = {
        programAddress: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" as Address,
        accounts: [],
        data: new Uint8Array([1, 2, 3]),
      };
      const result = await dispatchFlashTradeCompose(ctx, "swapAndOpen", {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        side: "long",
        priceWithSlippage: DEFAULT_PRICE,
        collateralAmount: "1000000000",
        sizeAmount: "5000000000",
        swapInstructions: [fakeSwapIx],
      });
      expect(result.instructions).to.have.length(2); // swap + Flash open
      expect(result.instructions[0].programAddress).to.equal("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
      expect(matchDiscriminator(result.instructions[1].data!, SWAP_AND_OPEN_DISCRIMINATOR)).to.be.true;
      expect(result.additionalSigners).to.have.length(1);
    });
  });

  describe("closeAndSwap", () => {
    it("appends swap instructions after close", async () => {
      const fakeSwapIx = {
        programAddress: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" as Address,
        accounts: [],
        data: new Uint8Array([4, 5, 6]),
      };
      const result = await dispatchFlashTradeCompose(ctx, "closeAndSwap", {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        side: "long",
        priceWithSlippage: DEFAULT_PRICE,
        positionPubKey: FAKE_POSITION,
        swapInstructions: [fakeSwapIx],
      });
      expect(result.instructions).to.have.length(2); // Flash close + swap
      expect(matchDiscriminator(result.instructions[0].data!, CLOSE_AND_SWAP_DISCRIMINATOR)).to.be.true;
      expect(result.instructions[1].programAddress).to.equal("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
    });
  });

  describe("error cases", () => {
    it("throws for unsupported action", async () => {
      try {
        await dispatchFlashTradeCompose(ctx, "invalidAction", {});
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.message).to.include("Unsupported action");
      }
    });

    it("throws for missing required params", async () => {
      try {
        await dispatchFlashTradeCompose(ctx, "openPosition", {});
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.message).to.include("Missing required");
      }
    });

    it("throws for unknown symbol", async () => {
      try {
        await dispatchFlashTradeCompose(ctx, "openPosition", {
          targetSymbol: "UNKNOWN",
          collateralSymbol: "SOL",
          side: "long",
          priceWithSlippage: DEFAULT_PRICE,
          collateralAmount: "100",
          sizeAmount: "100",
        });
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.message).to.include("Unknown Flash Trade target symbol");
      }
    });
  });

  describe("Handler.summarize()", () => {
    const handler = new FlashTradeHandler();

    it("produces readable summaries", () => {
      expect(handler.summarize("openPosition", { targetSymbol: "SOL", side: "long" })).to.include("Flash open");
      expect(handler.summarize("closePosition", { targetSymbol: "BTC" })).to.include("Flash close");
      expect(handler.summarize("placeLimitOrder", { targetSymbol: "ETH", side: "short" })).to.include("Flash limit");
      expect(handler.summarize("cancelTriggerOrder", {})).to.include("Flash cancel trigger");
    });
  });

  describe("all 14 actions dispatch", () => {
    const actions = [
      "openPosition", "closePosition", "increasePosition", "decreasePosition",
      "addCollateral", "removeCollateral", "placeTriggerOrder", "editTriggerOrder",
      "cancelTriggerOrder", "placeLimitOrder", "editLimitOrder", "cancelLimitOrder",
      "swapAndOpen", "closeAndSwap",
    ];

    for (const action of actions) {
      it(`${action} does not throw "Unsupported"`, async () => {
        try {
          // Will throw for missing params, but NOT for unsupported action
          await dispatchFlashTradeCompose(ctx, action, {});
        } catch (e: any) {
          expect(e.message).to.not.include("Unsupported action");
        }
      });
    }
  });

  function openPositionParams() {
    return {
      targetSymbol: "SOL",
      collateralSymbol: "SOL",
      side: "long",
      priceWithSlippage: { price: "150000000000", exponent: -9 },
      collateralAmount: "1000000000",
      sizeAmount: "5000000000",
    };
  }

  describe("Edge cases", () => {
    describe("parseSide validation", () => {
      it("rejects empty string", async () => {
        try {
          await dispatchFlashTradeCompose(ctx, "openPosition", {
            ...openPositionParams(),
            side: "",
          });
          expect.fail("should have thrown");
        } catch (e: any) {
          expect(e.name).to.equal("FlashTradeComposeError");
          expect(e.code).to.equal(COMPOSE_ERROR_CODES.INVALID_SIDE);
        }
      });

      it("rejects uppercase LONG", async () => {
        try {
          await dispatchFlashTradeCompose(ctx, "openPosition", {
            ...openPositionParams(),
            side: "LONG",
          });
          expect.fail("should have thrown");
        } catch (e: any) {
          expect(e.name).to.equal("FlashTradeComposeError");
          expect(e.code).to.equal(COMPOSE_ERROR_CODES.INVALID_SIDE);
        }
      });

      it("rejects numeric side", async () => {
        try {
          await dispatchFlashTradeCompose(ctx, "openPosition", {
            ...openPositionParams(),
            side: 1 as any,
          });
          expect.fail("should have thrown");
        } catch (e: any) {
          expect(e.name).to.equal("FlashTradeComposeError");
          expect(e.code).to.equal(COMPOSE_ERROR_CODES.INVALID_SIDE);
        }
      });
    });

    describe("safeBigInt validation", () => {
      it("rejects NaN string", async () => {
        try {
          await dispatchFlashTradeCompose(ctx, "openPosition", {
            ...openPositionParams(),
            collateralAmount: "not-a-number",
          });
          expect.fail("should have thrown");
        } catch (e: any) {
          expect(e.name).to.equal("FlashTradeComposeError");
          expect(e.code).to.equal(COMPOSE_ERROR_CODES.INVALID_BIGINT);
        }
      });

      it("treats empty string as zero (BigInt coercion)", async () => {
        // BigInt("") === 0n in Node.js, so this should not throw INVALID_BIGINT.
        // It may succeed or throw a different error (e.g., if zero is invalid),
        // but NOT INVALID_BIGINT.
        try {
          const result = await dispatchFlashTradeCompose(ctx, "openPosition", {
            ...openPositionParams(),
            collateralAmount: "",
          });
          // If it succeeds, BigInt("") was treated as 0n
          expect(result.instructions).to.have.length.gte(1);
        } catch (e: any) {
          expect(e.code).to.not.equal("INVALID_BIGINT");
        }
      });

      it("rejects undefined amount", async () => {
        try {
          await dispatchFlashTradeCompose(ctx, "openPosition", {
            ...openPositionParams(),
            collateralAmount: undefined,
          });
          expect.fail("should have thrown");
        } catch (e: any) {
          // Could be MISSING_PARAM or INVALID_BIGINT depending on requireField
          expect(e.name).to.equal("FlashTradeComposeError");
        }
      });

      it("accepts valid BigInt string", async () => {
        // Should not throw — tests that valid BigInt strings work
        const result = await dispatchFlashTradeCompose(ctx, "openPosition", openPositionParams());
        expect(result.instructions).to.have.length.gte(1);
      });

      it("rejects Infinity", async () => {
        try {
          await dispatchFlashTradeCompose(ctx, "openPosition", {
            ...openPositionParams(),
            sizeAmount: Infinity,
          });
          expect.fail("should have thrown");
        } catch (e: any) {
          expect(e.name).to.equal("FlashTradeComposeError");
          expect(e.code).to.equal(COMPOSE_ERROR_CODES.INVALID_BIGINT);
        }
      });

      it("rejects float string", async () => {
        try {
          await dispatchFlashTradeCompose(ctx, "openPosition", {
            ...openPositionParams(),
            collateralAmount: "1.5",
          });
          expect.fail("should have thrown");
        } catch (e: any) {
          expect(e.name).to.equal("FlashTradeComposeError");
          expect(e.code).to.equal(COMPOSE_ERROR_CODES.INVALID_BIGINT);
        }
      });
    });

    describe("requireField validation", () => {
      it("rejects null field", async () => {
        try {
          await dispatchFlashTradeCompose(ctx, "openPosition", {
            ...openPositionParams(),
            targetSymbol: null,
          });
          expect.fail("should have thrown");
        } catch (e: any) {
          expect(e.name).to.equal("FlashTradeComposeError");
          expect(e.code).to.equal(COMPOSE_ERROR_CODES.MISSING_PARAM);
        }
      });

      it("accepts zero as valid", async () => {
        // Zero is a valid value, should not throw MISSING_PARAM
        // (may throw INVALID_BIGINT or other validation error, but not MISSING_PARAM for the field)
        try {
          await dispatchFlashTradeCompose(ctx, "addCollateral", {
            targetSymbol: "SOL",
            collateralSymbol: "SOL",
            side: "long",
            positionPubKey: "44444444444444444444444444444444",
            amount: "0",
          });
          // If it succeeds, that's fine
        } catch (e: any) {
          // Should NOT be MISSING_PARAM
          expect(e.code).to.not.equal("MISSING_PARAM");
        }
      });
    });

    describe("unsupported action", () => {
      it("throws FlashTradeComposeError for unknown action", async () => {
        try {
          await dispatchFlashTradeCompose(ctx, "unknownAction", {});
          expect.fail("should have thrown");
        } catch (e: any) {
          expect(e.name).to.equal("FlashTradeComposeError");
          expect(e.code).to.equal(COMPOSE_ERROR_CODES.UNSUPPORTED_ACTION);
          expect(e.message).to.include("unknownAction");
        }
      });
    });

    describe("unknown symbol", () => {
      it("throws for unknown target symbol with available list", async () => {
        try {
          await dispatchFlashTradeCompose(ctx, "openPosition", {
            ...openPositionParams(),
            targetSymbol: "DOGE",
          });
          expect.fail("should have thrown");
        } catch (e: any) {
          expect(e.message).to.include("DOGE");
          expect(e.message).to.include("Available");
        }
      });
    });
  });

  describe("M-7: swapInstructions program validation", () => {
    const WRONG_PROGRAM = "11111111111111111111111111111111" as Address;

    function swapAndOpenParams(swapInstructions?: unknown) {
      return {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        side: "long",
        priceWithSlippage: DEFAULT_PRICE,
        collateralAmount: "1000000000",
        sizeAmount: "5000000000",
        ...(swapInstructions !== undefined ? { swapInstructions } : {}),
      };
    }

    function closeAndSwapParams(swapInstructions?: unknown) {
      return {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        side: "long",
        priceWithSlippage: DEFAULT_PRICE,
        positionPubKey: FAKE_POSITION,
        ...(swapInstructions !== undefined ? { swapInstructions } : {}),
      };
    }

    function makeSwapIx(programAddress: Address) {
      return { programAddress, accounts: [], data: new Uint8Array([1, 2, 3]) };
    }

    it("swapAndOpen accepts instructions with Jupiter V6 program", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "swapAndOpen", swapAndOpenParams([
        makeSwapIx(JUPITER_PROGRAM_ADDRESS),
      ]));
      expect(result.instructions).to.have.length(2); // swap + Flash swapAndOpen
      expect(result.instructions[0].programAddress).to.equal(JUPITER_PROGRAM_ADDRESS);
    });

    it("swapAndOpen rejects instruction with wrong program", async () => {
      try {
        await dispatchFlashTradeCompose(ctx, "swapAndOpen", swapAndOpenParams([
          makeSwapIx(WRONG_PROGRAM),
        ]));
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e).to.be.instanceOf(FlashTradeComposeError);
        expect(e.code).to.equal(COMPOSE_ERROR_CODES.INVALID_PARAM);
        expect(e.message).to.include("swapInstructions[0]");
        expect(e.message).to.include(WRONG_PROGRAM);
      }
    });

    it("swapAndOpen accepts empty swapInstructions array", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "swapAndOpen", swapAndOpenParams([]));
      expect(result.instructions).to.have.length(1); // Only Flash swapAndOpen, no swap ix
    });

    it("closeAndSwap accepts instructions with Jupiter V6 program", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "closeAndSwap", closeAndSwapParams([
        makeSwapIx(JUPITER_PROGRAM_ADDRESS),
      ]));
      expect(result.instructions).to.have.length(2); // Flash closeAndSwap + swap
      expect(result.instructions[1].programAddress).to.equal(JUPITER_PROGRAM_ADDRESS);
    });

    it("closeAndSwap rejects instruction with wrong program", async () => {
      try {
        await dispatchFlashTradeCompose(ctx, "closeAndSwap", closeAndSwapParams([
          makeSwapIx(WRONG_PROGRAM),
        ]));
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e).to.be.instanceOf(FlashTradeComposeError);
        expect(e.code).to.equal(COMPOSE_ERROR_CODES.INVALID_PARAM);
        expect(e.message).to.include("swapInstructions[0]");
      }
    });

    it("error message includes the invalid program address", async () => {
      const badProgram = "BadProgramAddress111111111111111" as Address;
      try {
        await dispatchFlashTradeCompose(ctx, "swapAndOpen", swapAndOpenParams([
          makeSwapIx(badProgram),
        ]));
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e).to.be.instanceOf(FlashTradeComposeError);
        expect(e.message).to.include(badProgram);
        expect(e.message).to.include("Jupiter V6");
        expect(e.message).to.include(JUPITER_PROGRAM_ADDRESS);
      }
    });
  });

  describe("H-4: Trigger order validation", () => {
    function placeTriggerParams(triggerPrice: { price: string; exponent: number } = DEFAULT_PRICE) {
      return {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        receiveSymbol: "USDC",
        side: "long",
        triggerPrice,
        deltaSizeAmount: "1000000000",
        isStopLoss: true,
        positionPubKey: FAKE_POSITION,
      };
    }

    function editTriggerParams(triggerPrice: { price: string; exponent: number } = DEFAULT_PRICE) {
      return {
        targetSymbol: "SOL",
        collateralSymbol: "SOL",
        receiveSymbol: "USDC",
        side: "long",
        orderId: 0,
        triggerPrice,
        deltaSizeAmount: "500000000",
        isStopLoss: false,
        positionPubKey: FAKE_POSITION,
        orderPubKey: FAKE_ORDER,
      };
    }

    it("placeTriggerOrder rejects triggerPrice.price = '0'", async () => {
      try {
        await dispatchFlashTradeCompose(ctx, "placeTriggerOrder", placeTriggerParams({ price: "0", exponent: -9 }));
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.name).to.equal("FlashTradeComposeError");
        expect(e.code).to.equal(COMPOSE_ERROR_CODES.INVALID_BIGINT);
        expect(e.message).to.include("triggerPrice must be > 0");
      }
    });

    it("placeTriggerOrder rejects negative triggerPrice", async () => {
      try {
        await dispatchFlashTradeCompose(ctx, "placeTriggerOrder", placeTriggerParams({ price: "-100", exponent: -9 }));
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.name).to.equal("FlashTradeComposeError");
        expect(e.code).to.equal(COMPOSE_ERROR_CODES.INVALID_BIGINT);
        expect(e.message).to.include("triggerPrice must be > 0");
      }
    });

    it("placeTriggerOrder accepts positive triggerPrice", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "placeTriggerOrder", placeTriggerParams({ price: "150000000000", exponent: -9 }));
      expect(result.instructions).to.have.length(1);
      expect(result.additionalSigners).to.have.length(1);
    });

    it("editTriggerOrder rejects triggerPrice.price = '0'", async () => {
      try {
        await dispatchFlashTradeCompose(ctx, "editTriggerOrder", editTriggerParams({ price: "0", exponent: -9 }));
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.name).to.equal("FlashTradeComposeError");
        expect(e.code).to.equal(COMPOSE_ERROR_CODES.INVALID_BIGINT);
        expect(e.message).to.include("triggerPrice must be > 0");
      }
    });

    it("editTriggerOrder rejects negative triggerPrice", async () => {
      try {
        await dispatchFlashTradeCompose(ctx, "editTriggerOrder", editTriggerParams({ price: "-500", exponent: -9 }));
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.name).to.equal("FlashTradeComposeError");
        expect(e.code).to.equal(COMPOSE_ERROR_CODES.INVALID_BIGINT);
        expect(e.message).to.include("triggerPrice must be > 0");
      }
    });

    it("editTriggerOrder accepts positive triggerPrice", async () => {
      const result = await dispatchFlashTradeCompose(ctx, "editTriggerOrder", editTriggerParams({ price: "200000000000", exponent: -9 }));
      expect(result.instructions).to.have.length(1);
      expect(result.additionalSigners).to.be.undefined;
    });

    it("placeTriggerOrder with valid params does not throw on triggerPrice validation", async () => {
      // Use a small but positive price to verify boundary acceptance
      const result = await dispatchFlashTradeCompose(ctx, "placeTriggerOrder", placeTriggerParams({ price: "1", exponent: 0 }));
      expect(result.instructions).to.have.length(1);
    });

    it("verify error code is INVALID_BIGINT", async () => {
      try {
        await dispatchFlashTradeCompose(ctx, "placeTriggerOrder", placeTriggerParams({ price: "0", exponent: -9 }));
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e).to.be.instanceOf(FlashTradeComposeError);
        expect(e.code).to.equal("INVALID_BIGINT");
        expect(e.code).to.equal(COMPOSE_ERROR_CODES.INVALID_BIGINT);
      }
    });
  });
});
