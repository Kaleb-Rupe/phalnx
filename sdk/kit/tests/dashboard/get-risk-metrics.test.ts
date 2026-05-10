/**
 * S11 — `OwnerClient.getRiskMetrics` tests.
 *
 * Covers:
 * - `deriveRiskLevel`: alert-severity → 4-level UI badge mapping
 * - `buildRiskMetrics`: composition over a pre-built OverviewContext
 *   (cap-velocity math, accelerating flag, time-to-cap pass-through)
 * - `OwnerClient.getRiskMetrics` delegation to `reads.getRiskMetrics`
 *
 * Pure-function path follows the dashboard convention (`overview.test.ts`):
 * no RPC mocking is required because `buildRiskMetrics` and `deriveRiskLevel`
 * both operate on already-resolved state + alerts.
 */

import { expect } from "chai";
import type { Address, TransactionSigner } from "@solana/kit";

import {
  buildRiskMetrics,
  deriveRiskLevel,
  OwnerClient,
  type OwnerClientConfig,
} from "../../src/dashboard/index.js";
import * as reads from "../../src/dashboard/reads.js";
import type { OverviewContext } from "../../src/dashboard/types.js";
import type { Alert } from "../../src/security-analytics.js";

// ─── Test Constants ─────────────────────────────────────────────────────────

const VAULT = "Vault11111111111111111111111111111111111111" as Address;
const OWNER = "Owner11111111111111111111111111111111111111" as Address;

// ─── Fixture helpers ────────────────────────────────────────────────────────

function alert(severity: Alert["severity"], id = `${severity}-1`): Alert {
  return {
    id,
    severity,
    title: "test",
    description: "fixture",
    vaultAddress: VAULT,
    agentAddress: null,
    actionHref: "",
    actionLabel: "",
  };
}

/**
 * Build a minimal OverviewContext for buildRiskMetrics. Tracker + global
 * budget are the only fields buildRiskMetrics actually reads (plus
 * memoized `ctx.alerts` to bypass the alert evaluator).
 */
function ctxWith(opts: {
  spent24h?: bigint;
  cap?: bigint;
  remaining?: bigint;
  tracker?: { buckets: Array<{ epochId: bigint; usdAmount: bigint }> } | null;
  alerts?: Alert[];
}): OverviewContext {
  const cap = opts.cap ?? 0n;
  const spent24h = opts.spent24h ?? 0n;
  const remaining = opts.remaining ?? (cap > spent24h ? cap - spent24h : 0n);
  const state = {
    vault: { agents: [] },
    globalBudget: { spent24h, cap, remaining },
    tracker: opts.tracker ?? null,
    allAgentBudgets: new Map(),
  };
  return {
    vault: VAULT,
    state,
    alerts: opts.alerts ?? [],
  } as unknown as OverviewContext;
}

// ─── deriveRiskLevel ────────────────────────────────────────────────────────

describe("deriveRiskLevel (S11)", () => {
  it("returns 'low' when no alerts are present", () => {
    expect(deriveRiskLevel([])).to.equal("low");
  });

  it("returns 'critical' when any alert is critical (highest precedence)", () => {
    expect(
      deriveRiskLevel([alert("info"), alert("warning"), alert("critical")]),
    ).to.equal("critical");
  });

  it("returns 'high' when there is a warning but no critical", () => {
    expect(deriveRiskLevel([alert("info"), alert("warning")])).to.equal("high");
  });

  it("returns 'elevated' when only info alerts are present", () => {
    expect(deriveRiskLevel([alert("info"), alert("info")])).to.equal(
      "elevated",
    );
  });

  it("short-circuits on first critical encountered", () => {
    // The subsequent malformed alert would explode if we kept iterating.
    const garbage = { severity: "critical" } as Alert;
    expect(deriveRiskLevel([alert("critical"), garbage])).to.equal("critical");
  });
});

// ─── buildRiskMetrics ───────────────────────────────────────────────────────

describe("buildRiskMetrics (S11)", () => {
  it("returns zeroes when there is no tracker and no cap", () => {
    const metrics = buildRiskMetrics(ctxWith({ tracker: null, cap: 0n }));
    expect(metrics.capVelocity).to.equal(0);
    expect(metrics.spendingVelocity).to.equal(0n);
    expect(metrics.isAccelerating).to.equal(false);
    expect(metrics.timeToCapSeconds).to.equal(null);
    expect(metrics.riskLevel).to.equal("low");
  });

  it("computes capVelocity from currentRate × 24 / cap as a percent", () => {
    // Tracker with 3 recent epochs each 1_000_000n at the current epoch.
    // currentRate = (sum × 6) / 3 = (3_000_000 × 6) / 3 = 6_000_000n per hour.
    // capVelocity = 6_000_000 × 24 / 24_000_000 × 100 = 600%.
    const epochDuration = 600n;
    const nowEpoch = BigInt(Math.floor(Date.now() / 1000)) / epochDuration;
    const buckets = [0n, 1n, 2n].map((offset) => ({
      epochId: nowEpoch - offset,
      usdAmount: 1_000_000n,
    }));
    const metrics = buildRiskMetrics(
      ctxWith({
        tracker: { buckets },
        cap: 24_000_000n,
        spent24h: 3_000_000n,
        remaining: 21_000_000n,
      }),
    );
    expect(metrics.spendingVelocity).to.equal(6_000_000n);
    expect(metrics.capVelocity).to.be.closeTo(600, 0.001);
  });

  it("flags isAccelerating when current rate exceeds 1.5× the 24h average", () => {
    const epochDuration = 600n;
    const nowEpoch = BigInt(Math.floor(Date.now() / 1000)) / epochDuration;
    // 3 recent epochs of 1_000_000 → currentRate = 6_000_000/hr
    // averageRate = spent24h / 24 = 24_000_000 / 24 = 1_000_000/hr
    // 6 > 1.5 → accelerating
    const buckets = [0n, 1n, 2n].map((offset) => ({
      epochId: nowEpoch - offset,
      usdAmount: 1_000_000n,
    }));
    const metrics = buildRiskMetrics(
      ctxWith({
        tracker: { buckets },
        cap: 100_000_000n,
        spent24h: 24_000_000n,
        remaining: 76_000_000n,
      }),
    );
    expect(metrics.isAccelerating).to.equal(true);
  });

  it("propagates timeToCapSeconds from getSpendingVelocity", () => {
    const epochDuration = 600n;
    const nowEpoch = BigInt(Math.floor(Date.now() / 1000)) / epochDuration;
    // currentRate = 6_000_000/hr, remaining = 6_000_000 → ~3600 seconds.
    const buckets = [0n, 1n, 2n].map((offset) => ({
      epochId: nowEpoch - offset,
      usdAmount: 1_000_000n,
    }));
    const metrics = buildRiskMetrics(
      ctxWith({
        tracker: { buckets },
        cap: 6_000_000n,
        spent24h: 0n,
        remaining: 6_000_000n,
      }),
    );
    expect(metrics.timeToCapSeconds).to.not.equal(null);
    if (metrics.timeToCapSeconds !== null) {
      expect(metrics.timeToCapSeconds).to.be.greaterThan(3500);
      expect(metrics.timeToCapSeconds).to.be.lessThan(3700);
    }
  });

  it("uses ctx.alerts when memoized — does not re-evaluate", () => {
    // ctx.alerts has a critical alert; expect riskLevel = 'critical' without
    // touching state. evaluateAlertConditions would return [] from this
    // empty fixture, so any leak would yield 'low' instead.
    const metrics = buildRiskMetrics(ctxWith({ alerts: [alert("critical")] }));
    expect(metrics.riskLevel).to.equal("critical");
  });

  it("toJSON serializes bigint spendingVelocity to a string", () => {
    const metrics = buildRiskMetrics(ctxWith({}));
    const json = metrics.toJSON();
    expect(typeof json.spendingVelocity).to.equal("string");
    expect(json.spendingVelocity).to.equal("0");
    expect(json.riskLevel).to.equal("low");
  });
});

// ─── OwnerClient.getRiskMetrics — delegation ────────────────────────────────
//
// Same pattern as getAgentDetail: the read function chain runs end-to-end
// against a Proxy RPC that throws on first access. The wrapped error
// confirms the method invoked `reads.getRiskMetrics`.

describe("OwnerClient.getRiskMetrics (S11)", () => {
  function mockSigner(addr: Address = OWNER): TransactionSigner {
    return {
      address: addr,
      signTransactions: async (txs: readonly unknown[]) => txs.map(() => ({})),
    } as unknown as TransactionSigner;
  }

  it("exposes getRiskMetrics as a method on OwnerClient", () => {
    const client = new OwnerClient({
      rpc: {} as unknown as OwnerClientConfig["rpc"],
      vault: VAULT,
      owner: mockSigner(),
      network: "mainnet",
    });
    expect(typeof client.getRiskMetrics).to.equal("function");
  });

  it("invokes reads.getRiskMetrics and propagates the wrapped error path", async () => {
    const sentinelMessage = "SENTINEL_RPC_REACHED";
    const sentinelRpc = new Proxy(
      {},
      {
        get() {
          throw new Error(sentinelMessage);
        },
      },
    ) as unknown as OwnerClientConfig["rpc"];

    const client = new OwnerClient({
      rpc: sentinelRpc,
      vault: VAULT,
      owner: mockSigner(),
      network: "devnet",
    });

    let caught: unknown;
    try {
      await client.getRiskMetrics();
    } catch (err) {
      caught = err;
    }
    expect(caught).to.not.equal(undefined);
    const msg = (caught as Error).message ?? "";
    expect(msg).to.include("OwnerClient.getRiskMetrics");
  });

  it("references reads.getRiskMetrics at module level (sanity)", () => {
    expect(typeof reads.getRiskMetrics).to.equal("function");
  });
});
