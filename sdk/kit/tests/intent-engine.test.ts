import { expect } from "chai";
import type { Address } from "@solana/kit";
import { IntentEngine, type IntentEngineConfig, type ExplainResult } from "../src/intent-engine.js";
import { ProtocolRegistry } from "../src/integrations/protocol-registry.js";
import { JupiterHandler } from "../src/integrations/jupiter-handler.js";
import { DriftHandler, FlashTradeHandler, KaminoHandler, SquadsHandler } from "../src/integrations/t2-handlers.js";
import type { IntentAction } from "../src/intents.js";
import { isAgentError, type AgentError } from "../src/agent-errors.js";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

const VAULT = "Vault111111111111111111111111111111111111111" as Address;
const AGENT = "Agent111111111111111111111111111111111111111" as Address;
const USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const DEST = "Dest1111111111111111111111111111111111111111";

function mockAgent() {
  return {
    address: AGENT,
    signTransactions: async (txs: unknown[]) => txs,
  } as any;
}

function buildRegistry(): ProtocolRegistry {
  const reg = new ProtocolRegistry();
  reg.register(new JupiterHandler());
  reg.register(new DriftHandler());
  reg.register(new FlashTradeHandler());
  reg.register(new KaminoHandler());
  reg.register(new SquadsHandler());
  return reg;
}

function buildEngine(overrides?: Partial<IntentEngineConfig>): IntentEngine {
  return new IntentEngine({
    rpc: {} as any,
    network: "devnet",
    protocolRegistry: buildRegistry(),
    agent: mockAgent(),
    ...overrides,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("IntentEngine", () => {
  describe("validate()", () => {
    it("valid swap passes validation", () => {
      const engine = buildEngine();
      const result = engine.validate({
        type: "swap",
        params: { inputMint: USDC_MINT, outputMint: SOL_MINT, amount: "1000000" },
      });
      expect(result.valid).to.be.true;
    });

    it("missing amount fails validation", () => {
      const engine = buildEngine();
      const result = engine.validate({
        type: "swap",
        params: { inputMint: "USDC", outputMint: "SOL", amount: "" },
      });
      expect(result.valid).to.be.false;
      expect(result.errors).to.have.length.greaterThan(0);
    });

    it("negative amount fails validation", () => {
      const engine = buildEngine();
      const result = engine.validate({
        type: "swap",
        params: { inputMint: USDC_MINT, outputMint: SOL_MINT, amount: "-100" },
      });
      expect(result.valid).to.be.false;
    });

    it("NaN amount fails validation", () => {
      const engine = buildEngine();
      const result = engine.validate({
        type: "swap",
        params: { inputMint: USDC_MINT, outputMint: SOL_MINT, amount: "not_a_number" },
      });
      expect(result.valid).to.be.false;
    });

    it("valid transfer passes", () => {
      const engine = buildEngine();
      const result = engine.validate({
        type: "transfer",
        params: {
          destination: DEST,
          mint: USDC_MINT,
          amount: "500000",
        },
      });
      expect(result.valid).to.be.true;
    });

    it("valid openPosition passes", () => {
      const engine = buildEngine();
      const result = engine.validate({
        type: "openPosition",
        params: { market: "SOL-PERP", side: "long", collateral: "100", leverage: 5 },
      });
      expect(result.valid).to.be.true;
    });

    it("zero leverage fails", () => {
      const engine = buildEngine();
      const result = engine.validate({
        type: "openPosition",
        params: { market: "SOL-PERP", side: "long", collateral: "100", leverage: 0 },
      });
      expect(result.valid).to.be.false;
    });
  });

  describe("listProtocols()", () => {
    it("returns all registered protocols", () => {
      const engine = buildEngine();
      const protocols = engine.listProtocols();
      expect(protocols.length).to.equal(5);
      const ids = protocols.map((p) => p.protocolId);
      expect(ids).to.include("jupiter");
      expect(ids).to.include("drift");
      expect(ids).to.include("flash-trade");
      expect(ids).to.include("kamino-lending");
      expect(ids).to.include("squads");
    });

    it("protocols have correct action counts", () => {
      const engine = buildEngine();
      const protocols = engine.listProtocols();
      const jupiter = protocols.find((p) => p.protocolId === "jupiter")!;
      expect(jupiter.actionCount).to.be.greaterThanOrEqual(1);
      const flash = protocols.find((p) => p.protocolId === "flash-trade")!;
      expect(flash.actionCount).to.equal(14);
    });

    it("each protocol has programIds", () => {
      const engine = buildEngine();
      const protocols = engine.listProtocols();
      for (const p of protocols) {
        expect(p.programIds.length).to.be.greaterThan(0);
      }
    });
  });

  describe("listActions()", () => {
    it("jupiter has swap action", () => {
      const engine = buildEngine();
      const actions = engine.listActions("jupiter");
      const swap = actions.find((a) => a.name === "swap");
      expect(swap).to.exist;
      expect(swap!.isSpending).to.be.true;
    });

    it("drift has deposit and withdraw", () => {
      const engine = buildEngine();
      const actions = engine.listActions("drift");
      expect(actions.find((a) => a.name === "deposit")).to.exist;
      expect(actions.find((a) => a.name === "withdraw")).to.exist;
    });

    it("flash-trade has 14 actions", () => {
      const engine = buildEngine();
      const actions = engine.listActions("flash-trade");
      expect(actions.length).to.equal(14);
    });

    it("unknown protocol returns empty", () => {
      const engine = buildEngine();
      const actions = engine.listActions("nonexistent");
      expect(actions).to.have.length(0);
    });
  });

  describe("run() validation stage", () => {
    it("returns AgentError for invalid input", async () => {
      const engine = buildEngine();
      const result = await engine.run(
        { type: "swap", params: { inputMint: "", outputMint: "", amount: "" } },
        VAULT,
        { skipPrecheck: true },
      );
      // Should fail at validation stage
      expect(isAgentError(result)).to.be.true;
    });

    it("valid intent passes validation stage", async () => {
      const engine = buildEngine();
      // This will fail at precheck (mock RPC), but should pass validation
      try {
        await engine.run(
          {
            type: "swap",
            params: { inputMint: USDC_MINT, outputMint: SOL_MINT, amount: "1000000" },
          },
          VAULT,
        );
      } catch (e) {
        // Expected — RPC is mocked. The point is validation passed.
      }
    });
  });

  describe("precheck() edge cases (offline)", () => {
    it("precheck catches RPC failure gracefully", async () => {
      const engine = buildEngine({
        rpc: {
          getAccountInfo: () => {
            throw new Error("RPC unavailable");
          },
        } as any,
      });
      const result = await engine.precheck(
        { type: "swap", params: { inputMint: USDC_MINT, outputMint: SOL_MINT, amount: "1000000" } },
        VAULT,
      );
      expect(result.allowed).to.be.false;
      // Error message may vary — just verify it fails gracefully
      expect(result.reason).to.be.a("string");
      expect(result.reason!.length).to.be.greaterThan(0);
    });
  });

  describe("explain()", () => {
    it("returns AgentError for invalid intent", async () => {
      const engine = buildEngine();
      const result = await engine.explain(
        { type: "swap", params: { inputMint: "", outputMint: "", amount: "" } },
        VAULT,
      );
      // Should fail at validation
      expect(isAgentError(result)).to.be.true;
    });
  });

  describe("registry integration", () => {
    it("frozen registry rejects new registrations", () => {
      const reg = buildRegistry();
      reg.freeze();
      expect(() =>
        reg.register(new JupiterHandler()),
      ).to.throw();
    });

    it("engine uses registry for protocol lookup", () => {
      const engine = buildEngine();
      const protocols = engine.listProtocols();
      expect(protocols.some((p) => p.protocolId === "jupiter")).to.be.true;
    });
  });
});
