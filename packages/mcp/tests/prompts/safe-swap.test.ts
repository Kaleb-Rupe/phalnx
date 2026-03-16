import { expect } from "chai";
import { safeSwapPrompt } from "../../src/prompts/safe-swap";

describe("prompt: safe-swap", () => {
  it("returns structured workflow with 6 steps", () => {
    const result = safeSwapPrompt({
      inputToken: "USDC",
      outputToken: "SOL",
      amount: "1000000",
    });

    expect(result.messages).to.be.an("array").with.lengthOf(1);
    const content = JSON.parse(result.messages[0].content.text);
    expect(content.workflow).to.equal("safe-swap");
    expect(content.steps).to.be.an("array").with.lengthOf(6);
  });

  it("includes permission check as step 1", () => {
    const result = safeSwapPrompt({
      inputToken: "USDC",
      outputToken: "SOL",
      amount: "1000000",
    });
    const content = JSON.parse(result.messages[0].content.text);
    expect(content.steps[0].tool).to.equal("phalnx_advise");
    expect(content.steps[0].check).to.include("swap");
  });

  it("includes spending cap check before execution", () => {
    const result = safeSwapPrompt({
      inputToken: "USDC",
      outputToken: "SOL",
      amount: "1000000",
    });
    const content = JSON.parse(result.messages[0].content.text);
    const spendingStep = content.steps.find(
      (s: any) => s.input?.query === "spending",
    );
    expect(spendingStep).to.not.be.undefined;
    expect(spendingStep.step).to.be.lessThan(6); // Before execution
  });

  it("execution step has error recovery via phalnx_advise", () => {
    const result = safeSwapPrompt({
      inputToken: "USDC",
      outputToken: "SOL",
      amount: "1000000",
    });
    const content = JSON.parse(result.messages[0].content.text);
    const execStep = content.steps.find((s: any) => s.input?.action === "swap");
    expect(execStep.onFailure.tool).to.equal("phalnx_advise");
    expect(execStep.onFailure.input.question).to.equal("whyDidThisFail");
  });

  it("passes slippageBps when provided", () => {
    const result = safeSwapPrompt({
      inputToken: "USDC",
      outputToken: "SOL",
      amount: "1000000",
      slippageBps: 50,
    });
    const content = JSON.parse(result.messages[0].content.text);
    expect(content.params.slippageBps).to.equal(50);
  });

  it("includes safety checks list", () => {
    const result = safeSwapPrompt({
      inputToken: "USDC",
      outputToken: "SOL",
      amount: "1000000",
    });
    const content = JSON.parse(result.messages[0].content.text);
    expect(content.safetyChecks).to.be.an("array").with.length.greaterThan(0);
  });
});
