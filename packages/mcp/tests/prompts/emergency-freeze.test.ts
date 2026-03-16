import { expect } from "chai";
import { emergencyFreezePrompt } from "../../src/prompts/emergency-freeze";

describe("prompt: emergency-freeze", () => {
  it("returns CRITICAL severity workflow", () => {
    const result = emergencyFreezePrompt({ reason: "suspicious_activity" });

    expect(result.messages).to.be.an("array").with.lengthOf(1);
    const content = JSON.parse(result.messages[0].content.text);
    expect(content.severity).to.equal("CRITICAL");
    expect(content.workflow).to.equal("emergency-freeze");
  });

  it("captures pre-freeze state before freezing", () => {
    const result = emergencyFreezePrompt({ reason: "compromised_key" });
    const content = JSON.parse(result.messages[0].content.text);

    // Steps 1 and 2 capture state, step 3 freezes
    expect(content.steps[0].purpose).to.include("pre-freeze");
    expect(content.steps[1].purpose).to.include("spending");
    expect(content.steps[2].input.action).to.equal("freezeVault");
  });

  it("verifies freeze succeeded in step 4", () => {
    const result = emergencyFreezePrompt({ reason: "manual" });
    const content = JSON.parse(result.messages[0].content.text);

    expect(content.steps[3].check).to.include("frozen");
  });

  it("includes post-freeze guidance", () => {
    const result = emergencyFreezePrompt({ reason: "policy_violation" });
    const content = JSON.parse(result.messages[0].content.text);

    expect(content.postFreeze).to.have.property("vaultState", "frozen");
    expect(content.postFreeze).to.have.property("agentOperations", "blocked");
    expect(content.postFreeze.nextSteps).to.be.an("array");
  });

  it("includes audit fields", () => {
    const result = emergencyFreezePrompt({
      reason: "suspicious_activity",
    });
    const content = JSON.parse(result.messages[0].content.text);

    expect(content.auditFields).to.have.property(
      "reason",
      "suspicious_activity",
    );
    expect(content.auditFields).to.have.property("initiator", "agent");
  });

  it("freeze step is marked critical", () => {
    const result = emergencyFreezePrompt({ reason: "compromised_key" });
    const content = JSON.parse(result.messages[0].content.text);

    const freezeStep = content.steps.find(
      (s: any) => s.input?.action === "freezeVault",
    );
    expect(freezeStep.critical).to.be.true;
  });

  it("has escalation path on freeze failure", () => {
    const result = emergencyFreezePrompt({ reason: "compromised_key" });
    const content = JSON.parse(result.messages[0].content.text);

    const freezeStep = content.steps.find(
      (s: any) => s.input?.action === "freezeVault",
    );
    expect(freezeStep.onFailure.action).to.equal("ESCALATE");
  });
});
