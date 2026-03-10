import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { resolveToken, toBaseUnits, fromBaseUnits } from "../src/tokens";
import {
  USDC_MINT_DEVNET,
  USDC_MINT_MAINNET,
  USDT_MINT_DEVNET,
  USDT_MINT_MAINNET,
} from "../src/types";

describe("tokens", () => {
  describe("resolveToken", () => {
    it("resolves USDC on devnet", () => {
      const result = resolveToken("USDC", "devnet");
      expect(result).to.not.be.null;
      expect(result!.mint.toBase58()).to.equal(USDC_MINT_DEVNET.toBase58());
      expect(result!.decimals).to.equal(6);
      expect(result!.symbol).to.equal("USDC");
    });

    it("resolves USDC on mainnet-beta", () => {
      const result = resolveToken("USDC", "mainnet-beta");
      expect(result).to.not.be.null;
      expect(result!.mint.toBase58()).to.equal(USDC_MINT_MAINNET.toBase58());
      expect(result!.decimals).to.equal(6);
    });

    it("resolves USDT on devnet", () => {
      const result = resolveToken("USDT", "devnet");
      expect(result).to.not.be.null;
      expect(result!.mint.toBase58()).to.equal(USDT_MINT_DEVNET.toBase58());
      expect(result!.decimals).to.equal(6);
    });

    it("resolves USDT on mainnet-beta", () => {
      const result = resolveToken("USDT", "mainnet-beta");
      expect(result).to.not.be.null;
      expect(result!.mint.toBase58()).to.equal(USDT_MINT_MAINNET.toBase58());
    });

    it("resolves SOL", () => {
      const result = resolveToken("SOL");
      expect(result).to.not.be.null;
      expect(result!.mint.toBase58()).to.equal(
        "So11111111111111111111111111111111111111112",
      );
      expect(result!.decimals).to.equal(9);
      expect(result!.symbol).to.equal("SOL");
    });

    it("resolves WSOL as SOL mint", () => {
      const result = resolveToken("WSOL");
      expect(result).to.not.be.null;
      expect(result!.mint.toBase58()).to.equal(
        "So11111111111111111111111111111111111111112",
      );
      expect(result!.decimals).to.equal(9);
    });

    it("resolves JUP", () => {
      const result = resolveToken("JUP");
      expect(result).to.not.be.null;
      expect(result!.decimals).to.equal(6);
      expect(result!.symbol).to.equal("JUP");
    });

    it("resolves BONK", () => {
      const result = resolveToken("BONK");
      expect(result).to.not.be.null;
      expect(result!.decimals).to.equal(5);
    });

    it("is case-insensitive", () => {
      const r1 = resolveToken("usdc");
      const r2 = resolveToken("Usdc");
      const r3 = resolveToken("USDC");
      expect(r1).to.not.be.null;
      expect(r2).to.not.be.null;
      expect(r3).to.not.be.null;
      expect(r1!.mint.toBase58()).to.equal(r3!.mint.toBase58());
      expect(r2!.mint.toBase58()).to.equal(r3!.mint.toBase58());
    });

    it("resolves valid base58 mint address", () => {
      const mintAddr = USDC_MINT_MAINNET.toBase58();
      const result = resolveToken(mintAddr);
      expect(result).to.not.be.null;
      expect(result!.mint.toBase58()).to.equal(mintAddr);
    });

    it("returns null for unknown symbol", () => {
      const result = resolveToken("DOESNOTEXIST");
      expect(result).to.be.null;
    });

    it("returns null for invalid base58", () => {
      const result = resolveToken("not-a-valid-key!!!");
      expect(result).to.be.null;
    });

    it("defaults to mainnet-beta", () => {
      const result = resolveToken("USDC");
      expect(result).to.not.be.null;
      expect(result!.mint.toBase58()).to.equal(USDC_MINT_MAINNET.toBase58());
    });
  });

  describe("toBaseUnits", () => {
    it("converts 100 with 6 decimals", () => {
      const result = toBaseUnits(100, 6);
      expect(result.toNumber()).to.equal(100_000_000);
    });

    it("converts 1 SOL with 9 decimals", () => {
      const result = toBaseUnits(1, 9);
      expect(result.toNumber()).to.equal(1_000_000_000);
    });

    it("converts string amount", () => {
      const result = toBaseUnits("50.5", 6);
      expect(result.toNumber()).to.equal(50_500_000);
    });

    it("handles 0", () => {
      const result = toBaseUnits(0, 6);
      expect(result.toNumber()).to.equal(0);
    });

    it("handles small amounts", () => {
      const result = toBaseUnits(0.000001, 6);
      expect(result.toNumber()).to.equal(1);
    });

    it("rejects NaN", () => {
      expect(() => toBaseUnits(NaN, 6)).to.throw("Invalid amount");
    });

    it("rejects Infinity", () => {
      expect(() => toBaseUnits(Infinity, 6)).to.throw("Invalid amount");
    });

    it("rejects negative values", () => {
      expect(() => toBaseUnits(-100, 6)).to.throw("Invalid amount");
    });

    it("rejects string NaN", () => {
      expect(() => toBaseUnits("NaN", 6)).to.throw("Invalid amount");
    });

    it("rejects negative string", () => {
      expect(() => toBaseUnits("-50", 6)).to.throw("Invalid amount");
    });
  });

  describe("fromBaseUnits", () => {
    it("converts 100_000_000 with 6 decimals to 100", () => {
      const result = fromBaseUnits(new BN(100_000_000), 6);
      expect(result).to.equal(100);
    });

    it("converts 1_000_000_000 with 9 decimals to 1", () => {
      const result = fromBaseUnits(new BN(1_000_000_000), 9);
      expect(result).to.equal(1);
    });

    it("handles 0", () => {
      const result = fromBaseUnits(new BN(0), 6);
      expect(result).to.equal(0);
    });
  });
});
