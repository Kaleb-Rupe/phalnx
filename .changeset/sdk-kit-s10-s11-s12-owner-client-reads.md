---
"@usesigil/kit": minor
---

feat(kit): OwnerClient.getAgentDetail / getRiskMetrics / getAuditTrail (S10/S11/S12)

Three new read-method wrappers on `OwnerClient` for the AgentShield V1
dashboard surface. Each is a thin convenience layer over an existing SDK
function — no new RPC patterns, no new on-chain reads.

**S10 — `getAgentDetail(agent: Address): Promise<AgentData>`**
Single-agent detail wrapper around `getAgentProfile()` (from
`agent-analytics.ts`) + the same 100-event activity enrichment fetch
used by `getAgents()`. Returns the dashboard-friendly `AgentData` shape
for one agent (same fields as one entry in `getAgents()`). Throws via
`toDxError` mapped from `SIGIL_ERROR__SDK__INVALID_PARAMS` when the
agent is not registered in the vault. Activity enrichment fails open to
empty last-action fields, matching the existing `getAgents()` pattern.

**S11 — `getRiskMetrics(): Promise<RiskMetrics>`**
Combines `getSpendingVelocity()` + `evaluateAlertConditions()` into a
single risk-tilt summary. Returns:

- `capVelocity` — % of daily cap projected to be consumed in 24h at the
  current rate (0 when no cap configured).
- `spendingVelocity` — current rate in 6-decimal USD base units / hour.
- `riskLevel` — four-level UI badge (`low` / `elevated` / `high` /
  `critical`) derived from the highest-severity active alert.
- `isAccelerating` / `timeToCapSeconds` — passed through from
  `getSpendingVelocity`.

One state resolution. No activity fetch.

**S12 — `getAuditTrail(opts?): Promise<AuditTrailEntry[]>`**
Filters `getVaultActivity()` to the governance/security subset
(`policy` / `agent` / `security` / `escrow` categories — trades,
deposits, withdrawals, and fee accruals are excluded). Each entry
exposes `timestamp` (Unix ms), `eventType`, `eventName`, `actor`,
`details`, `txSignature`, plus `toJSON()`. Optional `{ limit, since }`
controls fetch size and post-filter timestamp lower bound (Unix ms).

Three new test files (`get-agent-detail.test.ts`, `get-risk-metrics.test.ts`,
`get-audit-trail.test.ts`) covering the pure `build*` helpers plus
`OwnerClient` method wiring — 36 new tests total, kit suite now 1,781
passing (was 1,745).
