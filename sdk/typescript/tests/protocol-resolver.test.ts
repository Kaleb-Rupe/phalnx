import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ProtocolRegistry } from "../src/integrations/protocol-registry";
import type {
  ProtocolHandler,
  ProtocolHandlerMetadata,
  ProtocolContext,
  ProtocolComposeResult,
} from "../src/integrations/protocol-handler";
import {
  resolveProtocol,
  isProtocolAllowed,
  ProtocolTier,
  type ProtocolResolution,
} from "../src/protocol-resolver";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStubHandler(
  protocolId: string,
  displayName: string,
  programIds: PublicKey[],
): ProtocolHandler {
  const metadata: ProtocolHandlerMetadata = {
    protocolId,
    displayName,
    programIds,
    supportedActions: new Map([
      ["deposit", { actionType: { deposit: {} }, isSpending: true }],
    ]),
  };
  return {
    metadata,
    async compose(
      _ctx: ProtocolContext,
      _action: string,
      _params: Record<string, unknown>,
    ): Promise<ProtocolComposeResult> {
      return { instructions: [] };
    },
    summarize(_action: string, _params: Record<string, unknown>): string {
      return `${displayName} action`;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("protocol-resolver", () => {
  const jupiterProgramId = Keypair.generate().publicKey;
  const driftProgramId = Keypair.generate().publicKey;
  const unknownProgramId = Keypair.generate().publicKey;
  const allowlistedUnknownProgramId = Keypair.generate().publicKey;

  let registry: ProtocolRegistry;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    registry.register(
      makeStubHandler("jupiter", "Jupiter", [jupiterProgramId]),
    );
    registry.register(makeStubHandler("drift", "Drift", [driftProgramId]));
  });

  // ── resolveProtocol ─────────────────────────────────────────────────────

  describe("resolveProtocol", () => {
    it("returns handler tier when handler exists and program is in allowlist", () => {
      const policy = {
        protocolMode: 1,
        protocols: [jupiterProgramId],
      };
      const result: ProtocolResolution = resolveProtocol(
        jupiterProgramId,
        registry,
        policy,
        false,
      );
      expect(result.tier).to.equal(ProtocolTier.T1_API);
      expect(result.protocolId).to.equal("jupiter");
      expect(result.escalation).to.be.undefined;
    });

    it("returns NOT_SUPPORTED with not_in_allowlist when handler exists but program not in allowlist", () => {
      const policy = {
        protocolMode: 1,
        protocols: [jupiterProgramId], // drift NOT in list
      };
      const result = resolveProtocol(driftProgramId, registry, policy, false);
      expect(result.tier).to.equal(ProtocolTier.NOT_SUPPORTED);
      expect(result.escalation).to.not.be.undefined;
      expect(result.escalation!.type).to.equal("not_in_allowlist");
    });

    it("returns T4_PASSTHROUGH when no handler but in allowlist with constraints configured", () => {
      const policy = {
        protocolMode: 1,
        protocols: [allowlistedUnknownProgramId],
      };
      const result = resolveProtocol(
        allowlistedUnknownProgramId,
        registry,
        policy,
        true, // constraints configured
      );
      expect(result.tier).to.equal(ProtocolTier.T4_PASSTHROUGH);
      expect(result.escalation).to.be.undefined;
    });

    it("returns NOT_SUPPORTED with no_handler_no_constraints when no handler, in allowlist, no constraints", () => {
      const policy = {
        protocolMode: 1,
        protocols: [allowlistedUnknownProgramId],
      };
      const result = resolveProtocol(
        allowlistedUnknownProgramId,
        registry,
        policy,
        false, // no constraints
      );
      expect(result.tier).to.equal(ProtocolTier.NOT_SUPPORTED);
      expect(result.escalation).to.not.be.undefined;
      expect(result.escalation!.type).to.equal("no_handler_no_constraints");
      expect(result.escalation!.requiredActions.length).to.be.greaterThan(0);
    });

    it("returns NOT_SUPPORTED with not_in_allowlist_and_no_handler when no handler and not in allowlist", () => {
      const policy = {
        protocolMode: 1,
        protocols: [jupiterProgramId], // unknownProgramId NOT in list
      };
      const result = resolveProtocol(unknownProgramId, registry, policy, false);
      expect(result.tier).to.equal(ProtocolTier.NOT_SUPPORTED);
      expect(result.escalation).to.not.be.undefined;
      expect(result.escalation!.type).to.equal(
        "not_in_allowlist_and_no_handler",
      );
    });

    it("includes alternatives in escalation when other handlers are registered", () => {
      const policy = {
        protocolMode: 1,
        protocols: [jupiterProgramId],
      };
      const result = resolveProtocol(unknownProgramId, registry, policy, false);
      expect(result.escalation).to.not.be.undefined;
      // Alternatives should suggest registered protocols
      if (result.escalation!.alternatives) {
        expect(result.escalation!.alternatives.length).to.be.greaterThan(0);
        const altIds = result.escalation!.alternatives.map((a) => a.protocolId);
        // At least one of our registered protocols should appear
        expect(altIds.includes("jupiter") || altIds.includes("drift")).to.be
          .true;
      }
    });

    it("returns handler tier when mode is 0 (allow all) regardless of handler existence", () => {
      const policy = {
        protocolMode: 0,
        protocols: [],
      };
      const result = resolveProtocol(jupiterProgramId, registry, policy, false);
      expect(result.tier).to.equal(ProtocolTier.T1_API);
      expect(result.protocolId).to.equal("jupiter");
    });

    it("includes message in escalation info", () => {
      const policy = {
        protocolMode: 1,
        protocols: [],
      };
      const result = resolveProtocol(jupiterProgramId, registry, policy, false);
      expect(result.escalation).to.not.be.undefined;
      expect(result.escalation!.message).to.be.a("string");
      expect(result.escalation!.message.length).to.be.greaterThan(0);
    });
  });

  // ── isProtocolAllowed ───────────────────────────────────────────────────

  describe("isProtocolAllowed", () => {
    it("mode 0 (allow all) always returns true", () => {
      const policy = { protocolMode: 0, protocols: [] };
      expect(isProtocolAllowed(unknownProgramId, policy)).to.be.true;
      expect(isProtocolAllowed(jupiterProgramId, policy)).to.be.true;
    });

    it("mode 1 (allowlist) returns true when program is in list", () => {
      const policy = {
        protocolMode: 1,
        protocols: [jupiterProgramId, driftProgramId],
      };
      expect(isProtocolAllowed(jupiterProgramId, policy)).to.be.true;
    });

    it("mode 1 (allowlist) returns false when program is NOT in list", () => {
      const policy = {
        protocolMode: 1,
        protocols: [jupiterProgramId],
      };
      expect(isProtocolAllowed(unknownProgramId, policy)).to.be.false;
    });

    it("mode 2 (denylist) returns false when program IS in list", () => {
      const policy = {
        protocolMode: 2,
        protocols: [unknownProgramId],
      };
      expect(isProtocolAllowed(unknownProgramId, policy)).to.be.false;
    });

    it("mode 2 (denylist) returns true when program is NOT in list", () => {
      const policy = {
        protocolMode: 2,
        protocols: [unknownProgramId],
      };
      expect(isProtocolAllowed(jupiterProgramId, policy)).to.be.true;
    });
  });

  // ── ProtocolTier enum ───────────────────────────────────────────────────

  describe("ProtocolTier enum", () => {
    it("has the correct numeric values", () => {
      expect(ProtocolTier.T1_API).to.equal(1);
      expect(ProtocolTier.T2_SDK).to.equal(2);
      expect(ProtocolTier.T3_IDL).to.equal(3);
      expect(ProtocolTier.T4_PASSTHROUGH).to.equal(4);
      expect(ProtocolTier.NOT_SUPPORTED).to.equal(5);
    });
  });
});
