import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { squadsReject } from "../../src/tools/squads-reject";
import { createMockClient, createMockConfig } from "../helpers/mock-client";

describe("shield_squads_reject", () => {
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
    transactionIndex: "3",
  };

  it("rejects proposal successfully", async () => {
    const client = createMockClient();
    const result = await squadsReject(
      client as any,
      mockConfig as any,
      validInput,
    );
    expect(result).to.include("Proposal Rejected");
    expect(result).to.include(multisig);
    expect(result).to.include("mock-sig-squads-reject");
  });

  it("calls squadsRejectProposal on client", async () => {
    const client = createMockClient();
    await squadsReject(client as any, mockConfig as any, validInput);
    const call = client.calls.find((c) => c.method === "squadsRejectProposal");
    expect(call).to.exist;
    const params = call!.args[0];
    expect(params.multisigPda.toBase58()).to.equal(multisig);
    expect(params.transactionIndex).to.equal(3n);
  });

  it("returns error on invalid multisig address", async () => {
    const client = createMockClient();
    const result = await squadsReject(client as any, mockConfig as any, {
      ...validInput,
      multisig: "not-a-key",
    });
    expect(result).to.include("Invalid public key");
  });

  it("returns error on SDK failure", async () => {
    const client = createMockClient({
      shouldThrow: new Error("Proposal not active"),
    });
    const result = await squadsReject(
      client as any,
      mockConfig as any,
      validInput,
    );
    expect(result).to.include("Proposal not active");
  });
});
