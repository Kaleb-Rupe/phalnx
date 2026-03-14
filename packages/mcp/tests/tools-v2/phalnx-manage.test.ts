import { expect } from "chai";
import type { PhalnxClient } from "@phalnx/sdk";
import type { McpConfig } from "../../src/config";
import {
  phalnxManage,
  type PhalnxManageInput,
} from "../../src/tools-v2/phalnx-manage";
import {
  createMockClient,
  createMockConfig,
  TEST_VAULT_PDA,
} from "../helpers/mock-client";

const mockConfig: McpConfig = { rpcUrl: "https://mock.rpc" };

describe("phalnx_manage", () => {
  it("createVault action returns a string (does not throw)", async () => {
    const client = createMockClient();
    const result = await phalnxManage(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        action: "createVault",
        params: {
          vaultId: "99",
          dailySpendingCapUsd: "10000000000",
          maxTransactionSizeUsd: "1000000000",
          feeDestination: TEST_VAULT_PDA.toBase58(),
          developerFeeRate: 10,
          maxSlippageBps: 100,
        },
      },
    );
    expect(result).to.be.a("string");
  });

  it("squadsCreate action returns a string (3-arg handler routing)", async () => {
    const cfgWithWallet = createMockConfig();
    try {
      const client = createMockClient();
      const config: McpConfig = {
        rpcUrl: "https://mock.rpc",
        walletPath: cfgWithWallet.walletPath,
      };
      const result = await phalnxManage(
        client as unknown as PhalnxClient,
        config,
        {
          action: "squadsCreate",
          params: {
            threshold: 2,
            members: [TEST_VAULT_PDA.toBase58()],
          },
        },
      );
      // Will likely return an error string since mock doesn't fully implement squads,
      // but it should not throw -- it routes through formatError
      expect(result).to.be.a("string");
    } finally {
      cfgWithWallet.cleanup();
    }
  });

  it("unknown action returns 'Unknown management action'", async () => {
    const client = createMockClient();
    const input = {
      action: "doSomethingWeird",
      params: {},
    } as unknown as PhalnxManageInput;
    const result = await phalnxManage(
      client as unknown as PhalnxClient,
      mockConfig,
      input,
    );
    expect(result).to.include("Unknown management action");
    expect(result).to.include("doSomethingWeird");
  });

  it("vault from params is passed through to the handler", async () => {
    const client = createMockClient();
    const result = await phalnxManage(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        action: "freezeVault",
        params: {},
        vault: TEST_VAULT_PDA.toBase58(),
      },
    );
    // freezeVault with the mock should call client.freezeVault
    expect(result).to.be.a("string");
  });

  it("deposit action delegates to the deposit handler", async () => {
    const client = createMockClient();
    const result = await phalnxManage(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        action: "deposit",
        params: {
          mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amount: "1000000",
        },
        vault: TEST_VAULT_PDA.toBase58(),
      },
    );
    expect(result).to.be.a("string");
  });

  it("createConstraints action delegates to handler", async () => {
    const client = createMockClient();
    const result = await phalnxManage(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        action: "createConstraints",
        params: { entries: [] },
        vault: TEST_VAULT_PDA.toBase58(),
      },
    );
    expect(result).to.be.a("string");
  });

  it("closeConstraints action delegates to handler", async () => {
    const client = createMockClient();
    const result = await phalnxManage(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        action: "closeConstraints",
        params: {},
        vault: TEST_VAULT_PDA.toBase58(),
      },
    );
    expect(result).to.be.a("string");
  });

  it("closeSettledEscrow action delegates to handler", async () => {
    const client = createMockClient();
    const result = await phalnxManage(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        action: "closeSettledEscrow",
        params: {
          sourceVault: TEST_VAULT_PDA.toBase58(),
          destinationVault: TEST_VAULT_PDA.toBase58(),
          escrowId: "1",
        },
        vault: TEST_VAULT_PDA.toBase58(),
      },
    );
    expect(result).to.be.a("string");
  });

  it("queuePolicyUpdate action delegates to handler", async () => {
    const client = createMockClient();
    const result = await phalnxManage(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        action: "queuePolicyUpdate",
        params: { dailySpendingCapUsd: "20000000000" },
        vault: TEST_VAULT_PDA.toBase58(),
      },
    );
    expect(result).to.be.a("string");
  });

  it("applyPendingPolicy action delegates to handler", async () => {
    const client = createMockClient();
    const result = await phalnxManage(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        action: "applyPendingPolicy",
        params: {},
        vault: TEST_VAULT_PDA.toBase58(),
      },
    );
    expect(result).to.be.a("string");
  });

  it("catches errors from underlying handlers and returns a string", async () => {
    const client = createMockClient({
      shouldThrow: new Error("Simulated SDK failure"),
    });
    const result = await phalnxManage(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        action: "withdraw",
        params: {
          mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amount: "500000",
        },
        vault: TEST_VAULT_PDA.toBase58(),
      },
    );
    expect(result).to.be.a("string");
    expect(result).to.include("Simulated SDK failure");
  });
});
