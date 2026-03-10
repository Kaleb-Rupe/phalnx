import { expect } from "chai";
import { freezeVault } from "../../src/tools/freeze-vault";
import { createMockClient, TEST_VAULT_PDA } from "../helpers/mock-client";

describe("shield_freeze_vault", () => {
  it("freezes vault successfully", async () => {
    const client = createMockClient();
    const result = await freezeVault(client as any, {
      vault: TEST_VAULT_PDA.toBase58(),
    });
    expect(result).to.include("Vault Frozen");
    expect(result).to.include("mock-sig-freeze");
  });

  it("calls SDK freezeVault with correct vault", async () => {
    const client = createMockClient();
    await freezeVault(client as any, {
      vault: TEST_VAULT_PDA.toBase58(),
    });
    const call = client.calls.find((c) => c.method === "freezeVault");
    expect(call).to.exist;
    expect(call!.args[0].toBase58()).to.equal(TEST_VAULT_PDA.toBase58());
  });

  it("returns error for invalid vault address", async () => {
    const client = createMockClient();
    const result = await freezeVault(client as any, { vault: "bad" });
    expect(result).to.include("Invalid public key");
  });

  it("returns error when vault is not active", async () => {
    const client = createMockClient({
      shouldThrow: Object.assign(new Error("test"), { code: 6000 }),
    });
    const result = await freezeVault(client as any, {
      vault: TEST_VAULT_PDA.toBase58(),
    });
    expect(result).to.include("VaultNotActive");
  });
});
