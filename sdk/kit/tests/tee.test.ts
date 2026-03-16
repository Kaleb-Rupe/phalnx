import { expect } from "chai";
import type { Address } from "@solana/kit";
import { isTeeWallet, VALID_TEE_PROVIDERS } from "../src/tee/wallet-types.js";
import type { WalletLike, TeeWallet } from "../src/tee/wallet-types.js";

const MOCK_ADDRESS = "11111111111111111111111111111111" as Address;

function mockWallet(publicKey: Address = MOCK_ADDRESS): WalletLike {
  return { publicKey };
}

function mockTeeWallet(
  provider: string,
  publicKey: Address = MOCK_ADDRESS,
): TeeWallet {
  return { publicKey, provider };
}

describe("M-13: TEE provider validation", () => {
  it("crossmint is valid", () => {
    expect(isTeeWallet(mockTeeWallet("crossmint"))).to.be.true;
  });

  it("privy is valid", () => {
    expect(isTeeWallet(mockTeeWallet("privy"))).to.be.true;
  });

  it("turnkey is valid", () => {
    expect(isTeeWallet(mockTeeWallet("turnkey"))).to.be.true;
  });

  it("empty string is invalid", () => {
    expect(isTeeWallet(mockTeeWallet(""))).to.be.false;
  });

  it('arbitrary string "unknown" is invalid', () => {
    expect(isTeeWallet(mockTeeWallet("unknown"))).to.be.false;
  });

  it("numeric provider is invalid", () => {
    const wallet = { publicKey: MOCK_ADDRESS, provider: 123 } as any;
    expect(isTeeWallet(wallet)).to.be.false;
  });

  it("wallet without provider field is invalid", () => {
    expect(isTeeWallet(mockWallet())).to.be.false;
  });

  it("VALID_TEE_PROVIDERS has exactly 3 entries", () => {
    expect(VALID_TEE_PROVIDERS.size).to.equal(3);
  });
});
