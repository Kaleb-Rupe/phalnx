import { expect } from "chai";
import type { PhalnxClient } from "@phalnx/sdk";
import type { McpConfig } from "../../src/config";
import {
  phalnxQuery,
  type PhalnxQueryInput,
} from "../../src/tools-v2/phalnx-query";
import {
  createMockClient,
  TEST_VAULT_PDA,
  TEST_OWNER,
  TEST_PROTOCOL,
  makeVaultAccount,
  makePolicyAccount,
  makeTrackerAccount,
} from "../helpers/mock-client";

function makeMockClientWithIntents(
  overrides: Parameters<typeof createMockClient>[0] = {},
) {
  const base = createMockClient(overrides);
  return {
    ...base,
    intents: {
      listProtocols: () => [
        {
          protocolId: "jupiter",
          displayName: "Jupiter",
          programIds: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
          actionCount: 3,
        },
      ],
      listActions: (id: string) =>
        id === "jupiter" ? [{ name: "swap", isSpending: true }] : [],
    },
  };
}

const mockConfig = { rpcUrl: "https://mock.rpc" } as McpConfig;

describe("phalnx_query", () => {
  it("vault query returns JSON with owner, agents, and status", async () => {
    const client = makeMockClientWithIntents();
    const result = await phalnxQuery(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        query: "vault",
        params: { vault: TEST_VAULT_PDA.toBase58() },
      },
    );
    const parsed = JSON.parse(result);
    expect(parsed).to.have.property("owner");
    expect(parsed.owner).to.equal(TEST_OWNER.publicKey.toBase58());
    expect(parsed).to.have.property("agents");
    expect(parsed.agents).to.be.an("array").with.length.greaterThan(0);
    expect(parsed).to.have.property("status");
    expect(parsed).to.have.property("totalTransactions");
    expect(parsed).to.have.property("openPositions");
  });

  it("vault query without vault returns 'No vault specified'", async () => {
    const client = makeMockClientWithIntents();
    const result = await phalnxQuery(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        query: "vault",
        params: {},
      },
    );
    expect(result).to.equal("No vault specified");
  });

  it("policy query returns JSON with dailySpendingCapUsd and protocolMode", async () => {
    const client = makeMockClientWithIntents();
    const result = await phalnxQuery(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        query: "policy",
        params: { vault: TEST_VAULT_PDA.toBase58() },
      },
    );
    const parsed = JSON.parse(result);
    expect(parsed).to.have.property("dailySpendingCapUsd");
    expect(parsed).to.have.property("protocolMode");
    expect(parsed.protocolMode).to.equal(1);
    expect(parsed).to.have.property("protocols");
    expect(parsed.protocols).to.be.an("array");
    expect(parsed).to.have.property("maxSlippageBps");
    expect(parsed).to.have.property("canOpenPositions");
    expect(parsed).to.have.property("hasConstraints");
  });

  it("protocols query returns JSON array from intents.listProtocols()", async () => {
    const client = makeMockClientWithIntents();
    const result = await phalnxQuery(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        query: "protocols",
      },
    );
    const parsed = JSON.parse(result);
    expect(parsed).to.be.an("array");
    expect(parsed).to.have.length(1);
    expect(parsed[0]).to.have.property("protocolId", "jupiter");
    expect(parsed[0]).to.have.property("displayName", "Jupiter");
    expect(parsed[0]).to.have.property("actionCount", 3);
  });

  it("actions query without protocolId returns error message", async () => {
    const client = makeMockClientWithIntents();
    const result = await phalnxQuery(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        query: "actions",
        params: {},
      },
    );
    expect(result).to.equal("protocolId parameter required");
  });

  it("actions query with protocolId returns action list", async () => {
    const client = makeMockClientWithIntents();
    const result = await phalnxQuery(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        query: "actions",
        params: { protocolId: "jupiter" },
      },
    );
    const parsed = JSON.parse(result);
    expect(parsed).to.be.an("array");
    expect(parsed).to.have.length(1);
    expect(parsed[0]).to.have.property("name", "swap");
    expect(parsed[0]).to.have.property("isSpending", true);
  });

  it("pendingPolicy query returns exists:false when no pending policy", async () => {
    const client = makeMockClientWithIntents({ pendingPolicy: null });
    const result = await phalnxQuery(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        query: "pendingPolicy",
        params: { vault: TEST_VAULT_PDA.toBase58() },
      },
    );
    const parsed = JSON.parse(result);
    expect(parsed).to.have.property("exists", false);
  });

  it("constraints query returns exists:false when mock throws", async () => {
    // The mock client's fetchConstraints returns null, which means no constraints
    const client = makeMockClientWithIntents();
    const result = await phalnxQuery(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        query: "constraints",
        params: { vault: TEST_VAULT_PDA.toBase58() },
      },
    );
    const parsed = JSON.parse(result);
    expect(parsed).to.have.property("exists", false);
  });

  it("squadsStatus query without multisig returns error message", async () => {
    const client = makeMockClientWithIntents();
    const result = await phalnxQuery(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        query: "squadsStatus",
        params: {},
      },
    );
    expect(result).to.equal("multisig parameter required");
  });

  it("searchTokens without query returns error message", async () => {
    const client = makeMockClientWithIntents();
    const result = await phalnxQuery(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        query: "searchTokens",
        params: {},
      },
    );
    expect(result).to.equal("query parameter required");
  });

  it("prices without mints returns error message", async () => {
    const client = makeMockClientWithIntents();
    const result = await phalnxQuery(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        query: "prices",
        params: {},
      },
    );
    expect(result).to.include("mints parameter required");
  });

  it("error from fetchVault caught and formatted", async () => {
    const client = makeMockClientWithIntents({
      shouldThrow: new Error("Account does not exist"),
    });
    const result = await phalnxQuery(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        query: "vault",
        params: { vault: TEST_VAULT_PDA.toBase58() },
      },
    );
    expect(result).to.include("Account not found");
  });

  it("spending query returns JSON with spent24hUsd", async () => {
    const client = makeMockClientWithIntents();
    const result = await phalnxQuery(
      client as unknown as PhalnxClient,
      mockConfig,
      {
        query: "spending",
        params: { vault: TEST_VAULT_PDA.toBase58() },
      },
    );
    const parsed = JSON.parse(result);
    expect(parsed).to.have.property("spent24hUsd");
    expect(parsed).to.have.property("totalBuckets");
  });
});
