import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  KAMINO_LEND_PROGRAM_ID_STR,
  KAMINO_MAIN_MARKET_STR,
} from "../src/integrations/kamino";
import { ProtocolRegistry } from "../src/integrations/protocol-registry";
import { KaminoHandler } from "../src/integrations/kamino-handler";

describe("Kamino adapter", () => {
  describe("constants", () => {
    it("KAMINO_LEND_PROGRAM_ID_STR is a valid base58 public key", () => {
      const pk = new PublicKey(KAMINO_LEND_PROGRAM_ID_STR);
      expect(pk.toBase58()).to.equal(KAMINO_LEND_PROGRAM_ID_STR);
    });

    it("KAMINO_MAIN_MARKET_STR is a valid base58 public key", () => {
      const pk = new PublicKey(KAMINO_MAIN_MARKET_STR);
      expect(pk.toBase58()).to.equal(KAMINO_MAIN_MARKET_STR);
    });
  });

  describe("KaminoHandler", () => {
    let handler: KaminoHandler;

    beforeEach(() => {
      handler = new KaminoHandler();
    });

    it("has correct metadata.protocolId", () => {
      expect(handler.metadata.protocolId).to.equal("kamino-lending");
    });

    it("has correct metadata.displayName", () => {
      expect(handler.metadata.displayName).to.equal("Kamino Lending");
    });

    it("has correct programIds", () => {
      expect(handler.metadata.programIds).to.have.length(1);
      expect(handler.metadata.programIds[0].toBase58()).to.equal(
        KAMINO_LEND_PROGRAM_ID_STR,
      );
    });

    it("supports 4 actions", () => {
      expect(handler.metadata.supportedActions.size).to.equal(4);
    });

    describe("ActionType mappings", () => {
      it("deposit maps to deposit ActionType (spending)", () => {
        const desc = handler.metadata.supportedActions.get("deposit");
        expect(desc).to.not.be.undefined;
        expect(desc!.actionType).to.deep.equal({ deposit: {} });
        expect(desc!.isSpending).to.be.true;
      });

      it("borrow maps to withdraw ActionType (non-spending)", () => {
        const desc = handler.metadata.supportedActions.get("borrow");
        expect(desc).to.not.be.undefined;
        expect(desc!.actionType).to.deep.equal({ withdraw: {} });
        expect(desc!.isSpending).to.be.false;
      });

      it("repay maps to deposit ActionType (spending)", () => {
        const desc = handler.metadata.supportedActions.get("repay");
        expect(desc).to.not.be.undefined;
        expect(desc!.actionType).to.deep.equal({ deposit: {} });
        expect(desc!.isSpending).to.be.true;
      });

      it("withdraw maps to withdraw ActionType (non-spending)", () => {
        const desc = handler.metadata.supportedActions.get("withdraw");
        expect(desc).to.not.be.undefined;
        expect(desc!.actionType).to.deep.equal({ withdraw: {} });
        expect(desc!.isSpending).to.be.false;
      });
    });

    describe("summarize", () => {
      it("summarizes deposit action", () => {
        const summary = handler.summarize("deposit", {
          amount: "1000000",
          tokenMint: "USDC",
        });
        expect(summary).to.include("Kamino deposit");
        expect(summary).to.include("USDC");
      });

      it("summarizes borrow action", () => {
        const summary = handler.summarize("borrow", {
          amount: "500000",
          tokenMint: "SOL",
        });
        expect(summary).to.include("Kamino borrow");
        expect(summary).to.include("SOL");
      });

      it("summarizes repay action", () => {
        const summary = handler.summarize("repay", {
          amount: "500000",
          tokenMint: "SOL",
        });
        expect(summary).to.include("Kamino repay");
      });

      it("summarizes withdraw action", () => {
        const summary = handler.summarize("withdraw", {
          amount: "1000000",
          tokenMint: "USDC",
        });
        expect(summary).to.include("Kamino withdraw");
      });

      it("summarizes unknown action with fallback", () => {
        const summary = handler.summarize("unknownAction", {});
        expect(summary).to.equal("Kamino unknownAction");
      });
    });

    describe("compose rejects unknown action", () => {
      it("throws for unsupported action", async () => {
        const ctx = {
          program: {} as any,
          connection: {} as any,
          vault: Keypair.generate().publicKey,
          owner: Keypair.generate().publicKey,
          vaultId: {} as any,
          agent: Keypair.generate().publicKey,
        };
        try {
          await handler.compose(ctx, "unknownAction", {});
          expect.fail("Should have thrown");
        } catch (e: any) {
          expect(e.message).to.include('unsupported action "unknownAction"');
        }
      });
    });

    describe("registry integration", () => {
      it("KaminoHandler can be registered and looked up by protocol ID", () => {
        const registry = new ProtocolRegistry();
        const h = new KaminoHandler();
        registry.register(h);
        expect(registry.getByProtocolId("kamino-lending")).to.equal(h);
      });

      it("KaminoHandler can be looked up by program ID", () => {
        const registry = new ProtocolRegistry();
        const h = new KaminoHandler();
        registry.register(h);
        const found = registry.getByProgramId(
          new PublicKey(KAMINO_LEND_PROGRAM_ID_STR),
        );
        expect(found).to.equal(h);
      });
    });

    describe("instruction concatenation logic", () => {
      it("no initialize() method needed (stateless)", () => {
        // ProtocolHandler.initialize is optional — KaminoHandler doesn't implement it
        expect((handler as any).initialize).to.be.undefined;
      });
    });
  });
});
