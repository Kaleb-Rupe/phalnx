import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { cancelTriggerOrder } from "../../src/tools/cancel-trigger-order";
import {
  createMockClient,
  TEST_VAULT_PDA,
  TEST_MINT,
} from "../helpers/mock-client";
import type { McpConfig } from "../../src/config";

describe("shield_cancel_trigger_order", () => {
  let tmpDir: string;
  let agentKeypairPath: string;
  let config: McpConfig;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-cancel-trigger-test-"));
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

  it("cancels trigger order successfully", async () => {
    const client = createMockClient();
    const result = await cancelTriggerOrder(client as any, config, {
      vault: TEST_VAULT_PDA.toBase58(),
      market: "SOL",
      collateralMint: TEST_MINT.toBase58(),
      side: "long",
      orderId: "42",
      isStopLoss: true,
    });
    expect(result).to.include("Trigger Order Cancelled");
    expect(result).to.include("mock-sig-flash");
  });

  it("calls flashTradeCancelTriggerOrder", async () => {
    const client = createMockClient();
    await cancelTriggerOrder(client as any, config, {
      vault: TEST_VAULT_PDA.toBase58(),
      market: "SOL",
      collateralMint: TEST_MINT.toBase58(),
      side: "long",
      orderId: "42",
      isStopLoss: true,
    });
    expect(
      client.calls.some((c) => c.method === "flashTradeCancelTriggerOrder"),
    ).to.be.true;
  });
});
