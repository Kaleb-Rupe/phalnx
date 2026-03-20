import { expect } from "chai";
import type { Address } from "@solana/kit";
import {
  isProtocolAllowed,
  resolveProtocol,
  ProtocolTier,
} from "../src/protocol-resolver.js";

// Known program IDs from @phalnx/core KNOWN_PROTOCOLS
const JUPITER_PROGRAM =
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" as Address;
const DRIFT_PROGRAM =
  "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH" as Address;
const UNKNOWN_PROGRAM =
  "Unknown1111111111111111111111111111111111111" as Address;

describe("protocol-resolver", () => {
  describe("isProtocolAllowed()", () => {
    it("mode 0 allows all programs", () => {
      const result = isProtocolAllowed(UNKNOWN_PROGRAM, {
        protocolMode: 0,
        protocols: [],
      });
      expect(result).to.be.true;
    });

    it("mode 1 (allowlist) allows listed program", () => {
      const result = isProtocolAllowed(JUPITER_PROGRAM, {
        protocolMode: 1,
        protocols: [JUPITER_PROGRAM],
      });
      expect(result).to.be.true;
    });

    it("mode 1 (allowlist) rejects unlisted program", () => {
      const result = isProtocolAllowed(UNKNOWN_PROGRAM, {
        protocolMode: 1,
        protocols: [JUPITER_PROGRAM],
      });
      expect(result).to.be.false;
    });

    it("mode 2 (denylist) rejects listed program", () => {
      const result = isProtocolAllowed(JUPITER_PROGRAM, {
        protocolMode: 2,
        protocols: [JUPITER_PROGRAM],
      });
      expect(result).to.be.false;
    });

    it("mode 2 (denylist) allows unlisted program", () => {
      const result = isProtocolAllowed(UNKNOWN_PROGRAM, {
        protocolMode: 2,
        protocols: [JUPITER_PROGRAM],
      });
      expect(result).to.be.true;
    });
  });

  describe("resolveProtocol()", () => {
    it("known program in allowlist resolves to KNOWN", () => {
      const result = resolveProtocol(
        JUPITER_PROGRAM,
        { protocolMode: 0, protocols: [] },
        false,
      );
      expect(result.tier).to.equal(ProtocolTier.KNOWN);
      expect(result.displayName).to.equal("Jupiter V6");
    });

    it("known Drift program resolves to KNOWN", () => {
      const result = resolveProtocol(
        DRIFT_PROGRAM,
        { protocolMode: 0, protocols: [] },
        false,
      );
      expect(result.tier).to.equal(ProtocolTier.KNOWN);
      expect(result.displayName).to.equal("Drift Protocol");
    });

    it("known program NOT in allowlist returns NOT_ALLOWED with escalation", () => {
      const result = resolveProtocol(
        JUPITER_PROGRAM,
        { protocolMode: 1, protocols: [] }, // allowlist with nothing listed
        false,
      );
      expect(result.tier).to.equal(ProtocolTier.NOT_ALLOWED);
      expect(result.escalation).to.exist;
      expect(result.escalation!.type).to.equal("not_in_allowlist");
      expect(result.escalation!.requiredActions.length).to.be.greaterThan(0);
    });

    it("unknown program + allowlisted + constraints resolves to DEFAULT", () => {
      const result = resolveProtocol(
        UNKNOWN_PROGRAM,
        { protocolMode: 0, protocols: [] }, // mode 0 = all allowed
        true, // constraints configured
      );
      expect(result.tier).to.equal(ProtocolTier.DEFAULT);
      expect(result.constraintsConfigured).to.be.true;
    });

    it("unknown program + allowlisted + no constraints returns NOT_ALLOWED with escalation", () => {
      const result = resolveProtocol(
        UNKNOWN_PROGRAM,
        { protocolMode: 0, protocols: [] },
        false,
      );
      expect(result.tier).to.equal(ProtocolTier.NOT_ALLOWED);
      expect(result.escalation).to.exist;
      expect(result.escalation!.type).to.equal("no_handler_no_constraints");
    });

    it("unknown program + NOT in allowlist returns NOT_ALLOWED", () => {
      const result = resolveProtocol(
        UNKNOWN_PROGRAM,
        { protocolMode: 1, protocols: [JUPITER_PROGRAM] },
        false,
      );
      expect(result.tier).to.equal(ProtocolTier.NOT_ALLOWED);
      expect(result.escalation).to.exist;
      expect(result.escalation!.type).to.equal(
        "not_in_allowlist_and_no_handler",
      );
    });
  });
});
