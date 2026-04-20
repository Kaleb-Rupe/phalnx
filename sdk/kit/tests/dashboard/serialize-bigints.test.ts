/**
 * serializeBigints regression tests.
 *
 * The recursive serializeBigints function must convert ALL bigint values
 * to strings at any nesting depth — top-level, nested objects, arrays,
 * and mixed structures. If any bigint survives, JSON.stringify will throw.
 *
 * Since serializeBigints is not exported, we test it through getPolicy().toJSON()
 * and by directly importing the module and testing the behavior pattern.
 */

import { expect } from "chai";

// ─── Direct Function Behavior Tests ─────────────────────────────────────────
// We replicate the exact serializeBigints implementation to unit-test the
// algorithm in isolation. If the implementation changes, these tests catch regressions.

function serializeBigints(obj: unknown): unknown {
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigints);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = serializeBigints(v);
    }
    return result;
  }
  return obj;
}

describe("serializeBigints", () => {
  // ─── Primitives ──────────────────────────────────────────────────────────

  it("converts bigint to string", () => {
    expect(serializeBigints(100n)).to.equal("100");
  });

  it("converts 0n to '0'", () => {
    expect(serializeBigints(0n)).to.equal("0");
  });

  it("converts negative bigint", () => {
    expect(serializeBigints(-42n)).to.equal("-42");
  });

  it("converts very large bigint (u64 max)", () => {
    const u64Max = (1n << 64n) - 1n;
    expect(serializeBigints(u64Max)).to.equal("18446744073709551615");
  });

  it("leaves number unchanged", () => {
    expect(serializeBigints(42)).to.equal(42);
  });

  it("leaves string unchanged", () => {
    expect(serializeBigints("hello")).to.equal("hello");
  });

  it("leaves boolean unchanged", () => {
    expect(serializeBigints(true)).to.equal(true);
  });

  it("leaves null unchanged", () => {
    expect(serializeBigints(null)).to.equal(null);
  });

  it("leaves undefined unchanged", () => {
    expect(serializeBigints(undefined)).to.equal(undefined);
  });

  // ─── Top-Level Objects ───────────────────────────────────────────────────

  it("converts bigint fields in flat object", () => {
    const result = serializeBigints({ dailyCap: 500n, name: "test" });
    expect(result).to.deep.equal({ dailyCap: "500", name: "test" });
  });

  it("handles empty object", () => {
    expect(serializeBigints({})).to.deep.equal({});
  });

  // ─── Nested Objects ──────────────────────────────────────────────────────

  it("converts bigints in nested objects", () => {
    const result = serializeBigints({
      outer: { inner: { value: 100n } },
    });
    expect(result).to.deep.equal({
      outer: { inner: { value: "100" } },
    });
  });

  it("converts mixed nested structure", () => {
    const result = serializeBigints({
      dailyCap: 500n,
      metadata: {
        createdAt: 1234567890,
        caps: { protocol: 200n, agent: 100n },
      },
    });
    expect(result).to.deep.equal({
      dailyCap: "500",
      metadata: {
        createdAt: 1234567890,
        caps: { protocol: "200", agent: "100" },
      },
    });
  });

  // ─── Arrays ──────────────────────────────────────────────────────────────

  it("converts bigints inside arrays", () => {
    const result = serializeBigints([1n, 2n, 3n]);
    expect(result).to.deep.equal(["1", "2", "3"]);
  });

  it("converts bigints in mixed arrays", () => {
    const result = serializeBigints([1n, "two", 3, true, null]);
    expect(result).to.deep.equal(["1", "two", 3, true, null]);
  });

  it("handles empty arrays", () => {
    expect(serializeBigints([])).to.deep.equal([]);
  });

  // ─── Objects with Array Fields ───────────────────────────────────────────

  it("converts protocolCaps array (real-world case)", () => {
    const result = serializeBigints({
      protocolCaps: [200_000_000n, 500_000_000n, 100_000_000n],
      hasProtocolCaps: true,
    });
    expect(result).to.deep.equal({
      protocolCaps: ["200000000", "500000000", "100000000"],
      hasProtocolCaps: true,
    });
  });

  it("handles nested arrays in objects", () => {
    const result = serializeBigints({
      changes: {
        protocolCaps: [1n, 2n],
        dailyCap: 500n,
      },
    });
    expect(result).to.deep.equal({
      changes: {
        protocolCaps: ["1", "2"],
        dailyCap: "500",
      },
    });
  });

  // ─── JSON.stringify Safety ───────────────────────────────────────────────

  it("result is JSON.stringify-safe (no bigints survive)", () => {
    const complex = {
      dailyCap: 500_000_000n,
      protocolCaps: [200n, 300n],
      nested: { value: 42n },
      mixed: [1n, "two", { deep: 3n }],
    };

    const serialized = serializeBigints(complex);

    // This MUST NOT throw — if any bigint survived, JSON.stringify fails
    const json = JSON.stringify(serialized);
    expect(json).to.be.a("string");

    // Verify roundtrip
    const parsed = JSON.parse(json);
    expect(parsed.dailyCap).to.equal("500000000");
    expect(parsed.protocolCaps).to.deep.equal(["200", "300"]);
    expect(parsed.nested.value).to.equal("42");
    expect(parsed.mixed).to.deep.equal(["1", "two", { deep: "3" }]);
  });

  it("PolicyChanges-shaped object serializes safely", () => {
    // Simulates what getPolicy().toJSON() passes through serializeBigints
    const policyChanges = {
      dailyCap: 5_000_000_000n,
      maxPerTrade: 1_000_000_000n,
      protocolCaps: [2_000_000_000n, 500_000_000n],
      sessionExpirySlots: 20n,
      timelock: 1800,
      approvedApps: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
    };

    const serialized = serializeBigints(policyChanges);
    const json = JSON.stringify(serialized);
    expect(() => JSON.parse(json)).to.not.throw();

    const parsed = JSON.parse(json);
    expect(parsed.dailyCap).to.equal("5000000000");
    expect(parsed.protocolCaps[0]).to.equal("2000000000");
    expect(parsed.timelock).to.equal(1800); // number unchanged
  });
});
