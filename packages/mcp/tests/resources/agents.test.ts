import { expect } from "chai";
import { getAgentsResource } from "../../src/resources/agents";
import { createMockClient, TEST_VAULT_PDA, TEST_AGENT } from "../helpers/mock-client";

describe("resource: shield://vault/{address}/agents", () => {
  it("returns agent details with decoded permissions", async () => {
    const client = createMockClient();
    const json = await getAgentsResource(client as any, TEST_VAULT_PDA.toBase58());
    const data = JSON.parse(json);

    expect(data.agentCount).to.equal(1);
    expect(data.maxAgents).to.equal(10);
    expect(data.agents).to.be.an("array").with.lengthOf(1);
    expect(data.agents[0].pubkey).to.equal(TEST_AGENT.publicKey.toBase58());
    expect(data.agents[0].allowedActions).to.be.an("array");
    expect(data.agents[0].allowedActions).to.include("swap");
  });

  it("returns error for missing vault", async () => {
    const client = createMockClient({
      shouldThrow: new Error("Account does not exist"),
    });
    const json = await getAgentsResource(client as any, TEST_VAULT_PDA.toBase58());
    const data = JSON.parse(json);

    expect(data.error).to.be.a("string");
    expect(data.agentCount).to.equal(0);
    expect(data.agents).to.deep.equal([]);
  });

  it("returns well-formed JSON", async () => {
    const client = createMockClient();
    const json = await getAgentsResource(client as any, TEST_VAULT_PDA.toBase58());
    expect(() => JSON.parse(json)).not.to.throw();
  });
});
