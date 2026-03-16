import { expect } from "chai";
import {
  DriftHandler,
  FlashTradeHandler,
  KaminoHandler,
  SquadsHandler,
} from "../src/integrations/t2-handlers.js";
import type { Address } from "@solana/kit";
import { ActionType } from "../src/generated/types/actionType.js";

describe("t2-handlers", () => {
  describe("DriftHandler", () => {
    const handler = new DriftHandler();

    it("has protocolId = drift", () => {
      expect(handler.metadata.protocolId).to.equal("drift");
    });

    it("has 5 supported actions", () => {
      expect(handler.metadata.supportedActions.size).to.equal(5);
    });

    it("deposit maps to ActionType.Deposit", () => {
      const action = handler.metadata.supportedActions.get("deposit");
      expect(action!.actionType).to.equal(ActionType.Deposit);
      expect(action!.isSpending).to.be.true;
    });

    it("compose throws SDK-not-installed (compat bridge wired)", async () => {
      try {
        await handler.compose({} as any, "deposit", {});
        expect.fail("should throw");
      } catch (e: any) {
        // Now goes through compat bridge — fails at SDK import, not at "not implemented"
        expect(e.message).to.include("@drift-labs/sdk");
      }
    });

    it("summarize produces readable output", () => {
      expect(handler.summarize("deposit", { amount: "100", mint: "USDC" }))
        .to.include("Drift")
        .and.include("deposit");
    });
  });

  describe("FlashTradeHandler", () => {
    const handler = new FlashTradeHandler();

    it("has protocolId = flash-trade", () => {
      expect(handler.metadata.protocolId).to.equal("flash-trade");
    });

    it("has 14 supported actions", () => {
      expect(handler.metadata.supportedActions.size).to.equal(14);
    });

    it("openPosition maps to ActionType.OpenPosition", () => {
      const action = handler.metadata.supportedActions.get("openPosition");
      expect(action!.actionType).to.equal(ActionType.OpenPosition);
      expect(action!.isSpending).to.be.true;
    });

    it("closePosition is non-spending", () => {
      const action = handler.metadata.supportedActions.get("closePosition");
      expect(action!.isSpending).to.be.false;
    });

    it("compose dispatches to Codama compose (throws on missing params)", async () => {
      try {
        await handler.compose({} as any, "openPosition", {});
        expect.fail("should throw");
      } catch (e: any) {
        expect(e.message).to.include("Missing required");
      }
    });

    it("summarize produces readable output", () => {
      expect(
        handler.summarize("openPosition", {
          side: "long",
          targetSymbol: "SOL",
        }),
      )
        .to.include("Flash")
        .and.include("long")
        .and.include("SOL");
    });
  });

  describe("KaminoHandler", () => {
    const handler = new KaminoHandler();

    it("has protocolId = kamino-lending", () => {
      expect(handler.metadata.protocolId).to.equal("kamino-lending");
    });

    it("has 7 supported actions", () => {
      expect(handler.metadata.supportedActions.size).to.equal(7);
    });

    it("borrow maps to Withdraw (non-spending)", () => {
      const action = handler.metadata.supportedActions.get("borrow");
      expect(action!.actionType).to.equal(ActionType.Withdraw);
      expect(action!.isSpending).to.be.false;
    });

    it("compose dispatches to Codama compose (throws on missing params)", async () => {
      try {
        await handler.compose({} as any, "deposit", {});
        expect.fail("should throw");
      } catch (e: any) {
        expect(e.message).to.include("Missing required");
      }
    });
  });

  describe("SquadsHandler", () => {
    const handler = new SquadsHandler();

    it("has protocolId = squads", () => {
      expect(handler.metadata.protocolId).to.equal("squads");
    });

    it("has 3 supported actions", () => {
      expect(handler.metadata.supportedActions.size).to.equal(3);
    });

    it("compose throws NOT_IMPLEMENTED", async () => {
      try {
        await handler.compose({} as any, "propose", {});
        expect.fail("should throw");
      } catch (e: any) {
        expect(e.message).to.include("not yet implemented");
      }
    });
  });
});
