# Phase 2 §RP — silent-failure-hunter transcript

**Date:** 2026-05-18
**Phase:** 2 — Default-tightening + TA-19 policy_preview_digest + observe_only
**Dispatched from:** main orchestrator thread
**Tool:** `pr-review-toolkit:silent-failure-hunter`
**Phase commits at time of review:** `3ccf469` + `580a762` + `808479b` + `12f7d72` + `d77e166` + `55ac977` + `fe3f253` + `e821f9c` (8 total)
**Verdict:** FIX-AND-RETEST → 1 HIGH + 2 MEDIUM + 1 LOW

## Process note

First §RP dispatch hit `Server is temporarily limiting requests · Rate limited`. Retry succeeded.

## Scope sent to the agent

8 attack vectors:
1. Spot-check 3 of 15 claimed LiteSVM failures — fixture vs real bug
2. surfpool-integration + toctou-security arg-count mismatches: Phase 2 induced or pre-existing?
3. SDK ↔ on-chain digest cross-impl byte-perfect parity
4. apply_pending_policy.rs re-assertion correctness
5. observe_only check position in validate_and_authorize
6. Capability bound at all 3 ix sites (F-4)
7. destination_check.rs correctness
8. IDL regen completeness

## Findings

### HIGH — TA-19 digest silently broken by 4 sibling handlers

**Files:**
- `programs/sigil/src/instructions/create_instruction_constraints.rs:100`
- `programs/sigil/src/instructions/apply_close_constraints.rs:75`
- `programs/sigil/src/instructions/create_post_assertions.rs:74`
- `programs/sigil/src/instructions/close_post_assertions.rs:46`

**Defect:** `policy_preview_digest` encoding includes `has_constraints` and `has_post_assertions` flags. The four handlers above MUTATE these flags WITHOUT updating the stored `policy_preview_digest`. After any of these executes, the stored digest no longer matches the live policy state.

**Attack path:** Owner calls `create_instruction_constraints` (sets `has_constraints=true`). The stored `policy_preview_digest` is now stale. Owner then calls `queue_policy_update` (which stores `new_policy_preview_digest`). When `apply_pending_policy` runs, it recomputes the digest from the merged policy state — which includes the new `has_constraints=true` value — and asserts against `pending.new_policy_preview_digest`. The pending digest was computed with whatever `has_constraints` value the user signed at queue time. If they queued AFTER the constraint create, the pending digest IS consistent. If they queued BEFORE the constraint create... actually the recompute happens against the live policy after merge, not the pre-queue snapshot. So the apply-time re-assert is actually correct — but the STORED digest in PolicyConfig itself drifts from canonical truth.

**Real impact:** Any external consumer reading `PolicyConfig.policy_preview_digest` and comparing it against their own canonical recompute will see a mismatch even though the policy is otherwise valid. The F-14 defense ("on-chain enforces what the user signed") is degraded — the stored digest is no longer the authoritative representation.

**Disposition:** OPEN — fix in Phase 2 fix-and-retest commit. Each of the 4 handlers must:
1. Recompute `policy_preview_digest` from the post-mutation policy state
2. Persist the new digest to `policy.policy_preview_digest`
3. Bump `policy.policy_version`

Add a regression test that walks: `create_instruction_constraints` → fetch `PolicyConfig.policy_preview_digest` → assert it matches the SDK-recomputed digest with `has_constraints=true`.

---

### MEDIUM — Engineer's failure count was wrong (15 claimed, 32 actual)

**Evidence:** `npx ts-mocha tests/security-exploits.ts tests/instruction-constraints.ts` returns 32 failing / 204 passing. Engineer reported "8 in security-exploits.ts + 7 in instruction-constraints.ts = 15".

**Breakdown of the 32:**
- ~20 are mechanical fixture migrations (DestinationNotAllowed + PolicyPreviewMismatch placeholder)
- **Several are real assertion-text regressions:**
  - `security-exploits.ts:8963` ("capability edge: max valid (2=Operator) accepted, 3 rejected"): test asserts old error name `InvalidPermissions (6036)`; program now emits `InvalidCapability (6079)`. Phase 2 contract change broke the test's hardcoded name.
  - `security-exploits.ts:5681` ("queuePolicyUpdate adds destination, agentTransfer to new dest succeeds"): test fails with `PolicyVersionMismatch (6057)` on agentTransfer — uses stale policy_version after apply. May indicate the apply path didn't bump policy_version correctly, OR test's policy_version fetch is racing.
- **5 in instruction-constraints.ts (Signed/Bitmask operators):** fail at `allocate_constraints_pda` with `AccountOwnedByWrongProgram (3007)`. Pre-existing test-sequencing latent bug surfaced by new test ordering. These match the "17 known out-of-scope" from Phase 1; expanded slightly by Phase 2 test order changes.

**Disposition:** OPEN — fix-and-retest must reconcile the 32 failures into 3 buckets: (a) mechanical fixture migrations to apply, (b) assertion-name updates to apply, (c) genuinely pre-existing failures to document.

---

### MEDIUM — `tests/toctou-security.ts:516, 551` stale `, false` strict_mode args

**Evidence:** `createConstraintsAccount(..., false)` and `queueConstraintsUpdateMultiIx(..., false)`. The trailing `false` was `strict_mode`, deleted in Stage 1 commit `d494408`. Pre-existing tech debt that Phase 2 commits touched the file without cleaning.

**Disposition:** OPEN — fix-and-retest must strip the trailing `, false` from these 2 sites + any other sites that grep `createConstraintsAccount\(.*,\s*false\)` finds across all test files.

---

### LOW — TS2589 line-shift in `tests/helpers/surfpool-setup.ts:773`

**Evidence:** Pre-existing Anchor type-depth issue at baseline (was at line 758 pre-Phase-2). The 2 new `initialize_vault` args (observe_only + preview_digest) pushed the type chain over Anchor 0.32.1's depth-50 limit, shifting the error line.

**Disposition:** DEFERRED — same root cause as pre-Phase-1 baseline. Track for v1.1 SDK cleanup. Not blocking.

---

## Attack vector scorecard

| # | Vector | Verdict |
|---|---|---|
| 1 | LiteSVM failure spot-check | **FAIL** — engineer count wrong (15 vs 32), some failures are real regressions not fixture issues |
| 2 | Surfpool + TOCTOU arg mismatches | **FAIL** — surfpool migration is complete (false positive in initial diagnostic), but toctou-security has 2 stale `, false` args from Stage 1 debt that Phase 2 should have cleaned |
| 3 | SDK ↔ on-chain digest cross-impl | **PASS** — byte-perfect parity on both hex fixtures (`29f9…b623` minimal + `33d7…8502` realistic) |
| 4 | apply_pending_policy re-assertion | **PASS with CAVEAT** — handler is correct, but sibling handlers break the invariant elsewhere (HIGH finding above) |
| 5 | observe_only check position | **PASS** — fires at `validate_and_authorize.rs:216-219`, before agent-paused / capability / protocol allowlist |
| 6 | Capability bound at all 3 ix sites | **PASS** — register_agent.rs:45, queue_agent_permissions_update.rs:68, apply_agent_permissions_update.rs:79 all enforce |
| 7 | destination_check.rs correctness | **PASS with CAVEAT** — only called in spending branch (intentional + documented; revisit at Phase 3 when non-spending DeFi flows expand) |
| 8 | IDL regen completeness | **PASS** — all 3 fields + 3 errors + 2 ix arg additions present in target/idl/sigil.json |

---

## Verdict: FIX-AND-RETEST

Phase 2 architecture is sound. Schema, SDK parity, F-14 enforcement at queue/apply, observe_only ordering, IDL completeness all check out. Two blocking items:

1. **HIGH — TA-19 digest staleness via sibling handlers** must be fixed. Adds 4 handler edits + 1 regression test.
2. **MEDIUM — 32-failure delta must be reconciled** (categorized into mechanical fixes vs assertion updates vs pre-existing) and the mechanical+assertion fixes applied.

Plus:
3. **MEDIUM — toctou-security.ts stale strict_mode args** — clean up the 2 known sites + grep for any others.
4. **LOW — TS2589** — track for v1.1.

Estimated fix-and-retest scope: ~2-3 hours of Engineer time + §RP-2 re-verify before marking Phase 2 complete.

---

**END OF Phase 2 silent-failure-hunter transcript**
