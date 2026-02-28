import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { jupiterPortfolio } from "../../src/tools/jupiter-portfolio";
import { createMockClient } from "../helpers/mock-client";

describe("shield_jupiter_portfolio", () => {
  const wallet = Keypair.generate().publicKey.toBase58();

  it("returns formatted portfolio with positions", async () => {
    const client = createMockClient();
    const result = await jupiterPortfolio(client as any, { wallet });
    expect(result).to.include("Jupiter Portfolio");
    expect(result).to.include(wallet);
    expect(result).to.include("Total Value");
    expect(result).to.include("12,500.5");
    expect(result).to.include("Jupiter Lend");
    expect(result).to.include("USDC");
    expect(result).to.include("5,000");
  });

  it("passes wallet to client method", async () => {
    const client = createMockClient();
    await jupiterPortfolio(client as any, { wallet });
    const call = client.calls.find((c) => c.method === "getJupiterPortfolio");
    expect(call).to.exist;
    expect(call!.args[0]).to.equal(wallet);
  });

  it("handles portfolio with no positions", async () => {
    const client = createMockClient();
    // Override to return empty positions
    client.getJupiterPortfolio = async (w: string) => ({
      wallet: w,
      totalValue: 0,
      positions: [],
    });
    const result = await jupiterPortfolio(client as any, { wallet });
    expect(result).to.include("No positions found");
    expect(result).to.include("Total Value");
  });

  it("displays multiple positions correctly", async () => {
    const client = createMockClient();
    client.getJupiterPortfolio = async (w: string) => ({
      wallet: w,
      totalValue: 25000,
      positions: [
        {
          platform: "jupiter-lend",
          platformName: "Jupiter Lend",
          elementType: "borrowlend",
          value: 10000,
          tokens: [
            { mint: "USDC-mint", symbol: "USDC", amount: 10000, value: 10000 },
          ],
        },
        {
          platform: "jupiter-perps",
          platformName: "Jupiter Perps",
          elementType: "leverage",
          value: 15000,
          tokens: [
            { mint: "SOL-mint", symbol: "SOL", amount: 100, value: 15000 },
          ],
        },
      ],
    });
    const result = await jupiterPortfolio(client as any, { wallet });
    expect(result).to.include("Jupiter Lend");
    expect(result).to.include("Jupiter Perps");
    expect(result).to.include("25,000");
  });

  it("returns error on SDK failure", async () => {
    const client = createMockClient({
      shouldThrow: new Error("wallet not found"),
    });
    const result = await jupiterPortfolio(client as any, { wallet });
    expect(result).to.include("wallet not found");
  });
});
