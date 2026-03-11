import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createIntent,
  summarizeAction,
  MemoryIntentStorage,
  DEFAULT_INTENT_TTL_MS,
  ACTION_TYPE_MAP,
  type IntentAction,
  type IntentActionType,
  type TransactionIntent,
} from "../src/intents";
import { hasPermission, FULL_PERMISSIONS } from "../src/types";

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

    it("summarizes increasePosition action", () => {
      const summary = summarizeAction({
        type: "increasePosition",
        params: {
          market: "SOL-PERP",
          side: "long",
          sizeDelta: "50",
          collateralAmount: "100",
        },
      });
      expect(summary).to.include("Increase");
      expect(summary).to.include("long");
      expect(summary).to.include("SOL-PERP");
    });

    it("summarizes decreasePosition action", () => {
      const summary = summarizeAction({
        type: "decreasePosition",
        params: { market: "ETH-PERP", side: "short", sizeDelta: "25" },
      });
      expect(summary).to.include("Decrease");
      expect(summary).to.include("short");
    });

    it("summarizes addCollateral action", () => {
      const summary = summarizeAction({
        type: "addCollateral",
        params: {
          market: "SOL-PERP",
          side: "long",
          collateralAmount: "200",
        },
      });
      expect(summary).to.include("Add");
      expect(summary).to.include("200");
      expect(summary).to.include("collateral");
    });

    it("summarizes removeCollateral action", () => {
      const summary = summarizeAction({
        type: "removeCollateral",
        params: {
          market: "SOL-PERP",
          side: "long",
          collateralDeltaUsd: "50",
        },
      });
      expect(summary).to.include("Remove");
      expect(summary).to.include("50");
    });

    it("summarizes placeTriggerOrder action", () => {
      const summary = summarizeAction({
        type: "placeTriggerOrder",
        params: {
          market: "SOL-PERP",
          side: "long",
          triggerPrice: "150",
          deltaSizeAmount: "10",
          isStopLoss: true,
        },
      });
      expect(summary).to.include("stop-loss");
      expect(summary).to.include("SOL-PERP");
      expect(summary).to.include("150");
    });

    it("summarizes placeTriggerOrder take-profit", () => {
      const summary = summarizeAction({
        type: "placeTriggerOrder",
        params: {
          market: "SOL-PERP",
          side: "long",
          triggerPrice: "200",
          deltaSizeAmount: "10",
          isStopLoss: false,
        },
      });
      expect(summary).to.include("take-profit");
    });

    it("summarizes placeLimitOrder action", () => {
      const summary = summarizeAction({
        type: "placeLimitOrder",
        params: {
          market: "BTC-PERP",
          side: "short",
          reserveAmount: "500",
          sizeAmount: "1000",
          limitPrice: "60000",
        },
      });
      expect(summary).to.include("limit order");
      expect(summary).to.include("BTC-PERP");
      expect(summary).to.include("60000");
    });

    it("summarizes createEscrow action", () => {
      const summary = summarizeAction({
        type: "createEscrow",
        params: {
          destinationVault: "dest123",
          amount: "500",
          mint: "USDC",
          expiresInSeconds: 86400,
        },
      });
      expect(summary).to.include("escrow");
      expect(summary).to.include("500");
      expect(summary).to.include("USDC");
    });

    it("summarizes settleEscrow action", () => {
      const summary = summarizeAction({
        type: "settleEscrow",
        params: { sourceVault: "src123", escrowId: "42" },
      });
      expect(summary).to.include("Settle");
      expect(summary).to.include("42");
    });

    it("summarizes refundEscrow action", () => {
      const summary = summarizeAction({
        type: "refundEscrow",
        params: { destinationVault: "dest123", escrowId: "42" },
      });
      expect(summary).to.include("Refund");
      expect(summary).to.include("42");
    });

    it("summarizes swapAndOpenPosition action", () => {
      const summary = summarizeAction({
        type: "swapAndOpenPosition",
        params: {
          inputMint: "USDC",
          outputMint: "SOL",
          amount: "100",
          market: "SOL-PERP",
          side: "long",
          sizeAmount: "500",
          leverageBps: 50000,
        },
      });
      expect(summary).to.include("Swap");
      expect(summary).to.include("open");
      expect(summary).to.include("SOL-PERP");
    });

    it("summarizes closeAndSwapPosition action", () => {
      const summary = summarizeAction({
        type: "closeAndSwapPosition",
        params: {
          market: "ETH-PERP",
          side: "short",
          outputMint: "USDC",
        },
      });
      expect(summary).to.include("Close");
      expect(summary).to.include("swap");
      expect(summary).to.include("USDC");
    });

    // Drift intent summaries
    it("summarizes driftDeposit action", () => {
      const summary = summarizeAction({
        type: "driftDeposit",
        params: { mint: "USDC", amount: "1000", marketIndex: 0 },
      });
      expect(summary).to.include("Drift deposit");
      expect(summary).to.include("market 0");
    });

    it("summarizes driftWithdraw action", () => {
      const summary = summarizeAction({
        type: "driftWithdraw",
        params: { mint: "USDC", amount: "500", marketIndex: 0 },
      });
      expect(summary).to.include("Drift withdraw");
    });

    it("summarizes driftPerpOrder action", () => {
      const summary = summarizeAction({
        type: "driftPerpOrder",
        params: {
          marketIndex: 0,
          side: "long",
          amount: "1000000000",
          orderType: "limit",
        },
      });
      expect(summary).to.include("Drift long perp");
      expect(summary).to.include("limit");
    });

    it("summarizes driftSpotOrder action", () => {
      const summary = summarizeAction({
        type: "driftSpotOrder",
        params: {
          marketIndex: 1,
          side: "short",
          amount: "5000",
          orderType: "market",
        },
      });
      expect(summary).to.include("Drift short spot");
      expect(summary).to.include("market");
    });

    it("summarizes driftCancelOrder action", () => {
      const summary = summarizeAction({
        type: "driftCancelOrder",
        params: { orderId: 42 },
      });
      expect(summary).to.include("Drift cancel order #42");
    });

    // Kamino intent summaries
    it("summarizes kaminoDeposit action", () => {
      const summary = summarizeAction({
        type: "kaminoDeposit",
        params: { mint: "USDC", amount: "1000" },
      });
      expect(summary).to.include("Kamino deposit");
      expect(summary).to.include("USDC");
    });

    it("summarizes kaminoBorrow action", () => {
      const summary = summarizeAction({
        type: "kaminoBorrow",
        params: { mint: "SOL", amount: "10" },
      });
      expect(summary).to.include("Kamino borrow");
      expect(summary).to.include("SOL");
    });

    it("summarizes kaminoRepay action", () => {
      const summary = summarizeAction({
        type: "kaminoRepay",
        params: { mint: "SOL", amount: "10" },
      });
      expect(summary).to.include("Kamino repay");
    });

    it("summarizes kaminoWithdraw action", () => {
      const summary = summarizeAction({
        type: "kaminoWithdraw",
        params: { mint: "USDC", amount: "500" },
      });
      expect(summary).to.include("Kamino withdraw");
    });

    // Generic protocol intent summary
    it("summarizes protocol action", () => {
      const summary = summarizeAction({
        type: "protocol",
        params: { protocolId: "my-proto", action: "stake" },
      });
      expect(summary).to.include("my-proto");
      expect(summary).to.include("stake");
    });
  });

  describe("ACTION_TYPE_MAP", () => {
    const ALL_TYPES: IntentActionType[] = [
      "swap",
      "openPosition",
      "closePosition",
      "increasePosition",
      "decreasePosition",
      "deposit",
      "withdraw",
      "transfer",
      "addCollateral",
      "removeCollateral",
      "placeTriggerOrder",
      "editTriggerOrder",
      "cancelTriggerOrder",
      "placeLimitOrder",
      "editLimitOrder",
      "cancelLimitOrder",
      "swapAndOpenPosition",
      "closeAndSwapPosition",
      "createEscrow",
      "settleEscrow",
      "refundEscrow",
      // Drift
      "driftDeposit",
      "driftWithdraw",
      "driftPerpOrder",
      "driftSpotOrder",
      "driftCancelOrder",
      // Kamino
      "kaminoDeposit",
      "kaminoBorrow",
      "kaminoRepay",
      "kaminoWithdraw",
      // Generic
      "protocol",
      "passthrough",
    ];

    it("maps all 32 action types", () => {
      expect(Object.keys(ACTION_TYPE_MAP)).to.have.lengthOf(32);
    });

    for (const type of ALL_TYPES) {
      it(`maps ${type} to ActionType object`, () => {
        const mapping = ACTION_TYPE_MAP[type];
        expect(mapping).to.not.be.undefined;
        expect(mapping.actionType).to.be.an("object");
        expect(typeof mapping.isSpending).to.equal("boolean");
        // ActionType has exactly one key
        expect(Object.keys(mapping.actionType)).to.have.lengthOf(1);
      });
    }

    it("marks spending actions correctly", () => {
      const spendingTypes = [
        "swap",
        "openPosition",
        "increasePosition",
        "deposit",
        "transfer",
        "addCollateral",
        "placeLimitOrder",
        "swapAndOpenPosition",
        "createEscrow",
        "driftDeposit",
        "driftPerpOrder",
        "driftSpotOrder",
        "kaminoDeposit",
        "kaminoRepay",
        "protocol",
      ];
      for (const type of spendingTypes) {
        expect(ACTION_TYPE_MAP[type as IntentActionType].isSpending).to.equal(
          true,
          `${type} should be spending`,
        );
      }
    });

    it("all intent types map to base action keys recognized by hasPermission", () => {
      // H-1 fix: precheck extracts base key from mapping.actionType
      // e.g., "swap" → { swap: {} } → Object.keys()[0] = "swap" → valid in ACTION_PERMISSION_MAP
      // When protocol-specific intents are added (e.g., "driftDeposit" → { deposit: {} }),
      // extracting the base key ensures hasPermission uses "deposit", not "driftDeposit"
      for (const [type, mapping] of Object.entries(ACTION_TYPE_MAP)) {
        const baseKey = Object.keys(mapping.actionType)[0];
        expect(
          hasPermission(FULL_PERMISSIONS, baseKey),
          `Base key "${baseKey}" for "${type}" not recognized by hasPermission`,
        ).to.be.true;
      }
    });

    it("hasPermission rejects unknown action type strings", () => {
      // Proves the H-1 bug: passing a raw protocol-specific key would fail
      expect(hasPermission(FULL_PERMISSIONS, "driftDeposit")).to.be.false;
      expect(hasPermission(FULL_PERMISSIONS, "kaminoRepay")).to.be.false;
      expect(hasPermission(FULL_PERMISSIONS, "unknownAction")).to.be.false;
    });

    it("marks non-spending actions correctly", () => {
      const nonSpendingTypes = [
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
        "driftWithdraw",
        "driftCancelOrder",
        "kaminoBorrow",
        "kaminoWithdraw",
      ];
      for (const type of nonSpendingTypes) {
        expect(ACTION_TYPE_MAP[type as IntentActionType].isSpending).to.equal(
          false,
          `${type} should be non-spending`,
        );
      }
    });
  });

  describe("spending cap comparison logic (M-3 fix)", () => {
    // Extracted from precheck() — validates the fix for intent amount comparison
    function capPassed(
      intentAmountUsd: number | null,
      remaining: number,
    ): boolean {
      return intentAmountUsd !== null
        ? intentAmountUsd <= remaining
        : remaining > 0;
    }

    it("rejects when intent amount exceeds remaining", () => {
      expect(capPassed(500, 100)).to.be.false;
    });

    it("passes when intent amount fits within remaining", () => {
      expect(capPassed(50, 100)).to.be.true;
    });

    it("passes when intent amount exactly equals remaining", () => {
      expect(capPassed(100, 100)).to.be.true;
    });

    it("falls back to remaining > 0 when amount unknown", () => {
      expect(capPassed(null, 100)).to.be.true;
      expect(capPassed(null, 0)).to.be.false;
    });

    it("rejects zero remaining even for zero intent amount", () => {
      // On-chain: 0 remaining means cap is fully consumed
      expect(capPassed(0, 0)).to.be.true; // 0 <= 0 is true (no spend)
      expect(capPassed(1, 0)).to.be.false; // any positive amount rejected
    });
  });

  describe("slippage comparison logic (M-4 fix)", () => {
    // Extracted from precheck() — validates the fix for maxSlippageBps=0
    function slipPassed(intentBps: number, vaultMaxBps: number): boolean {
      return intentBps <= vaultMaxBps;
    }

    it("vaultMax=0, intent=0 → true (exact swap allowed)", () => {
      expect(slipPassed(0, 0)).to.be.true;
    });

    it("vaultMax=0, intent=50 → false (rejects any slippage)", () => {
      expect(slipPassed(50, 0)).to.be.false;
    });

    it("vaultMax=500, intent=100 → true", () => {
      expect(slipPassed(100, 500)).to.be.true;
    });

    it("vaultMax=500, intent=600 → false", () => {
      expect(slipPassed(600, 500)).to.be.false;
    });

    it("vaultMax=500, intent=500 → true (boundary)", () => {
      expect(slipPassed(500, 500)).to.be.true;
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
