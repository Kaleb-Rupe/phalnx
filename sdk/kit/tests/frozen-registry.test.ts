import { expect } from "chai";
import type { Address } from "@solana/kit";
import { IntentEngine, type IntentEngineConfig } from "../src/intent-engine.js";
import { ProtocolRegistry } from "../src/integrations/protocol-registry.js";
import { JupiterHandler } from "../src/integrations/jupiter-handler.js";

// ─── Test Helpers ──────────────────────────────────────────────────────────

const AGENT = "Agent111111111111111111111111111111111111111" as Address;

function mockAgent() {
  return {
    address: AGENT,
    signTransactions: async (txs: unknown[]) => txs,
  } as any;
}

function buildRegistryWithHandlers(): ProtocolRegistry {
  const reg = new ProtocolRegistry();
  reg.register(new JupiterHandler());
  return reg;
}

/** Capture console.warn calls during a callback. */
function captureWarns(fn: () => void): string[] {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("H-5: Frozen registry guard", () => {
  it("IntentEngine warns when registry is not frozen", () => {
    const reg = buildRegistryWithHandlers();
    // Registry is NOT frozen
    const warnings = captureWarns(() => {
      new IntentEngine({
        rpc: {} as any,
        network: "devnet",
        protocolRegistry: reg,
        agent: mockAgent(),
      });
    });
    expect(warnings.length).to.equal(1);
    expect(warnings[0]).to.include("[IntentEngine] Protocol registry is not frozen");
    expect(warnings[0]).to.include("registry.freeze()");
  });

  it("IntentEngine does NOT warn when registry is frozen", () => {
    const reg = buildRegistryWithHandlers();
    reg.freeze();
    const warnings = captureWarns(() => {
      new IntentEngine({
        rpc: {} as any,
        network: "devnet",
        protocolRegistry: reg,
        agent: mockAgent(),
      });
    });
    expect(warnings.length).to.equal(0);
  });

  it("ProtocolRegistry.isFrozen returns false by default", () => {
    const reg = new ProtocolRegistry();
    expect(reg.isFrozen).to.be.false;
  });

  it("ProtocolRegistry.isFrozen returns true after freeze()", () => {
    const reg = new ProtocolRegistry();
    reg.freeze();
    expect(reg.isFrozen).to.be.true;
  });

  it("register() after freeze() still throws", () => {
    const reg = new ProtocolRegistry();
    reg.register(new JupiterHandler());
    reg.freeze();
    expect(() => reg.register(new JupiterHandler())).to.throw(
      "Registry is frozen"
    );
  });
});
