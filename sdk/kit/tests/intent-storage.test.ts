import { expect } from "chai";
import type { Address } from "@solana/kit";
import {
  createIntent,
  MemoryIntentStorage,
  DEFAULT_INTENT_TTL_MS,
  type IntentAction,
} from "../src/intent-storage.js";

const VAULT = "Vault111111111111111111111111111111111111111" as Address;
const AGENT = "Agent111111111111111111111111111111111111111" as Address;
const VAULT_B = "Vault222222222222222222222222222222222222222" as Address;

const SWAP_INTENT: IntentAction = {
  type: "swap",
  params: {
    inputMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    outputMint: "So11111111111111111111111111111111111111112",
    amount: "1000000",
  },
};

const TRANSFER_INTENT: IntentAction = {
  type: "transfer",
  params: {
    destination: "Dest1111111111111111111111111111111111111111",
    mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    amount: "500000",
  },
};

describe("intent-storage", () => {
  describe("createIntent()", () => {
    it("returns valid TransactionIntent with UUID and pending status", () => {
      const intent = createIntent(SWAP_INTENT, VAULT, AGENT);
      expect(intent.id).to.be.a("string");
      expect(intent.id.length).to.be.greaterThan(0);
      expect(intent.status).to.equal("pending");
      expect(intent.vault).to.equal(VAULT);
      expect(intent.agent).to.equal(AGENT);
      expect(intent.action).to.deep.equal(SWAP_INTENT);
      expect(intent.createdAt).to.be.a("number");
      expect(intent.expiresAt).to.be.a("number");
      expect(intent.updatedAt).to.equal(intent.createdAt);
      expect(intent.summary).to.be.a("string");
    });

    it("uses custom TTL when provided", () => {
      const customTtl = 5_000;
      const intent = createIntent(SWAP_INTENT, VAULT, AGENT, {
        ttlMs: customTtl,
      });
      expect(intent.expiresAt - intent.createdAt).to.equal(customTtl);
    });

    it("defaults to DEFAULT_INTENT_TTL_MS", () => {
      const intent = createIntent(SWAP_INTENT, VAULT, AGENT);
      expect(intent.expiresAt - intent.createdAt).to.equal(
        DEFAULT_INTENT_TTL_MS,
      );
    });
  });

  describe("MemoryIntentStorage", () => {
    it("save() and get() roundtrip", async () => {
      const storage = new MemoryIntentStorage();
      const intent = createIntent(SWAP_INTENT, VAULT, AGENT);
      await storage.save(intent);
      const retrieved = await storage.get(intent.id);
      expect(retrieved).to.not.be.null;
      expect(retrieved!.id).to.equal(intent.id);
      expect(retrieved!.action).to.deep.equal(intent.action);
    });

    it("get() returns null for missing ID", async () => {
      const storage = new MemoryIntentStorage();
      const result = await storage.get("nonexistent-id");
      expect(result).to.be.null;
    });

    it("list() returns all intents", async () => {
      const storage = new MemoryIntentStorage();
      await storage.save(createIntent(SWAP_INTENT, VAULT, AGENT));
      await storage.save(createIntent(TRANSFER_INTENT, VAULT, AGENT));
      const all = await storage.list();
      expect(all).to.have.length(2);
    });

    it("list() filters by status", async () => {
      const storage = new MemoryIntentStorage();
      const intent1 = createIntent(SWAP_INTENT, VAULT, AGENT);
      const intent2 = createIntent(TRANSFER_INTENT, VAULT, AGENT);
      await storage.save(intent1);
      await storage.save(intent2);
      await storage.update(intent1.id, { status: "executed" });

      const pending = await storage.list({ status: "pending" });
      expect(pending).to.have.length(1);
      expect(pending[0].id).to.equal(intent2.id);

      const executed = await storage.list({ status: "executed" });
      expect(executed).to.have.length(1);
      expect(executed[0].id).to.equal(intent1.id);
    });

    it("list() filters by vault", async () => {
      const storage = new MemoryIntentStorage();
      await storage.save(createIntent(SWAP_INTENT, VAULT, AGENT));
      await storage.save(createIntent(SWAP_INTENT, VAULT_B, AGENT));

      const vaultAIntents = await storage.list({ vault: VAULT });
      expect(vaultAIntents).to.have.length(1);
      expect(vaultAIntents[0].vault).to.equal(VAULT);
    });

    it("update() changes status", async () => {
      const storage = new MemoryIntentStorage();
      const intent = createIntent(SWAP_INTENT, VAULT, AGENT);
      await storage.save(intent);
      await storage.update(intent.id, { status: "executed" });
      const updated = await storage.get(intent.id);
      expect(updated!.status).to.equal("executed");
    });

    it("update() throws for missing ID", async () => {
      const storage = new MemoryIntentStorage();
      try {
        await storage.update("nonexistent", { status: "executed" });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).to.include("Intent not found");
      }
    });

    it("delete() removes intent", async () => {
      const storage = new MemoryIntentStorage();
      const intent = createIntent(SWAP_INTENT, VAULT, AGENT);
      await storage.save(intent);
      const deleted = await storage.delete(intent.id);
      expect(deleted).to.be.true;
      expect(await storage.get(intent.id)).to.be.null;
      expect(storage.size).to.equal(0);
    });

    it("delete() returns false for missing ID", async () => {
      const storage = new MemoryIntentStorage();
      const deleted = await storage.delete("nonexistent");
      expect(deleted).to.be.false;
    });

    it("prune() removes expired intents", async () => {
      const storage = new MemoryIntentStorage();
      // Create an intent that is already expired (ttl = 0)
      const expired = createIntent(SWAP_INTENT, VAULT, AGENT, { ttlMs: 0 });
      // Create one that is still valid
      const valid = createIntent(TRANSFER_INTENT, VAULT, AGENT, {
        ttlMs: 3_600_000,
      });
      await storage.save(expired);
      await storage.save(valid);

      // Small delay to ensure expired.expiresAt <= Date.now()
      await new Promise((r) => setTimeout(r, 5));

      const pruned = await storage.prune();
      expect(pruned).to.equal(1);
      expect(storage.size).to.equal(1);
      expect(await storage.get(expired.id)).to.be.null;
      expect(await storage.get(valid.id)).to.not.be.null;
    });

    it("returns defensive copies (mutation safety)", async () => {
      const storage = new MemoryIntentStorage();
      const intent = createIntent(SWAP_INTENT, VAULT, AGENT);
      await storage.save(intent);

      const retrieved = await storage.get(intent.id);
      // Mutate the retrieved copy
      (retrieved!.action.params as any).amount = "MUTATED";

      // Original in storage should be unaffected
      const fresh = await storage.get(intent.id);
      expect((fresh!.action.params as any).amount).to.equal("1000000");
    });

    it("size reflects current count", async () => {
      const storage = new MemoryIntentStorage();
      expect(storage.size).to.equal(0);
      await storage.save(createIntent(SWAP_INTENT, VAULT, AGENT));
      expect(storage.size).to.equal(1);
      await storage.save(createIntent(TRANSFER_INTENT, VAULT, AGENT));
      expect(storage.size).to.equal(2);
    });
  });
});
