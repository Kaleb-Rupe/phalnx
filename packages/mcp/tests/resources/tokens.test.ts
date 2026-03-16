import { expect } from "chai";
import { getTokensResource } from "../../src/resources/tokens";

describe("resource: shield://tokens/{query}", () => {
  it("returns well-formed JSON with query and tokens fields", async () => {
    // Uses real Jupiter API — returns actual results or catches network error
    const json = await getTokensResource("SOL");
    const data = JSON.parse(json);

    expect(data).to.have.property("query", "SOL");
    expect(data).to.have.property("resultCount");
    expect(data).to.have.property("tokens");
    expect(data.tokens).to.be.an("array");
  });

  it("returns valid JSON even on empty query", async () => {
    const json = await getTokensResource("");
    expect(() => JSON.parse(json)).not.to.throw();
    const data = JSON.parse(json);
    expect(data).to.have.property("query", "");
  });

  it("tokens have expected shape when results exist", async () => {
    const json = await getTokensResource("USDC");
    const data = JSON.parse(json);

    if (data.resultCount > 0) {
      const token = data.tokens[0];
      expect(token).to.have.property("address");
      expect(token).to.have.property("symbol");
      expect(token).to.have.property("name");
      expect(token).to.have.property("decimals");
    }
  });

  it("never returns more than 10 results", async () => {
    const json = await getTokensResource("a");
    const data = JSON.parse(json);
    expect(data.tokens.length).to.be.at.most(10);
  });
});
