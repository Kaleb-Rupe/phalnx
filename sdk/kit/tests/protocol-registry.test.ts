import { expect } from "chai";
import type { Address } from "@solana/kit";
import {
  ProtocolRegistry,
  globalProtocolRegistry,
} from "../src/integrations/protocol-registry.js";
import type {
  ProtocolHandler,
  ProtocolHandlerMetadata,
  ProtocolContext,
  ProtocolComposeResult,
} from "../src/integrations/protocol-handler.js";
import { ActionType } from "../src/generated/types/actionType.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

const FAKE_PROGRAM_A = "FakeProgramAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as Address;
const FAKE_PROGRAM_B = "FakeProgramBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" as Address;
const FAKE_PROGRAM_C = "FakeProgramCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" as Address;

function createMockHandler(
  protocolId: string,
  displayName: string,
  programIds: Address[],
): ProtocolHandler {
  return {
    metadata: {
      protocolId,
      displayName,
      programIds,
      supportedActions: new Map([
        ["swap", { actionType: ActionType.Swap, isSpending: true }],
      ]),
    },
    async compose(
      _ctx: ProtocolContext,
      _action: string,
      _params: Record<string, unknown>,
    ): Promise<ProtocolComposeResult> {
      return { instructions: [] };
    },
    summarize(_action: string, _params: Record<string, unknown>): string {
      return `${protocolId} action`;
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ProtocolRegistry", () => {
  let registry: ProtocolRegistry;

  beforeEach(() => {
    registry = new ProtocolRegistry();
  });

  it("registers a handler and looks up by protocolId", () => {
    const handler = createMockHandler("test-proto", "Test Protocol", [
      FAKE_PROGRAM_A,
    ]);
    registry.register(handler);
    const found = registry.getByProtocolId("test-proto");
    expect(found).to.equal(handler);
  });

  it("registers a handler and looks up by programId (Address)", () => {
    const handler = createMockHandler("test-proto", "Test Protocol", [
      FAKE_PROGRAM_A,
      FAKE_PROGRAM_B,
    ]);
    registry.register(handler);
    const found = registry.getByProgramId(FAKE_PROGRAM_B);
    expect(found).to.equal(handler);
  });

  it("deregister removes handler and program index entries", () => {
    const handler = createMockHandler("test-proto", "Test Protocol", [
      FAKE_PROGRAM_A,
    ]);
    registry.register(handler);
    expect(registry.has("test-proto")).to.be.true;

    const removed = registry.deregister("test-proto");
    expect(removed).to.be.true;
    expect(registry.has("test-proto")).to.be.false;
    expect(registry.getByProgramId(FAKE_PROGRAM_A)).to.be.undefined;
  });

  it("duplicate protocolId throws", () => {
    const handler1 = createMockHandler("dup-proto", "Dup 1", [FAKE_PROGRAM_A]);
    const handler2 = createMockHandler("dup-proto", "Dup 2", [FAKE_PROGRAM_B]);
    registry.register(handler1);
    expect(() => registry.register(handler2)).to.throw(
      "Protocol handler already registered: dup-proto",
    );
  });

  it("freeze() blocks registration", () => {
    registry.freeze();
    const handler = createMockHandler("frozen-proto", "Frozen", [
      FAKE_PROGRAM_A,
    ]);
    expect(() => registry.register(handler)).to.throw("Registry is frozen");
  });

  it("freeze() blocks deregistration", () => {
    const handler = createMockHandler("freeze-dereg", "Freeze Dereg", [
      FAKE_PROGRAM_A,
    ]);
    registry.register(handler);
    registry.freeze();
    expect(() => registry.deregister("freeze-dereg")).to.throw(
      "Registry is frozen",
    );
  });

  it("listAll returns all handler metadata", () => {
    const h1 = createMockHandler("proto-a", "Proto A", [FAKE_PROGRAM_A]);
    const h2 = createMockHandler("proto-b", "Proto B", [FAKE_PROGRAM_B]);
    registry.register(h1);
    registry.register(h2);

    const list = registry.listAll();
    expect(list).to.have.length(2);
    const ids = list.map((m) => m.protocolId);
    expect(ids).to.include("proto-a");
    expect(ids).to.include("proto-b");
  });

  it("has() returns true for registered, false for unknown", () => {
    const handler = createMockHandler("has-test", "Has Test", [FAKE_PROGRAM_A]);
    registry.register(handler);
    expect(registry.has("has-test")).to.be.true;
    expect(registry.has("nonexistent")).to.be.false;
  });

  it("size reflects registered handler count", () => {
    expect(registry.size).to.equal(0);
    registry.register(createMockHandler("s1", "S1", [FAKE_PROGRAM_A]));
    expect(registry.size).to.equal(1);
    registry.register(createMockHandler("s2", "S2", [FAKE_PROGRAM_B]));
    expect(registry.size).to.equal(2);
    registry.deregister("s1");
    expect(registry.size).to.equal(1);
  });

  it("getByProtocolId returns undefined for unknown id", () => {
    expect(registry.getByProtocolId("nonexistent")).to.be.undefined;
  });

  it("getByProgramId returns undefined for unknown program", () => {
    expect(registry.getByProgramId(FAKE_PROGRAM_C)).to.be.undefined;
  });

  it("globalProtocolRegistry is a ProtocolRegistry instance", () => {
    expect(globalProtocolRegistry).to.be.instanceOf(ProtocolRegistry);
  });
});
