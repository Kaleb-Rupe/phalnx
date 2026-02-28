import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { squadsApprove } from "../../src/tools/squads-approve";
import { createMockClient, createMockConfig } from "../helpers/mock-client";

describe("shield_squads_approve", () => {
  let mockConfig: ReturnType<typeof createMockConfig>;

  beforeEach(() => {
    mockConfig = createMockConfig();
  });

  afterEach(() => {
    mockConfig.cleanup();
  });

  const multisig = Keypair.generate().publicKey.toBase58();

  const validInput = {
    multisig,
    transactionIndex: "1",
  };

  it("approves proposal successfully", async () => {
    const client = createMockClient();
    const result = await squadsApprove(
      client as any,
      mockConfig as any,
      validInput,
    );
    expect(result).to.include("Proposal Approved");
    expect(result).to.include(multisig);
    expect(result).to.include("mock-sig-squads-approve");
  });

  it("calls squadsApproveProposal on client", async () => {
    const client = createMockClient();
    await squadsApprove(client as any, mockConfig as any, validInput);
    const call = client.calls.find((c) => c.method === "squadsApproveProposal");
    expect(call).to.exist;
    const params = call!.args[0];
    expect(params.multisigPda.toBase58()).to.equal(multisig);
    expect(params.transactionIndex).to.equal(1n);
  });

  it("fetches proposal status after approval", async () => {
    const client = createMockClient();
    await squadsApprove(client as any, mockConfig as any, validInput);
    const statusCall = client.calls.find(
      (c) => c.method === "squadsFetchProposalInfo",
    );
    expect(statusCall).to.exist;
  });

  it("passes optional memo", async () => {
    const client = createMockClient();
    await squadsApprove(client as any, mockConfig as any, {
      ...validInput,
      memo: "LGTM",
    });
    const call = client.calls.find((c) => c.method === "squadsApproveProposal");
    expect(call!.args[0].memo).to.equal("LGTM");
  });

  it("returns error on SDK failure", async () => {
    const client = createMockClient({
      shouldThrow: new Error("Already voted"),
    });
    const result = await squadsApprove(
      client as any,
      mockConfig as any,
      validInput,
    );
    expect(result).to.include("Already voted");
  });
});
