/**
 * Phase 9 Batch J — unit tests for CAIP-2 network identity + AL4 isMainnet.
 * (ISC-77, 78, 79, 80, 147).
 */

import { describe, it } from "mocha";
import { expect } from "chai";
import {
  CAIP2_SOLANA_DEVNET,
  CAIP2_SOLANA_MAINNET,
  CAIP2_SOLANA_TESTNET,
  deriveNetworkIdentity,
  isMainnetCaip2,
  toCaip2,
} from "../src/caip2-network.js";

describe("CAIP-2 — chain ids match the canonical registry", () => {
  it("mainnet chain id matches the published mainnet-beta CAIP-2 value", () => {
    expect(CAIP2_SOLANA_MAINNET).to.equal(
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    );
  });

  it("devnet chain id matches the published devnet CAIP-2 value", () => {
    expect(CAIP2_SOLANA_DEVNET).to.equal(
      "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    );
  });

  it("testnet chain id is exported even though SDK doesn't currently produce it", () => {
    expect(CAIP2_SOLANA_TESTNET).to.equal(
      "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
    );
  });
});

describe("toCaip2(network) — strict mapping", () => {
  it("maps 'mainnet' to the mainnet-beta CAIP-2 id", () => {
    expect(toCaip2("mainnet")).to.equal(CAIP2_SOLANA_MAINNET);
  });

  it("maps 'devnet' to the devnet CAIP-2 id", () => {
    expect(toCaip2("devnet")).to.equal(CAIP2_SOLANA_DEVNET);
  });

  it("throws on any other network value (catches JS / any-cast bypass)", () => {
    expect(() =>
      toCaip2("testnet" as unknown as "devnet"),
    ).to.throw(/network must be 'devnet' or 'mainnet'/);
    expect(() =>
      toCaip2("" as unknown as "devnet"),
    ).to.throw(/network must be 'devnet' or 'mainnet'/);
  });
});

describe("isMainnetCaip2(chain) — true only for canonical mainnet-beta", () => {
  it("returns true for the canonical mainnet-beta chain id", () => {
    expect(isMainnetCaip2(CAIP2_SOLANA_MAINNET)).to.equal(true);
  });

  it("returns false for devnet", () => {
    expect(isMainnetCaip2(CAIP2_SOLANA_DEVNET)).to.equal(false);
  });

  it("returns false for testnet", () => {
    expect(isMainnetCaip2(CAIP2_SOLANA_TESTNET)).to.equal(false);
  });

  it("returns false for empty string (defensive)", () => {
    expect(isMainnetCaip2("")).to.equal(false);
  });

  it("returns false for a near-miss prefix match (no fuzzy matching)", () => {
    expect(isMainnetCaip2("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpEXTRA")).to.equal(
      false,
    );
    expect(isMainnetCaip2("solana:")).to.equal(false);
    expect(isMainnetCaip2("ethereum:1")).to.equal(false);
  });
});

describe("deriveNetworkIdentity(network) — combined helper", () => {
  it("mainnet returns { CAIP-2 mainnet, isMainnet: true }", () => {
    const out = deriveNetworkIdentity("mainnet");
    expect(out.network).to.equal(CAIP2_SOLANA_MAINNET);
    expect(out.isMainnet).to.equal(true);
  });

  it("devnet returns { CAIP-2 devnet, isMainnet: false }", () => {
    const out = deriveNetworkIdentity("devnet");
    expect(out.network).to.equal(CAIP2_SOLANA_DEVNET);
    expect(out.isMainnet).to.equal(false);
  });

  it("invalid network throws via underlying toCaip2", () => {
    expect(() =>
      deriveNetworkIdentity("localnet" as unknown as "devnet"),
    ).to.throw();
  });
});

describe("AL3 ↔ AL4 binding — network discriminant survives round-trip", () => {
  it("network field on SealResult would be the CAIP-2 chain id (type-level check)", () => {
    // This test exists mostly as a documentation anchor — the actual
    // wiring is in seal.ts and tested via the seal() integration suite.
    // We verify here that deriveNetworkIdentity produces the expected
    // shape so consumers can rely on `SealResult.network` being CAIP-2.
    const m = deriveNetworkIdentity("mainnet");
    expect(m.network.startsWith("solana:")).to.equal(true);
    expect(m.network.length).to.be.greaterThan(10);
  });
});
