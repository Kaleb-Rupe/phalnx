import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { placeTriggerOrder } from "../../src/tools/place-trigger-order";
import {
  createMockClient,
  TEST_VAULT_PDA,
  TEST_MINT,
} from "../helpers/mock-client";
import type { McpConfig } from "../../src/config";

describe("shield_place_trigger_order", () => {
  let tmpDir: string;
  let agentKeypairPath: string;
  let config: McpConfig;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-trigger-test-"));
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

  it("places stop-loss order successfully", async () => {
    const client = createMockClient();
    const result = await placeTriggerOrder(client as any, config, {
      vault: TEST_VAULT_PDA.toBase58(),
      market: "SOL",
      collateralMint: TEST_MINT.toBase58(),
      receiveSymbol: "USDC",
      side: "long",
      triggerPrice: "50000000000",
      deltaSizeAmount: "1000000000",
      isStopLoss: true,
    });
    expect(result).to.include("Stop-Loss Order Placed");
    expect(result).to.include("mock-sig-flash");
  });

  it("places take-profit order successfully", async () => {
    const client = createMockClient();
    const result = await placeTriggerOrder(client as any, config, {
      vault: TEST_VAULT_PDA.toBase58(),
      market: "SOL",
      collateralMint: TEST_MINT.toBase58(),
      receiveSymbol: "USDC",
      side: "long",
      triggerPrice: "80000000000",
      deltaSizeAmount: "1000000000",
      isStopLoss: false,
    });
    expect(result).to.include("Take-Profit Order Placed");
  });

  it("calls flashTradePlaceTriggerOrder", async () => {
    const client = createMockClient();
    await placeTriggerOrder(client as any, config, {
      vault: TEST_VAULT_PDA.toBase58(),
      market: "SOL",
      collateralMint: TEST_MINT.toBase58(),
      receiveSymbol: "USDC",
      side: "long",
      triggerPrice: "50000000000",
      deltaSizeAmount: "1000000000",
      isStopLoss: true,
    });
    expect(client.calls.some((c) => c.method === "flashTradePlaceTriggerOrder"))
      .to.be.true;
  });
});
