import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { squadsCreateMultisig } from "../../src/tools/squads-create-multisig";
import { createMockClient, createMockConfig } from "../helpers/mock-client";

describe("shield_squads_create_multisig", () => {
  let mockConfig: ReturnType<typeof createMockConfig>;

  beforeEach(() => {
    mockConfig = createMockConfig();
  });

  afterEach(() => {
    mockConfig.cleanup();
  });

  const member1 = Keypair.generate().publicKey.toBase58();
  const member2 = Keypair.generate().publicKey.toBase58();

  const validInput = {
    members: [
      {
        key: member1,
        permissions: { initiate: true, vote: true, execute: true },
      },
      {
        key: member2,
        permissions: { initiate: false, vote: true, execute: false },
      },
    ],
    threshold: 2,
    timeLock: 0,
  };

  it("creates multisig successfully", async () => {
    const client = createMockClient();
    const result = await squadsCreateMultisig(
      client as any,
      mockConfig as any,
      validInput,
    );
    expect(result).to.include("Squads Multisig Created");
    expect(result).to.include("Threshold");
    expect(result).to.include("2-of-2");
  });

  it("calls squadsCreateMultisig on client", async () => {
    const client = createMockClient();
    await squadsCreateMultisig(client as any, mockConfig as any, validInput);
    const call = client.calls.find((c) => c.method === "squadsCreateMultisig");
    expect(call).to.exist;
    const params = call!.args[0];
    expect(params.members).to.have.length(2);
    expect(params.threshold).to.equal(2);
  });

  it("rejects threshold > member count", async () => {
    const client = createMockClient();
    const result = await squadsCreateMultisig(
      client as any,
      mockConfig as any,
      {
        ...validInput,
        threshold: 5,
      },
    );
    expect(result).to.include("Threshold");
    expect(result).to.include("cannot exceed");
  });

  it("returns error on SDK failure", async () => {
    const client = createMockClient({
      shouldThrow: new Error("Account already exists"),
    });
    const result = await squadsCreateMultisig(
      client as any,
      mockConfig as any,
      validInput,
    );
    expect(result).to.include("Account already exists");
  });

  it("passes optional timeLock and memo", async () => {
    const client = createMockClient();
    await squadsCreateMultisig(client as any, mockConfig as any, {
      ...validInput,
      timeLock: 3600,
      memo: "Test multisig",
    });
    const call = client.calls.find((c) => c.method === "squadsCreateMultisig");
    expect(call!.args[0].timeLock).to.equal(3600);
  });
});
