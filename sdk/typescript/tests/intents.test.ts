import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createIntent,
  summarizeAction,
  MemoryIntentStorage,
  DEFAULT_INTENT_TTL_MS,
  type IntentAction,
  type TransactionIntent,
} from "../src/intents";

describe("intents", () => {
  const vault = Keypair.generate().publicKey;
  const agent = Keypair.generate().publicKey;

  describe("DEFAULT_INTENT_TTL_MS", () => {
    it("equals 1 hour (3,600,000 ms)", () => {
      expect(DEFAULT_INTENT_TTL_MS).to.equal(3_600_000);
    });
  });

  describe("createIntent", () => {
    it("generates a UUID id", () => {
      const intent = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
      );
      expect(intent.id).to.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("sets status to pending", () => {
      const intent = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
      );
      expect(intent.status).to.equal("pending");
    });

    it("sets createdAt and updatedAt to current time", () => {
      const before = Date.now();
      const intent = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
      );
      const after = Date.now();
      expect(intent.createdAt).to.be.at.least(before);
      expect(intent.createdAt).to.be.at.most(after);
      expect(intent.updatedAt).to.equal(intent.createdAt);
    });

    it("calculates expiresAt using default TTL", () => {
      const intent = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
      );
      expect(intent.expiresAt).to.equal(
        intent.createdAt + DEFAULT_INTENT_TTL_MS,
      );
    });

    it("uses custom TTL when provided", () => {
      const customTtl = 60_000; // 1 minute
      const intent = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
        { ttlMs: customTtl },
      );
      expect(intent.expiresAt).to.equal(intent.createdAt + customTtl);
    });

    it("stores vault and agent public keys", () => {
      const intent = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
      );
      expect(intent.vault.toBase58()).to.equal(vault.toBase58());
      expect(intent.agent.toBase58()).to.equal(agent.toBase58());
    });

    it("generates summary from action", () => {
      const intent = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
      );
      expect(intent.summary).to.include("Swap");
      expect(intent.summary).to.include("USDC");
      expect(intent.summary).to.include("SOL");
    });
  });

  describe("summarizeAction", () => {
    it("summarizes swap action", () => {
      const summary = summarizeAction({
        type: "swap",
        params: { inputMint: "USDC", outputMint: "SOL", amount: "500" },
      });
      expect(summary).to.include("Swap");
      expect(summary).to.include("500");
      expect(summary).to.include("USDC");
      expect(summary).to.include("SOL");
    });

    it("summarizes openPosition action", () => {
      const summary = summarizeAction({
        type: "openPosition",
        params: {
          market: "SOL-PERP",
          side: "long",
          collateral: "100",
          leverage: 5,
        },
      });
      expect(summary).to.include("Open");
      expect(summary).to.include("long");
      expect(summary).to.include("SOL-PERP");
      expect(summary).to.include("5x");
    });

    it("summarizes closePosition action", () => {
      const summary = summarizeAction({
        type: "closePosition",
        params: { market: "ETH-PERP" },
      });
      expect(summary).to.include("Close");
      expect(summary).to.include("ETH-PERP");
    });

    it("summarizes closePosition with positionId", () => {
      const summary = summarizeAction({
        type: "closePosition",
        params: { market: "ETH-PERP", positionId: "pos-123" },
      });
      expect(summary).to.include("pos-123");
    });

    it("summarizes transfer action", () => {
      const summary = summarizeAction({
        type: "transfer",
        params: { destination: "abc123", mint: "USDC", amount: "1000" },
      });
      expect(summary).to.include("Transfer");
      expect(summary).to.include("1000");
      expect(summary).to.include("USDC");
      expect(summary).to.include("abc123");
    });

    it("summarizes deposit action", () => {
      const summary = summarizeAction({
        type: "deposit",
        params: { mint: "USDT", amount: "250" },
      });
      expect(summary).to.include("Deposit");
      expect(summary).to.include("250");
      expect(summary).to.include("USDT");
    });

    it("summarizes withdraw action", () => {
      const summary = summarizeAction({
        type: "withdraw",
        params: { mint: "USDC", amount: "75" },
      });
      expect(summary).to.include("Withdraw");
      expect(summary).to.include("75");
      expect(summary).to.include("USDC");
    });
  });

  describe("MemoryIntentStorage", () => {
    let storage: MemoryIntentStorage;

    beforeEach(() => {
      storage = new MemoryIntentStorage();
    });

    it("saves and retrieves an intent", async () => {
      const intent = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
      );
      await storage.save(intent);
      const retrieved = await storage.get(intent.id);
      expect(retrieved).to.not.be.null;
      expect(retrieved!.id).to.equal(intent.id);
      expect(retrieved!.status).to.equal("pending");
    });

    it("returns null for nonexistent id", async () => {
      const retrieved = await storage.get("nonexistent-id");
      expect(retrieved).to.be.null;
    });

    it("lists all intents", async () => {
      const intent1 = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
      );
      const intent2 = createIntent(
        { type: "deposit", params: { mint: "USDC", amount: "500" } },
        vault,
        agent,
      );
      await storage.save(intent1);
      await storage.save(intent2);
      const list = await storage.list();
      expect(list).to.have.lengthOf(2);
    });

    it("filters by status", async () => {
      const intent1 = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
      );
      const intent2 = createIntent(
        { type: "deposit", params: { mint: "USDC", amount: "500" } },
        vault,
        agent,
      );
      await storage.save(intent1);
      await storage.save(intent2);
      await storage.update(intent1.id, {
        status: "approved",
        updatedAt: Date.now(),
      });

      const approved = await storage.list({ status: "approved" });
      expect(approved).to.have.lengthOf(1);
      expect(approved[0].id).to.equal(intent1.id);

      const pending = await storage.list({ status: "pending" });
      expect(pending).to.have.lengthOf(1);
      expect(pending[0].id).to.equal(intent2.id);
    });

    it("filters by vault", async () => {
      const vault2 = Keypair.generate().publicKey;
      const intent1 = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
      );
      const intent2 = createIntent(
        { type: "deposit", params: { mint: "USDC", amount: "500" } },
        vault2,
        agent,
      );
      await storage.save(intent1);
      await storage.save(intent2);

      const filtered = await storage.list({ vault: vault2 });
      expect(filtered).to.have.lengthOf(1);
      expect(filtered[0].vault.toBase58()).to.equal(vault2.toBase58());
    });

    it("updates intent status", async () => {
      const intent = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
      );
      await storage.save(intent);
      await storage.update(intent.id, {
        status: "approved",
        updatedAt: Date.now(),
      });

      const retrieved = await storage.get(intent.id);
      expect(retrieved!.status).to.equal("approved");
    });

    it("throws on update for nonexistent intent", async () => {
      try {
        await storage.update("nonexistent", { status: "approved" });
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.message).to.include("Intent not found");
      }
    });

    it("creates defensive copies on save", async () => {
      const intent = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
      );
      await storage.save(intent);

      // Mutate the original
      (intent as any).status = "executed";
      (intent.action.params as any).amount = "99999";

      // Stored version should be unchanged
      const retrieved = await storage.get(intent.id);
      expect(retrieved!.status).to.equal("pending");
      expect((retrieved!.action.params as any).amount).to.equal("100");
    });

    it("creates defensive copies on get", async () => {
      const intent = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
      );
      await storage.save(intent);

      const retrieved1 = await storage.get(intent.id);
      (retrieved1 as any).status = "failed";

      const retrieved2 = await storage.get(intent.id);
      expect(retrieved2!.status).to.equal("pending");
    });

    it("supports lifecycle: pending → approved → executed", async () => {
      const intent = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
      );
      await storage.save(intent);
      expect((await storage.get(intent.id))!.status).to.equal("pending");

      await storage.update(intent.id, {
        status: "approved",
        updatedAt: Date.now(),
      });
      expect((await storage.get(intent.id))!.status).to.equal("approved");

      await storage.update(intent.id, {
        status: "executed",
        updatedAt: Date.now(),
      });
      expect((await storage.get(intent.id))!.status).to.equal("executed");
    });

    it("supports lifecycle: pending → rejected", async () => {
      const intent = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
      );
      await storage.save(intent);

      await storage.update(intent.id, {
        status: "rejected",
        updatedAt: Date.now(),
      });
      expect((await storage.get(intent.id))!.status).to.equal("rejected");
    });

    it("records error on failed intent", async () => {
      const intent = createIntent(
        {
          type: "swap",
          params: { inputMint: "USDC", outputMint: "SOL", amount: "100" },
        },
        vault,
        agent,
      );
      await storage.save(intent);

      await storage.update(intent.id, {
        status: "failed",
        updatedAt: Date.now(),
        error: "Simulation failed: VaultNotActive",
      });

      const retrieved = await storage.get(intent.id);
      expect(retrieved!.status).to.equal("failed");
      expect(retrieved!.error).to.equal("Simulation failed: VaultNotActive");
    });
  });
});
