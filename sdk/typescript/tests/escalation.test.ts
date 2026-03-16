import { expect } from "chai";
import {
  protocolEscalationError,
  isAgentError,
  type AgentError,
} from "../src/agent-errors";
import { ProtocolTier, type EscalationInfo } from "../src/protocol-resolver";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("protocolEscalationError", () => {
  describe("not_in_allowlist escalation", () => {
    it("returns an AgentError with escalate_to_human as first recovery action", () => {
      const escalation: EscalationInfo = {
        type: "not_in_allowlist",
        message: "Protocol is not in the vault's allowlist",
        requiredActions: ["Add protocol to vault allowlist"],
      };
      const err = protocolEscalationError(escalation);
      expect(isAgentError(err)).to.be.true;
      expect(err.recovery_actions.length).to.be.greaterThan(0);
      expect(err.recovery_actions[0].action).to.equal("escalate_to_human");
    });
  });

  describe("no_handler_no_constraints escalation", () => {
    it("has escalate first and constraint configuration second", () => {
      const escalation: EscalationInfo = {
        type: "no_handler_no_constraints",
        message:
          "No SDK handler and no instruction constraints configured for this protocol",
        requiredActions: [
          "Escalate to vault owner",
          "Configure instruction constraints",
        ],
      };
      const err = protocolEscalationError(escalation);
      expect(err.recovery_actions.length).to.be.greaterThanOrEqual(2);
      expect(err.recovery_actions[0].action).to.equal("escalate_to_human");
      // At least one required_vault_change should reference constraints
      const vaultChanges = err.recovery_actions.filter(
        (a) => a.action === "required_vault_change",
      );
      expect(vaultChanges.length).to.be.greaterThan(0);
      const hasConstraintRef = vaultChanges.some((a) =>
        a.description.toLowerCase().includes("constraint"),
      );
      expect(hasConstraintRef).to.be.true;
    });
  });

  describe("alternatives placement", () => {
    it("places alternatives LAST in recovery_actions when provided", () => {
      const escalation: EscalationInfo = {
        type: "not_in_allowlist",
        message: "Protocol not allowed",
        requiredActions: ["Add to allowlist"],
        alternatives: [
          {
            protocolId: "jupiter",
            displayName: "Jupiter",
            tier: ProtocolTier.T1_API,
          },
          {
            protocolId: "drift",
            displayName: "Drift",
            tier: ProtocolTier.T2_SDK,
          },
        ],
      };
      const err = protocolEscalationError(escalation);
      const actions = err.recovery_actions;
      expect(actions.length).to.be.greaterThanOrEqual(3);
      // Last action(s) should reference alternatives
      const lastAction = actions[actions.length - 1];
      expect(
        lastAction.action.includes("alternative") ||
          lastAction.description.toLowerCase().includes("alternative") ||
          lastAction.description.toLowerCase().includes("jupiter") ||
          lastAction.description.toLowerCase().includes("drift"),
      ).to.be.true;
    });

    it("does not include alternative actions when no alternatives provided", () => {
      const escalation: EscalationInfo = {
        type: "not_in_allowlist",
        message: "Protocol not allowed",
        requiredActions: ["Add to allowlist"],
      };
      const err = protocolEscalationError(escalation);
      const altActions = err.recovery_actions.filter(
        (a) =>
          a.action.includes("alternative") ||
          a.description.toLowerCase().includes("alternative"),
      );
      expect(altActions).to.have.length(0);
    });
  });

  describe("anti-redirect context", () => {
    it("context.IMPORTANT contains anti-redirect guidance", () => {
      const escalation: EscalationInfo = {
        type: "not_in_allowlist",
        message: "Protocol not allowed",
        requiredActions: ["Escalate"],
      };
      const err = protocolEscalationError(escalation);
      expect(err.context).to.have.property("IMPORTANT");
      const important = String(err.context.IMPORTANT);
      expect(important.toLowerCase()).to.include("do not");
      expect(
        important.toLowerCase().includes("silently") ||
          important.toLowerCase().includes("switch") ||
          important.toLowerCase().includes("redirect"),
      ).to.be.true;
    });
  });

  describe("error classification", () => {
    it("category is ESCALATION_REQUIRED", () => {
      const escalation: EscalationInfo = {
        type: "no_handler_no_constraints",
        message: "No handler available",
        requiredActions: ["Escalate"],
      };
      const err = protocolEscalationError(escalation);
      // ESCALATION_REQUIRED may be a new category or mapped to an existing one
      // The key invariant is that it signals escalation, not a retryable error
      expect(
        err.category === ("ESCALATION_REQUIRED" as AgentError["category"]) ||
          err.category === "POLICY_VIOLATION" ||
          err.category === "FATAL",
      ).to.be.true;
    });

    it("retryable is always false", () => {
      const types: EscalationInfo["type"][] = [
        "not_in_allowlist",
        "no_handler_no_constraints",
        "no_handler_has_constraints",
        "not_in_allowlist_and_no_handler",
      ];
      for (const type of types) {
        const err = protocolEscalationError({
          type,
          message: `Escalation: ${type}`,
          requiredActions: ["Escalate"],
        });
        expect(err.retryable).to.be.false;
      }
    });
  });

  describe("isAgentError compatibility", () => {
    it("all escalation types produce valid AgentErrors", () => {
      const types: EscalationInfo["type"][] = [
        "not_in_allowlist",
        "no_handler_no_constraints",
        "no_handler_has_constraints",
        "not_in_allowlist_and_no_handler",
      ];
      for (const type of types) {
        const err = protocolEscalationError({
          type,
          message: `Testing ${type}`,
          requiredActions: ["Do something"],
        });
        expect(isAgentError(err)).to.be.true;
        expect(err.code).to.be.a("string");
        expect(err.message).to.be.a("string");
        expect(err.recovery_actions).to.be.an("array");
        expect(err.context).to.be.an("object");
      }
    });
  });
});
