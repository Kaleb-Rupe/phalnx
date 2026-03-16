import { expect } from "chai";
import type { Address } from "@solana/kit";
import {
  isProtocolAllowed,
  resolveProtocol,
  ProtocolTier,
} from "../src/protocol-resolver.js";
import { ProtocolRegistry } from "../src/integrations/protocol-registry.js";
import { JupiterHandler } from "../src/integrations/jupiter-handler.js";
import {
  DriftHandler,
  FlashTradeHandler,
} from "../src/integrations/t2-handlers.js";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function buildRegistry(): ProtocolRegistry {
  const reg = new ProtocolRegistry();
  reg.register(new JupiterHandler());
  reg.register(new DriftHandler());
  reg.register(new FlashTradeHandler());
  return reg;
}

// Known program IDs from handlers
const JUPITER_PROGRAM =
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" as Address;
const DRIFT_PROGRAM = "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH" as Address;
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
    it("T1 handler in allowlist resolves to T1_API", () => {
      const registry = buildRegistry();
      const result = resolveProtocol(
        JUPITER_PROGRAM,
        registry,
        { protocolMode: 0, protocols: [] },
        false,
      );
      expect(result.tier).to.equal(ProtocolTier.T1_API);
      expect(result.protocolId).to.equal("jupiter");
      expect(result.reason).to.include("API");
    });

    it("T2 handler in allowlist resolves to T2_SDK", () => {
      const registry = buildRegistry();
      const result = resolveProtocol(
        DRIFT_PROGRAM,
        registry,
        { protocolMode: 0, protocols: [] },
        false,
      );
      expect(result.tier).to.equal(ProtocolTier.T2_SDK);
      expect(result.protocolId).to.equal("drift");
      expect(result.reason).to.include("SDK");
    });

    it("handler NOT in allowlist returns NOT_SUPPORTED with escalation", () => {
      const registry = buildRegistry();
      const result = resolveProtocol(
        JUPITER_PROGRAM,
        registry,
        { protocolMode: 1, protocols: [] }, // allowlist with nothing listed
        false,
      );
      expect(result.tier).to.equal(ProtocolTier.NOT_SUPPORTED);
      expect(result.escalation).to.exist;
      expect(result.escalation!.type).to.equal("not_in_allowlist");
      expect(result.escalation!.requiredActions.length).to.be.greaterThan(0);
    });

    it("no handler + allowlisted + constraints resolves to T4_PASSTHROUGH", () => {
      const registry = buildRegistry();
      const result = resolveProtocol(
        UNKNOWN_PROGRAM,
        registry,
        { protocolMode: 0, protocols: [] }, // mode 0 = all allowed
        true, // constraints configured
      );
      expect(result.tier).to.equal(ProtocolTier.T4_PASSTHROUGH);
      expect(result.constraintsConfigured).to.be.true;
    });

    it("no handler + allowlisted + no constraints returns NOT_SUPPORTED with escalation", () => {
      const registry = buildRegistry();
      const result = resolveProtocol(
        UNKNOWN_PROGRAM,
        registry,
        { protocolMode: 0, protocols: [] },
        false,
      );
      expect(result.tier).to.equal(ProtocolTier.NOT_SUPPORTED);
      expect(result.escalation).to.exist;
      expect(result.escalation!.type).to.equal("no_handler_no_constraints");
      expect(result.escalation!.alternatives).to.be.an("array");
      expect(result.escalation!.alternatives!.length).to.be.greaterThan(0);
    });

    it("no handler + NOT in allowlist returns NOT_SUPPORTED", () => {
      const registry = buildRegistry();
      const result = resolveProtocol(
        UNKNOWN_PROGRAM,
        registry,
        { protocolMode: 1, protocols: [JUPITER_PROGRAM] }, // allowlist doesn't include UNKNOWN
        false,
      );
      expect(result.tier).to.equal(ProtocolTier.NOT_SUPPORTED);
      expect(result.escalation).to.exist;
      expect(result.escalation!.type).to.equal(
        "not_in_allowlist_and_no_handler",
      );
    });

    it("alternatives include correct tiers", () => {
      const registry = buildRegistry();
      const result = resolveProtocol(
        UNKNOWN_PROGRAM,
        registry,
        { protocolMode: 0, protocols: [] },
        false,
      );
      const alts = result.escalation!.alternatives!;
      const jupiterAlt = alts.find((a) => a.protocolId === "jupiter");
      expect(jupiterAlt?.tier).to.equal(ProtocolTier.T1_API);
      const driftAlt = alts.find((a) => a.protocolId === "drift");
      expect(driftAlt?.tier).to.equal(ProtocolTier.T2_SDK);
    });
  });
});
