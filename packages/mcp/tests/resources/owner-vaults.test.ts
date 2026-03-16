import { expect } from "chai";
import { getOwnerVaultsResource } from "../../src/resources/owner-vaults";
import { createMockClient, TEST_OWNER } from "../helpers/mock-client";

describe("resource: shield://owner/{address}/vaults", () => {
  it("returns vaults for an owner", async () => {
    const client = createMockClient();
    const json = await getOwnerVaultsResource(
      client as any,
      TEST_OWNER.publicKey.toBase58(),
    );
    const data = JSON.parse(json);

    expect(data.owner).to.equal(TEST_OWNER.publicKey.toBase58());
    expect(data.vaultCount).to.be.a("number");
    expect(data.vaults).to.be.an("array");
  });

  it("returns empty list when all vault fetches fail", async () => {
    const client = createMockClient({
      shouldThrow: new Error("Network error"),
    });
    const json = await getOwnerVaultsResource(
      client as any,
      TEST_OWNER.publicKey.toBase58(),
    );
    const data = JSON.parse(json);

    // Each individual vault fetch fails silently (inner catch),
    // but the resource still returns a valid response
    expect(data.vaultCount).to.equal(0);
    expect(data.vaults).to.deep.equal([]);
  });

  it("returns well-formed JSON", async () => {
    const client = createMockClient();
    const json = await getOwnerVaultsResource(
      client as any,
      TEST_OWNER.publicKey.toBase58(),
    );
    expect(() => JSON.parse(json)).not.to.throw();
  });
});
