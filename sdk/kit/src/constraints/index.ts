/**
 * @usesigil/kit/constraints — Constraint authoring subpath.
 *
 * Re-export module exposing the constraint PDA derivation, fetch, and
 * multi-instruction builder helpers under a stable public surface.
 *
 * The dashboard frontend imports from this subpath per the
 * FRONTEND-BACKEND-CONTRACT.md D1 covenant. Internally these symbols live
 * in `src/dashboard/` (PDA reads) and `src/dashboard/constraint-builders.ts`
 * (5-instruction allocation chain). This module flattens them into one
 * stable import path so consumers don't need to know the internal layout.
 *
 * **Firewall invariant:** kit must NEVER import from
 * `@sigil-trade/constraints` (a private GitHub Packages parser package).
 * Everything exported here is sourced from kit's own modules. The
 * `tests/firewall-invariant.test.ts` test enforces this at CI time.
 *
 * No new logic — pure re-export.
 */

// ─── PDA derivation + fetch helpers ────────────────────────────────────────
export {
  findConstraintsPda,
  findPendingConstraintsPda,
  findPendingCloseConstraintsPda,
  fetchConstraints,
  fetchPendingConstraintsUpdate,
  fetchPendingCloseConstraints,
  type ConstraintsPdaInfo,
} from "../dashboard/constraint-reads.js";

// ─── Multi-instruction builders (PR 1's Day-0 fix) ─────────────────────────
export {
  buildCreateConstraintsIxs,
  buildQueueConstraintsUpdateIxs,
  type BuildCreateConstraintsInput,
} from "../dashboard/constraint-builders.js";

// ─── ConstraintEntry type alias ────────────────────────────────────────────
export type { ConstraintEntry } from "../dashboard/types.js";
