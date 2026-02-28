import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { removeCollateral } from "../../src/tools/remove-collateral";
import { createMockClient, TEST_VAULT_PDA } from "../helpers/mock-client";
import type { McpConfig } from "../../src/config";

describe("shield_remove_collateral", () => {
  let tmpDir: string;
  let agentKeypairPath: string;
  let config: McpConfig;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-rmcol-test-"));
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

  it("removes collateral successfully", async () => {
    const client = createMockClient();
    const result = await removeCollateral(client as any, config, {
      vault: TEST_VAULT_PDA.toBase58(),
      market: "SOL",
      collateralDeltaUsd: "500000000",
      side: "long",
      positionPubKey: Keypair.generate().publicKey.toBase58(),
    });
    expect(result).to.include("Collateral Removed");
    expect(result).to.include("mock-sig-flash");
  });

  it("calls flashTradeRemoveCollateral", async () => {
    const client = createMockClient();
    await removeCollateral(client as any, config, {
      vault: TEST_VAULT_PDA.toBase58(),
      market: "SOL",
      collateralDeltaUsd: "500000000",
      side: "long",
      positionPubKey: Keypair.generate().publicKey.toBase58(),
    });
    expect(client.calls.some((c) => c.method === "flashTradeRemoveCollateral"))
      .to.be.true;
  });
});
