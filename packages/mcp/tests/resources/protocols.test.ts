import { expect } from "chai";
import { getProtocolsResource } from "../../src/resources/protocols";

describe("resource: shield://protocols", () => {
  it("returns known protocols with programId and displayName", async () => {
    const json = await getProtocolsResource();
    const data = JSON.parse(json);

    expect(data.protocolCount).to.be.a("number");
    expect(data.protocolCount).to.be.greaterThan(0);
    expect(data.protocols).to.be.an("array");
    expect(data.protocols[0]).to.have.property("programId");
    expect(data.protocols[0]).to.have.property("displayName");
  });

  it("includes Jupiter in protocol list", async () => {
    const json = await getProtocolsResource();
    const data = JSON.parse(json);

    const jupiter = data.protocols.find(
      (p: any) => p.displayName.toLowerCase().includes("jupiter"),
    );
    expect(jupiter).to.not.be.undefined;
  });

  it("returns well-formed JSON", async () => {
    const json = await getProtocolsResource();
    expect(() => JSON.parse(json)).not.to.throw();
  });
});
