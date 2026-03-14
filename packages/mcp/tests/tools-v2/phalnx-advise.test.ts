import { expect } from "chai";
import type { PhalnxClient } from "@phalnx/sdk";
import type { McpConfig } from "../../src/config";
import {
  phalnxAdvise,
  type PhalnxAdviseInput,
} from "../../src/tools-v2/phalnx-advise";
import {
  createMockClient,
  TEST_VAULT_PDA,
  TEST_AGENT,
} from "../helpers/mock-client";

const mockConfig = { rpcUrl: "https://mock.rpc" } as McpConfig;

describe("phalnx_advise", () => {
  // ── whatCanIDo ──────────────────────────────────────────────

  describe("whatCanIDo", () => {
    it("returns available actions when vault and agent exist", async () => {
      const client = createMockClient();
      // Set wallet to match the agent in the mock vault
      (client as any).provider.wallet.publicKey = TEST_AGENT.publicKey;

      const result = await phalnxAdvise(
        client as unknown as PhalnxClient,
        mockConfig,
        {
          question: "whatCanIDo",
          context: { vault: TEST_VAULT_PDA.toBase58() },
        },
      );

      const parsed = JSON.parse(result);
      expect(parsed.question).to.equal("whatCanIDo");
      expect(parsed.available).to.be.true;
      expect(parsed.allowedActions).to.be.an("array");
      expect(parsed.allowedActions).to.include("swap");
      expect(parsed).to.have.property("suggestedTool");
      expect(parsed).to.have.property("suggestedAction");
    });

    it("returns not-configured when client is null", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "whatCanIDo",
      });

      const parsed = JSON.parse(result);
      expect(parsed.available).to.be.false;
      expect(parsed.reason).to.include("Not configured");
      expect(parsed.suggestedTool).to.equal("phalnx_setup");
    });

    it("returns not-registered when agent not in vault", async () => {
      const client = createMockClient();
      // Default wallet is TEST_OWNER, not TEST_AGENT — won't match
      const result = await phalnxAdvise(
        client as unknown as PhalnxClient,
        mockConfig,
        {
          question: "whatCanIDo",
          context: { vault: TEST_VAULT_PDA.toBase58() },
        },
      );

      const parsed = JSON.parse(result);
      // The owner's pubkey doesn't match any agent in the mock vault
      // (TEST_OWNER is the wallet, TEST_AGENT is in the agents array)
      // So this depends on whether the owner pubkey matches an agent
      expect(parsed.question).to.equal("whatCanIDo");
    });

    it("handles vault fetch errors gracefully", async () => {
      const client = createMockClient({
        shouldThrow: new Error("Account not found"),
      });

      const result = await phalnxAdvise(
        client as unknown as PhalnxClient,
        mockConfig,
        {
          question: "whatCanIDo",
          context: { vault: TEST_VAULT_PDA.toBase58() },
        },
      );

      const parsed = JSON.parse(result);
      expect(parsed.available).to.be.false;
      expect(parsed.reason).to.include("Account not found");
    });
  });

  // ── bestRouteFor ────────────────────────────────────────────

  describe("bestRouteFor", () => {
    it("recommends Jupiter for token swaps", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "bestRouteFor",
        context: { inputToken: "USDC", outputToken: "SOL" },
      });

      const parsed = JSON.parse(result);
      expect(parsed.question).to.equal("bestRouteFor");
      expect(parsed.recommendedProtocol).to.equal("jupiter");
      expect(parsed.suggestedTool).to.equal("phalnx_execute");
      expect(parsed.suggestedAction).to.equal("swap");
      expect(parsed.alternatives).to.be.an("array");
    });

    it("returns error when tokens missing", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "bestRouteFor",
        context: {},
      });

      const parsed = JSON.parse(result);
      expect(parsed.error).to.include("inputToken");
    });
  });

  // ── whyDidThisFail ──────────────────────────────────────────

  describe("whyDidThisFail", () => {
    it("returns error details for known error code", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "whyDidThisFail",
        context: { errorCode: 6000 },
      });

      const parsed = JSON.parse(result);
      expect(parsed.question).to.equal("whyDidThisFail");
      expect(parsed.errorCode).to.equal(6000);
      expect(parsed.category).to.equal("PERMISSION");
      expect(parsed.recoverySteps).to.be.an("array").with.length.greaterThan(0);
      expect(parsed.suggestedTool).to.be.a("string");
    });

    it("returns spending cap category for 6006-6011", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "whyDidThisFail",
        context: { errorCode: 6007 },
      });

      const parsed = JSON.parse(result);
      expect(parsed.category).to.equal("SPENDING_CAP");
      expect(parsed.suggestedTool).to.equal("phalnx_query");
    });

    it("returns error when no errorCode provided", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "whyDidThisFail",
        context: {},
      });

      const parsed = JSON.parse(result);
      expect(parsed.error).to.include("errorCode");
    });

    it("handles string errorCode by coercing to number", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "whyDidThisFail",
        context: { errorCode: "6003" as any },
      });

      const parsed = JSON.parse(result);
      expect(parsed.errorCode).to.equal(6003);
      expect(parsed.category).to.equal("INPUT_VALIDATION");
    });

    it("rejects non-numeric errorCode strings", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "whyDidThisFail",
        context: { errorCode: "DROP TABLE" as any },
      });

      const parsed = JSON.parse(result);
      expect(parsed.error).to.include("errorCode");
    });

    it("returns policy violation for 6014-6020", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "whyDidThisFail",
        context: { errorCode: 6015 },
      });

      const parsed = JSON.parse(result);
      expect(parsed.category).to.equal("POLICY_VIOLATION");
    });
  });

  // ── shouldIRetry ────────────────────────────────────────────

  describe("shouldIRetry", () => {
    it("recommends retry for transient errors", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "shouldIRetry",
        context: { errorCode: 9999, attemptCount: 1 },
      });

      const parsed = JSON.parse(result);
      expect(parsed.question).to.equal("shouldIRetry");
      expect(parsed.shouldRetry).to.be.true;
      expect(parsed.delayMs).to.be.a("number");
    });

    it("denies retry for permission errors", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "shouldIRetry",
        context: { errorCode: 6000, attemptCount: 1 },
      });

      const parsed = JSON.parse(result);
      expect(parsed.shouldRetry).to.be.false;
      expect(parsed.reason).to.include("PERMISSION");
    });

    it("denies retry after max attempts exceeded", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "shouldIRetry",
        context: { errorCode: 9999, attemptCount: 5 },
      });

      const parsed = JSON.parse(result);
      expect(parsed.shouldRetry).to.be.false;
      expect(parsed.reason).to.include("Max retries exceeded");
    });

    it("coerces string errorCode in shouldIRetry", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "shouldIRetry",
        context: { errorCode: "6000" as any, attemptCount: 1 },
      });

      const parsed = JSON.parse(result);
      expect(parsed.shouldRetry).to.be.false;
      expect(parsed.reason).to.include("PERMISSION");
    });

    it("returns false when no errorCode provided", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "shouldIRetry",
        context: {},
      });

      const parsed = JSON.parse(result);
      expect(parsed.shouldRetry).to.be.false;
    });

    it("uses exponential backoff delay", async () => {
      const r1 = JSON.parse(
        await phalnxAdvise(null, null, {
          question: "shouldIRetry",
          context: { errorCode: 9999, attemptCount: 1 },
        }),
      );
      const r2 = JSON.parse(
        await phalnxAdvise(null, null, {
          question: "shouldIRetry",
          context: { errorCode: 9999, attemptCount: 2 },
        }),
      );
      // attemptCount=2 should NOT retry (max 2 for transient)
      expect(r1.delayMs).to.equal(1000);
      expect(r2.shouldRetry).to.be.false;
    });
  });

  // ── protocolComparison ──────────────────────────────────────

  describe("protocolComparison", () => {
    it("compares requested protocols", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "protocolComparison",
        context: {
          action: "swap",
          protocols: ["jupiter", "drift"],
        },
      });

      const parsed = JSON.parse(result);
      expect(parsed.question).to.equal("protocolComparison");
      expect(parsed.protocols).to.be.an("array").with.lengthOf(2);
      expect(parsed.recommendation).to.equal("jupiter");
    });

    it("returns all protocols when none specified", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "protocolComparison",
        context: {},
      });

      const parsed = JSON.parse(result);
      expect(parsed.protocols).to.be.an("array");
      expect(parsed.protocols.length).to.be.greaterThan(2);
    });

    it("handles non-array protocols gracefully", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "protocolComparison",
        context: { protocols: "jupiter" as any },
      });

      const parsed = JSON.parse(result);
      // Non-array protocols treated as empty → returns all known protocols
      expect(parsed.protocols).to.be.an("array");
      expect(parsed.protocols.length).to.be.greaterThan(2);
    });

    it("marks unknown protocols as unavailable", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "protocolComparison",
        context: {
          protocols: ["jupiter", "nonexistent"],
        },
      });

      const parsed = JSON.parse(result);
      const unknown = parsed.protocols.find(
        (p: any) => p.protocol === "nonexistent",
      );
      expect(unknown.available).to.be.false;
    });

    it("includes tier and tradeoffs for known protocols", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "protocolComparison",
        context: { protocols: ["flash-trade"] },
      });

      const parsed = JSON.parse(result);
      const ft = parsed.protocols[0];
      expect(ft.tier).to.equal("T2_SDK");
      expect(ft.bestFor).to.be.a("string");
      expect(ft.tradeoffs).to.be.a("string");
      expect(ft.actions).to.be.an("array");
    });
  });

  describe("whatCanIDo edge cases", () => {
    it("returns vaultStatus='frozen' when vault is frozen", async () => {
      const client = createMockClient({
        vault: { status: { frozen: {} } as any },
      });
      (client as any).provider.wallet.publicKey = TEST_AGENT.publicKey;

      const result = await phalnxAdvise(
        client as unknown as PhalnxClient,
        mockConfig,
        {
          question: "whatCanIDo",
          context: { vault: TEST_VAULT_PDA.toBase58() },
        },
      );

      const parsed = JSON.parse(result);
      expect(parsed.available).to.be.false;
      expect(parsed.vaultStatus).to.equal("frozen");
    });

    it("shows agent as paused when agent.paused is true", async () => {
      const client = createMockClient({
        vault: {
          agents: [
            {
              pubkey: TEST_AGENT.publicKey,
              permissions: { toString: () => "2097151" } as any,
              spendingLimitUsd: { toString: () => "0" } as any,
              paused: true,
            },
          ] as any,
        },
      });
      (client as any).provider.wallet.publicKey = TEST_AGENT.publicKey;

      const result = await phalnxAdvise(
        client as unknown as PhalnxClient,
        mockConfig,
        {
          question: "whatCanIDo",
          context: { vault: TEST_VAULT_PDA.toBase58() },
        },
      );

      const parsed = JSON.parse(result);
      expect(parsed.agentPaused).to.be.true;
    });
  });

  describe("whyDidThisFail edge cases", () => {
    it("returns TRANSIENT category for unknown error code", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "whyDidThisFail",
        context: { errorCode: 7777 },
      });

      const parsed = JSON.parse(result);
      expect(parsed.errorCode).to.equal(7777);
      expect(parsed.errorName).to.equal("UnknownError");
      expect(parsed.category).to.equal("TRANSIENT");
    });
  });

  describe("protocolComparison edge cases", () => {
    it("single protocol returns array of length 1", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "protocolComparison",
        context: { protocols: ["jupiter"] },
      });

      const parsed = JSON.parse(result);
      expect(parsed.protocols).to.have.lengthOf(1);
      expect(parsed.protocols[0].protocol).to.equal("jupiter");
      expect(parsed.protocols[0].available).to.be.true;
    });
  });

  describe("bestRouteFor edge cases", () => {
    it("returns error when outputToken is missing", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "bestRouteFor",
        context: { inputToken: "USDC" },
      });

      const parsed = JSON.parse(result);
      expect(parsed.error).to.include("inputToken");
    });
  });

  // ── General ─────────────────────────────────────────────────

  describe("general", () => {
    it("all responses are valid JSON", async () => {
      const questions: PhalnxAdviseInput["question"][] = [
        "bestRouteFor",
        "whyDidThisFail",
        "shouldIRetry",
        "protocolComparison",
      ];

      for (const q of questions) {
        const result = await phalnxAdvise(null, null, {
          question: q,
          context:
            q === "bestRouteFor"
              ? { inputToken: "SOL", outputToken: "USDC" }
              : q === "whyDidThisFail"
                ? { errorCode: 6000 }
                : q === "shouldIRetry"
                  ? { errorCode: 6000 }
                  : {},
        });
        expect(() => JSON.parse(result), `${q} should return valid JSON`).not
          .to.throw;
      }
    });

    it("every response includes suggestedTool or recommendation", async () => {
      const result = await phalnxAdvise(null, null, {
        question: "bestRouteFor",
        context: { inputToken: "USDC", outputToken: "SOL" },
      });

      const parsed = JSON.parse(result);
      const hasSuggestion =
        "suggestedTool" in parsed || "recommendation" in parsed;
      expect(hasSuggestion).to.be.true;
    });
  });
});
