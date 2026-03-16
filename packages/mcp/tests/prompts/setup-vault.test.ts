import { expect } from "chai";
import { setupVaultPrompt } from "../../src/prompts/setup-vault";

describe("prompt: setup-vault", () => {
  it("returns structured workflow with 6 steps", () => {
    const result = setupVaultPrompt({ network: "devnet" });

    expect(result.messages).to.be.an("array").with.lengthOf(1);
    expect(result.messages[0].role).to.equal("user");

    const content = JSON.parse(result.messages[0].content.text);
    expect(content.workflow).to.equal("setup-vault");
    expect(content.steps).to.be.an("array").with.lengthOf(6);
  });

  it("each step has tool, input, and purpose", () => {
    const result = setupVaultPrompt({});
    const content = JSON.parse(result.messages[0].content.text);

    for (const step of content.steps) {
      expect(step).to.have.property("tool");
      expect(step).to.have.property("input");
      expect(step).to.have.property("purpose");
      expect(step.tool).to.match(/^phalnx_/);
    }
  });

  it("defaults to devnet network", () => {
    const result = setupVaultPrompt({});
    const content = JSON.parse(result.messages[0].content.text);
    expect(content.network).to.equal("devnet");
  });

  it("passes mainnet-beta when specified", () => {
    const result = setupVaultPrompt({ network: "mainnet-beta" });
    const content = JSON.parse(result.messages[0].content.text);
    expect(content.network).to.equal("mainnet-beta");
  });

  it("includes completion criteria", () => {
    const result = setupVaultPrompt({});
    const content = JSON.parse(result.messages[0].content.text);
    expect(content.completionCriteria).to.deep.equal({
      vaultActive: true,
      agentRegistered: true,
      permissionsVerified: true,
    });
  });

  it("uses phalnx_advise in final step", () => {
    const result = setupVaultPrompt({});
    const content = JSON.parse(result.messages[0].content.text);
    const lastStep = content.steps[content.steps.length - 1];
    expect(lastStep.tool).to.equal("phalnx_advise");
    expect(lastStep.input.question).to.equal("whatCanIDo");
  });
});
