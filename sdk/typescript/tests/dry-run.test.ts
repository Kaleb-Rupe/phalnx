import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  dryRunPolicy,
  ShieldState,
  shieldWallet,
  type DryRunInput,
  type DryRunResult,
} from "../src/wrapper";

// Known USDC mint (mainnet — matches what parseSpendLimit resolves to)
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

function createMockWallet() {
  const kp = Keypair.generate();
  return {
    publicKey: kp.publicKey,
    async signTransaction(tx: any) {
      return tx;
    },
  };
}

describe("dryRunPolicy", () => {
  describe("intent mode", () => {
    it("allows an intent within budget", () => {
      const state = new ShieldState();
      const result = dryRunPolicy({ maxSpend: "500 USDC/day" }, state, {
        intent: { mint: USDC_MINT, amount: BigInt(100_000_000) },
      });

      expect(result.allowed).to.be.true;
      expect(result.violations).to.have.length(0);
      expect(result.spendingSummary.length).to.be.greaterThan(0);
    });

    it("denies an intent exceeding budget", () => {
      const state = new ShieldState();
      const result = dryRunPolicy({ maxSpend: "100 USDC/day" }, state, {
        intent: { mint: USDC_MINT, amount: BigInt(200_000_000) },
      });

      expect(result.allowed).to.be.false;
      expect(result.violations.length).to.be.greaterThan(0);
    });

    it("returns fee estimates", () => {
      const state = new ShieldState();
      const result = dryRunPolicy({ maxSpend: "500 USDC/day" }, state, {
        intent: { mint: USDC_MINT, amount: BigInt(100_000_000) },
      });

      expect(result.estimatedFees.protocolFeeBps).to.equal(2);
      expect(result.estimatedFees.estimatedFeeUsd).to.be.a("bigint");
    });

    it("returns remaining budget", () => {
      const state = new ShieldState();
      const result = dryRunPolicy({ maxSpend: "500 USDC/day" }, state, {
        intent: { mint: USDC_MINT, amount: BigInt(100_000_000) },
      });

      expect(result.remainingBudgetUsd).to.be.a("bigint");
      expect(result.remainingBudgetUsd > BigInt(0)).to.be.true;
    });

    it("handles zero amount", () => {
      const state = new ShieldState();
      const result = dryRunPolicy({ maxSpend: "500 USDC/day" }, state, {
        intent: { mint: USDC_MINT, amount: BigInt(0) },
      });

      expect(result.allowed).to.be.true;
    });

    it("handles string mint", () => {
      const state = new ShieldState();
      const result = dryRunPolicy({ maxSpend: "500 USDC/day" }, state, {
        intent: { mint: USDC_MINT.toBase58(), amount: BigInt(100_000_000) },
      });

      expect(result.allowed).to.be.true;
    });

    it("detects disallowed programId", () => {
      const state = new ShieldState();
      const unknownProgram = Keypair.generate().publicKey;
      const result = dryRunPolicy(
        {
          maxSpend: "500 USDC/day",
          allowedProtocols: [Keypair.generate().publicKey.toBase58()],
        },
        state,
        {
          intent: {
            mint: USDC_MINT,
            amount: BigInt(100_000_000),
            programIds: [unknownProgram],
          },
        },
      );

      expect(result.allowed).to.be.false;
      const v = result.violations.find(
        (v) => v.rule === "protocol_not_allowed",
      );
      expect(v).to.exist;
    });
  });

  describe("validation", () => {
    it("works with resolved policies", () => {
      const state = new ShieldState();
      const { resolvePolicies } = require("../src/wrapper/policies");
      const resolved = resolvePolicies({ maxSpend: "500 USDC/day" });

      const result = dryRunPolicy(resolved, state, {
        intent: { mint: USDC_MINT, amount: BigInt(100_000_000) },
      });

      expect(result.allowed).to.be.true;
    });

    it("accounts for prior spending", () => {
      const state = new ShieldState();
      // Record 400 USDC of prior spending
      state.recordSpend(USDC_MINT.toBase58(), BigInt(400_000_000));

      const result = dryRunPolicy({ maxSpend: "500 USDC/day" }, state, {
        intent: { mint: USDC_MINT, amount: BigInt(200_000_000) },
      });

      expect(result.allowed).to.be.false;
    });

    it("does not count when denied", () => {
      const state = new ShieldState();
      // Record 400 USDC
      state.recordSpend(USDC_MINT.toBase58(), BigInt(400_000_000));

      // Try 200 USDC — should be denied
      dryRunPolicy({ maxSpend: "500 USDC/day" }, state, {
        intent: { mint: USDC_MINT, amount: BigInt(200_000_000) },
      });

      // State should not have changed — still at 400
      const spent = state.getSpendInWindow(USDC_MINT.toBase58(), 86_400_000);
      expect(spent).to.equal(BigInt(400_000_000));
    });
  });

  describe("state isolation", () => {
    it("does not affect real state after dry run", () => {
      const state = new ShieldState();
      const before = state.getSpendInWindow(USDC_MINT.toBase58(), 86_400_000);

      dryRunPolicy({ maxSpend: "500 USDC/day" }, state, {
        intent: { mint: USDC_MINT, amount: BigInt(100_000_000) },
      });

      const after = state.getSpendInWindow(USDC_MINT.toBase58(), 86_400_000);
      expect(after).to.equal(before);
    });
  });

  describe("ShieldedWallet.dryRun()", () => {
    it("is available on shielded wallets", () => {
      const wallet = shieldWallet(createMockWallet(), {
        maxSpend: "500 USDC/day",
      });

      expect(wallet.dryRun).to.be.a("function");

      const result = wallet.dryRun({
        intent: { mint: USDC_MINT, amount: BigInt(100_000_000) },
      });

      expect(result.allowed).to.be.true;
      expect(result.spendingSummary.length).to.be.greaterThan(0);
    });
  });
});
