import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { cancelLimitOrder } from "../../src/tools/cancel-limit-order";
import {
  createMockClient,
  TEST_VAULT_PDA,
  TEST_MINT,
} from "../helpers/mock-client";
import type { McpConfig } from "../../src/config";

describe("shield_cancel_limit_order", () => {
  let tmpDir: string;
  let agentKeypairPath: string;
  let config: McpConfig;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-cancel-limit-test-"));
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

  it("cancels limit order successfully", async () => {
    const client = createMockClient();
    const result = await cancelLimitOrder(client as any, config, {
      vault: TEST_VAULT_PDA.toBase58(),
      market: "SOL",
      collateralMint: TEST_MINT.toBase58(),
      reserveSymbol: "USDC",
      receiveSymbol: "SOL",
      side: "long",
      orderId: "99",
    });
    expect(result).to.include("Limit Order Cancelled");
    expect(result).to.include("mock-sig-flash");
  });

  it("calls flashTradeCancelLimitOrder", async () => {
    const client = createMockClient();
    await cancelLimitOrder(client as any, config, {
      vault: TEST_VAULT_PDA.toBase58(),
      market: "SOL",
      collateralMint: TEST_MINT.toBase58(),
      reserveSymbol: "USDC",
      receiveSymbol: "SOL",
      side: "long",
      orderId: "99",
    });
    expect(client.calls.some((c) => c.method === "flashTradeCancelLimitOrder"))
      .to.be.true;
  });
});
