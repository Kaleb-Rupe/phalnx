import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { placeLimitOrder } from "../../src/tools/place-limit-order";
import {
  createMockClient,
  TEST_VAULT_PDA,
  TEST_MINT,
} from "../helpers/mock-client";
import type { McpConfig } from "../../src/config";

describe("shield_place_limit_order", () => {
  let tmpDir: string;
  let agentKeypairPath: string;
  let config: McpConfig;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-limit-test-"));
    const kp = Keypair.generate();
    agentKeypairPath = path.join(tmpDir, "agent.json");
    fs.writeFileSync(
      agentKeypairPath,
      JSON.stringify(Array.from(kp.secretKey)),
    );
    config = {
      walletPath: agentKeypairPath,
      rpcUrl: "http://localhost:8899",
      agentKeypairPath,
    };
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("places limit order successfully", async () => {
    const client = createMockClient();
    const result = await placeLimitOrder(client as any, config, {
      vault: TEST_VAULT_PDA.toBase58(),
      market: "SOL",
      collateralSymbol: "USDC",
      reserveSymbol: "USDC",
      receiveSymbol: "SOL",
      side: "long",
      limitPrice: "50000000000",
      reserveAmount: "1000000000",
      sizeAmount: "5000000000",
      leverageBps: 20000,
    });
    expect(result).to.include("Limit Order Placed");
    expect(result).to.include("mock-sig-flash");
  });

  it("calls flashTradePlaceLimitOrder", async () => {
    const client = createMockClient();
    await placeLimitOrder(client as any, config, {
      vault: TEST_VAULT_PDA.toBase58(),
      market: "SOL",
      collateralSymbol: "USDC",
      reserveSymbol: "USDC",
      receiveSymbol: "SOL",
      side: "long",
      limitPrice: "50000000000",
      reserveAmount: "1000000000",
      sizeAmount: "5000000000",
      leverageBps: 20000,
    });
    expect(client.calls.some((c) => c.method === "flashTradePlaceLimitOrder"))
      .to.be.true;
  });

  it("returns error on failure", async () => {
    const client = createMockClient({
      shouldThrow: Object.assign(new Error("test"), { code: 6007 }),
    });
    const result = await placeLimitOrder(client as any, config, {
      vault: TEST_VAULT_PDA.toBase58(),
      market: "SOL",
      collateralSymbol: "USDC",
      reserveSymbol: "USDC",
      receiveSymbol: "SOL",
      side: "long",
      limitPrice: "50000000000",
      reserveAmount: "1000000000",
      sizeAmount: "5000000000",
      leverageBps: 200000,
    });
    expect(result).to.include("LeverageTooHigh");
  });
});
