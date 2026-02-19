import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import {
  PYTH_RECEIVER_PROGRAM,
  SWITCHBOARD_ON_DEMAND_PROGRAM,
  PYTH_FEEDS,
  SWITCHBOARD_FEEDS,
  resolveOracleFeed,
} from "../src/oracle";

describe("Oracle — Resolution", () => {
  describe("constants", () => {
    it("PYTH_RECEIVER_PROGRAM has correct address", () => {
      expect(PYTH_RECEIVER_PROGRAM.toBase58()).to.equal(
        "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ",
      );
    });

    it("SWITCHBOARD_ON_DEMAND_PROGRAM has correct address", () => {
      expect(SWITCHBOARD_ON_DEMAND_PROGRAM.toBase58()).to.equal(
        "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv",
      );
    });
  });

  describe("resolveOracleFeed", () => {
    it("returns Pyth feed for SOL mint", () => {
      const solMint = new PublicKey(
        "So11111111111111111111111111111111111111112",
      );
      const result = resolveOracleFeed(solMint);
      expect(result).to.not.be.null;
      expect(result!.source).to.equal("pyth");
      expect(result!.feed).to.be.instanceOf(PublicKey);
    });

    it("returns null for unknown token mint", () => {
      const unknownMint = PublicKey.unique();
      const result = resolveOracleFeed(unknownMint);
      expect(result).to.be.null;
    });

    it("returns null for stablecoin (USDC) — not in oracle maps", () => {
      const usdcMint = new PublicKey(
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      );
      const result = resolveOracleFeed(usdcMint);
      // USDC is not in PYTH_FEEDS or SWITCHBOARD_FEEDS (it's a stablecoin)
      expect(result).to.be.null;
    });

    it("prefers Pyth over Switchboard for known tokens", () => {
      // All PYTH_FEEDS entries should resolve to "pyth"
      for (const [mintStr, feed] of Object.entries(PYTH_FEEDS)) {
        const mint = new PublicKey(mintStr);
        const result = resolveOracleFeed(mint);
        expect(result).to.not.be.null;
        expect(result!.source).to.equal("pyth");
        expect(result!.feed.equals(feed)).to.be.true;
      }
    });

    it("falls back to Switchboard for Pyth-uncovered tokens", () => {
      // All SWITCHBOARD_FEEDS entries should resolve to "switchboard"
      for (const [mintStr, feed] of Object.entries(SWITCHBOARD_FEEDS)) {
        const mint = new PublicKey(mintStr);
        const result = resolveOracleFeed(mint);
        expect(result).to.not.be.null;
        expect(result!.source).to.equal("switchboard");
        expect(result!.feed.equals(feed)).to.be.true;
      }
    });
  });
});
