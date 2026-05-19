# Phase 7 §RP Review — Summary

**Phase:** 7 — On-chain audit log (TA-15 + N1 temporal binding)
**Date:** 2026-05-19
**Verdict:** **CLEAR-TO-PROCEED** (after §RP-1 fix-up cycle; burst + sysvar-freshness behavioural tests explicitly deferred to Phase 7.1 / Phase 6.1 surfpool)

## Phase 7 commits

| # | Type | Subject | SHA |
|---|---|---|---|
| 0 | Pre-dispatch | docs(revamp): Phase 7 pre-dispatch — sync error-code tables for audit closure +1 | `149bd6d` |
| 1 | Account | feat(audit-log): create AuditLogSuccess + AuditLogRejected PDAs | `27b91a4` |
| 2 | Wire-up | feat(audit-log): write entries from 11 mutating instructions | `76d742a` |
| 3 | SDK | feat(sdk): fetchAuditLogSuccess + fetchAuditLogRejected helpers | `655a29f` |
| 4 | §RP-1 fix-up | fix(audit-log): §RP-1 close-up — FIX-1..FIX-5 (HIGH-1 + HIGH-2 + I-2 + I-3 + N-1) | _this commit_ |

## §RP-1 findings + dispositions

### silent-failure-hunter (2 HIGHs + 3 MEDs)

| ID | Severity | Title | Disposition |
|---|---|---|---|
| HIGH-1 | HIGH | `finalize_session.rs:1099` writes `AUDIT_DISC_VALIDATE=1` to REJECTED buffer for expired-finalize cranks, but `validate_and_authorize.rs` writes NO audit entries — so disc=1 in the rejected buffer was a forensic-correctness lie | RESOLVED in §RP-1 fix-up. Allocated `AUDIT_DISC_FINALIZE_REJECT = 16` in `state/audit_log_success.rs:46`, finalize_session now writes disc=16 on the REJECT path. Discriminator-allocation docstring updated (disc=1 now marked RESERVED — Phase 7 writes no entries from validate; future expansion slot). SDK and tests updated. |
| HIGH-2 | HIGH | `AuditEntry.target_protocol` is overloaded across 11 ix to hold mint/vault/agent/owner pubkeys — only finalize honors the "protocol" name; field-name lies | RESOLVED in §RP-1 fix-up. Renamed struct field `target_protocol` → `subject` on `AuditEntry` (Rust, IDL, Codama-regen TS, SDK helper, tests). Per-discriminator semantic table added to the struct's docstring at `state/audit_log_success.rs:74-92`. SDK exports a new `subjectBytes()` helper plus a deprecated `targetProtocolBytes()` alias for one-release compatibility. |
| MED-1 | MED | F-19 burst behavioural test — 65 expired-finalize cranks to verify rejected buffer wraps WITHOUT touching success buffer | DEFERRED to Phase 7.1 / Phase 6.1 surfpool. LiteSVM cannot drive 65 expired-session finalizes economically (each cycle costs ~30s of test time). Structural separation is asserted (PDA addresses, sizes) — the behavioural burst belongs in surfpool sandwich tests. |
| MED-2 | MED | sysvar-freshness behavioural test — assert that slot_hash bytes differ between two consecutive ix writes under realistic slot advancement | DEFERRED to Phase 7.1 / Phase 6.1 surfpool. LiteSVM does not advance `slot_hashes` sysvar per-ix the way a real validator does; the existing test asserts the deterministic LiteSVM-shaped invariant. |
| MED-3 | MED | Discriminator coverage matrix 6/15 (only 6 of 15 ix have explicit per-disc tests) | PARTIALLY ADDRESSED by FIX-4 wrap-test boundary assertion (which exercises freeze + reactivate + register at the wrap boundary). Remaining per-disc coverage deferred to Phase 7.1. |

### code-reviewer (3 important findings)

| ID | Severity | Title | Disposition |
|---|---|---|---|
| I-2 | IMPORTANT | No defense-in-depth `require_keys_eq!(log.vault, vault.key())` at `load_mut()?` sites — relies entirely on PDA seeds construction | RESOLVED in §RP-1 fix-up. Added `require_keys_eq!(log.vault, ctx.accounts.vault.key(), SigilError::ConstraintsVaultMismatch)` at all 12 `load_mut()?` write sites (11 success-log ix + 2 in finalize_session). Reuses existing error variant 6068 (`ConstraintsVaultMismatch` — semantically identical: "zero-copy account has wrong vault"). ZERO new error codes added per Phase 7 §4 reservation table. |
| I-3 | IMPORTANT | `tests/audit-log.ts` wrap test only asserts LAST entry identity; off-by-one regression where `head+1` used instead of `head` would still pass | RESOLVED in §RP-1 fix-up. Added positive assertion on `chronological[0].discriminator == DISC_FREEZE` (the 4th written entry = oldest retained after 131 writes wrap a 128-cap buffer). Boundary comment documents the expected drop pattern. |
| N-1 | NIT | 6 dead test imports (Transaction, COUNT_OFFSET, DISC_VALIDATE, DISC_FINALIZE_SUCCESS, DISC_DEPOSIT, DISC_POLICY_APPLY) | RESOLVED in §RP-1 fix-up. Confirmed `tracker` is in-use (kept); deleted the 6 dead imports/consts. |

### Engineer-disclosed observations

| ID | Severity | Title | Disposition |
|---|---|---|---|
| AUDIT-DOC | INFO (caught during §RP-1) | `targetProtocolBytes()` SDK helper used a misleading name in its docstring | RESOLVED — replaced with `subjectBytes()` (canonical), `targetProtocolBytes()` kept as `@deprecated` alias for one release. Both return `entry.subject`. |
| IDL-REGEN | INFO | IDL regenerated via `anchor idl build --out target/idl/sigil.json` (nightly toolchain) to propagate the `target_protocol` → `subject` rename; Codama then rendered the SDK types | Pure mechanical regen. Cosmetic diffs (Unicode em-dash normalisation, slot_hashes_sysvar doc removed in earlier work) accompany the substantive `subject` field rename. |

## Deferred to Phase 7.1

| ID | Title | Reason for deferral |
|---|---|---|
| MED-1 | F-19 burst behavioural test (65 expired-finalize cranks → rejected wrap, success unchanged) | LiteSVM economics — each expired-session cycle ~30s; surfpool sandwich tests can batch |
| MED-2 | Sysvar freshness test (slot_hash bytes differ between two consecutive ix writes in real validator) | LiteSVM doesn't advance `slot_hashes` per-ix; surfpool / devnet exercises this naturally |
| MED-3 | Discriminator coverage gap-fill for the remaining 9 of 15 ix (deposit, withdraw, pause, unpause, revoke, policy_apply, constraints_apply, finalize_success, finalize_reject) | Phase 7.1 scope — adversarial coverage matrix expansion |
| N-2 | `AuditEntry.discriminator` field-name vs Anchor account-discriminator naming clash | Cosmetic; defer to Phase 9 SDK redesign |
| N-3 | `read_slot_hash_head` zero-default on empty sysvar | Blocked by address constraint, low risk; leave as-is |
| N-4 | Edge case tests (count = CAPACITY-1, count > CAPACITY by single-step assertions, byte-offset pin in TS) | Phase 7.1 scope |
| N-5 | User-facing rent doc drift (~0.058 SOL spec → ~0.18 SOL actual due to widened `_padding`) | Docs PR — separate from on-chain fix-up |

## Final test state (post §RP-1 fix-up)

| Gate | Pre-fix-up | Post-fix-up | Status |
|---|---|---|---|
| `cargo test --lib --features devnet-testing` | 230 / 0 | **230 / 0** | unchanged |
| `npx ts-mocha tests/audit-log.ts` | 9 / 0 | **9 / 0** | unchanged (assertions strengthened, test count stable) |
| `sdk/kit` test suite | 1740 / 0 | **1740 / 0** | unchanged (Codama-regen propagates field rename transparently) |
| `pnpm verify:error-drift` | OK 103 | **OK 103** | unchanged (ZERO new error codes — reused `ConstraintsVaultMismatch`) |
| Expanded LiteSVM (sigil + audit-log + missing-coverage + jupiter + jupiter-lend + flash-trade + security-exploits + instruction-constraints + toctou-security + analytics-counters + policy-digest-invariant + post-assertions-r-variants + post-assertions-sandwich + sysvar-scan-bound + cu-budget) | 401 / 0 + (10 pre-existing in instruction-constraints) | **465 / 0** (+ 10 pre-existing in `instruction-constraints` V2 OR-logic block — `RangeError: encoding overruns Uint8Array`; PRE-EXISTING, unrelated to audit-log) | green |

## Verdict: **CLEAR-TO-PROCEED**

§RP-1 close-up complete. Phase 7 ships with:
- HIGH-1 / HIGH-2 closed in source-of-truth Rust + propagated to IDL + Codama-regen TS + SDK helpers + tests
- I-2 / I-3 / N-1 closed
- Zero new error codes (`pnpm verify:error-drift` OK 103)
- Phase 7.1 deferral list above documents the residual MED-1 / MED-2 / MED-3 / N-2..N-5 with explicit rationale

Phase 8 (ownership-transfer) and the burst behavioural tests can proceed in parallel using surfpool.
