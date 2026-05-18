/**
 * @usesigil/kit/dashboard — Client-side PostAssertionEntry validator.
 *
 * Mirrors the on-chain `PostExecutionAssertions::validate_entries()` check
 * in `programs/sigil/src/state/post_assertions.rs:118`. Fails fast in the
 * dashboard before the caller burns an RPC round-trip on an entry the
 * program will reject.
 *
 * Pure function: no RPC, no I/O, no side effects. Safe to call in a render
 * loop or form handler.
 *
 * Every rejection path carries a human-readable message that includes the
 * offending entry index so callers can pinpoint the bad entry in a multi-
 * entry batch (Phase 2 PRD ISC-19).
 *
 * ## DxError compatibility
 *
 * {@link PostAssertionValidationError} is structurally a `DxError` — it has
 * numeric `code`, string `message`, and `recovery: string[]`. This means
 * the mutation wrapper does NOT need to wrap it via `toDxError` before
 * re-throwing; FE always sees the typed fields (`validationCode`,
 * `entryIndex`) intact alongside the standard DxError surface.
 *
 * @see programs/sigil/src/state/post_assertions.rs — source of truth
 */
import type { PostAssertionEntry } from "../generated/types/postAssertionEntry.js";

// ─── Constants (pinned to Rust source) ────────────────────────────────────
// These MUST match the Rust constants. If they drift, the validator will
// pass inputs the program then rejects (or vice-versa), producing confusing
// round-trip failures. Keep in sync with `programs/sigil/src/state/*.rs`.

/** `programs/sigil/src/state/post_assertions.rs:7` */
const MAX_POST_ASSERTION_ENTRIES = 4;
/** `programs/sigil/src/state/constraints.rs:9` */
const MAX_CONSTRAINT_VALUE_LEN = 32;

/** Operator IDs (0..=6) — see `programs/sigil/src/state/constraints.rs ConstraintOperator`. */
const MAX_OPERATOR_VALUE = 6;
/** AssertionMode IDs (0..=3) — see `programs/sigil/src/state/post_assertions.rs AssertionMode`. */
const MAX_ASSERTION_MODE_VALUE = 3;

/** Delta modes (MaxDecrease=1, MaxIncrease=2, NoChange=3) parse the snapshot as u64. */
const DELTA_MAX_VALUE_LEN = 8;

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Machine-readable validation failure codes.
 *
 * Callers can branch on these via `err.validationCode` to produce tier-
 * appropriate UI messaging without string-matching the human `message`
 * field. The enum ordering mirrors the on-chain check sequence so the
 * first failure a caller sees is also the first one `validate_entries`
 * would reject.
 */
export type PostAssertionValidationCode =
  | "entries_not_an_array"
  | "entries_contain_null"
  | "entry_count_out_of_range"
  | "value_len_out_of_range"
  | "expected_value_too_short"
  | "operator_out_of_range"
  | "assertion_mode_out_of_range"
  | "offset_out_of_range"
  | "cross_field_offset_b_out_of_range"
  | "cross_field_multiplier_bps_out_of_range"
  | "cross_field_flags_out_of_range"
  | "delta_mode_value_len_too_large"
  | "cross_field_value_len_too_large"
  | "cross_field_requires_absolute_mode"
  | "cross_field_multiplier_must_be_positive"
  | "cross_field_unknown_flags"
  | "cross_field_disabled_fields_must_be_zero";

/**
 * Numeric `DxError.code` for every PostAssertion validation failure.
 *
 * All validation-class failures share this single numeric code — the more
 * specific `validationCode` string discriminates. 7008 is the existing SDK
 * "PRECHECK_FAILED" bucket (see `dashboard/errors.ts` SIGIL_ERROR_TO_NUMERIC),
 * which is semantically correct: the client-side validator IS a pre-check
 * for the on-chain validate_entries call.
 */
export const DX_CODE_POST_ASSERTION_VALIDATION = 7008 as const;

/**
 * Thrown by {@link validatePostAssertionEntries} when an entry fails any
 * check the on-chain program would enforce.
 *
 * Structurally compatible with `DxError` — exposes `code: number`,
 * `message: string`, and `recovery: string[]` so FE can render the error
 * without re-wrapping. Also carries the typed `validationCode` (the
 * specific failure reason) and `entryIndex` (the zero-based index of the
 * offending entry, or `null` for batch-level failures).
 *
 * Mutation wrappers re-throw this instance directly — they do NOT wrap
 * via `toDxError`. Wrapping would collapse the typed fields into
 * `DX_ERROR_CODE_UNMAPPED` (7999), breaking the file docblock's promise
 * that the FE can branch on `validationCode`.
 */
export class PostAssertionValidationError extends Error {
  public readonly code: number;
  public readonly validationCode: PostAssertionValidationCode;
  public readonly entryIndex: number | null;
  public readonly recovery: string[];
  /**
   * Always `false` — this error is thrown at CLIENT validation time,
   * BEFORE any RPC round-trip. Present to satisfy the DxError structural
   * contract (every DxError carries `onChainReverted`; see FE↔BE
   * contract v2.2 C2). Pre-existing callers need no migration.
   */
  public readonly onChainReverted: boolean = false;

  constructor(
    validationCode: PostAssertionValidationCode,
    entryIndex: number | null,
    message: string,
  ) {
    super(message);
    this.name = "PostAssertionValidationError";
    this.code = DX_CODE_POST_ASSERTION_VALIDATION;
    this.validationCode = validationCode;
    this.entryIndex = entryIndex;
    this.recovery = [
      entryIndex !== null
        ? `Fix PostAssertion entry at index ${entryIndex} (${validationCode}) and retry.`
        : `Fix PostAssertion batch (${validationCode}) and retry.`,
    ];
    // Preserve prototype chain under ES5 target
    Object.setPrototypeOf(this, PostAssertionValidationError.prototype);
  }
}

/**
 * Validate a batch of PostAssertionEntry values against the exact rules
 * the on-chain program enforces.
 *
 * Throws on the FIRST failing check (same as the Rust `for entry in entries`
 * loop). Use a try/catch to recover; the error's `validationCode` +
 * `entryIndex` identify the offending entry.
 *
 * @param entries Batch to check. Must be 1..=4 entries.
 * @throws {PostAssertionValidationError} with the specific failure code.
 */
export function validatePostAssertionEntries(
  entries: readonly PostAssertionEntry[],
): void {
  // Input-shape guard: TS doesn't enforce runtime shape, so an `any` caller
  // can pass null/undefined/non-array without a compiler warning. Without
  // this, `entries.length` would throw a cryptic TypeError that `toDxError`
  // collapses to code 7999.
  if (!Array.isArray(entries)) {
    throw new PostAssertionValidationError(
      "entries_not_an_array",
      null,
      `PostAssertion entries must be an array, got ${entries === null ? "null" : typeof entries}`,
    );
  }

  // Batch-level: entry count must be 1..=MAX.
  if (entries.length === 0 || entries.length > MAX_POST_ASSERTION_ENTRIES) {
    throw new PostAssertionValidationError(
      "entry_count_out_of_range",
      null,
      `PostAssertion entry count must be 1..=${MAX_POST_ASSERTION_ENTRIES}, got ${entries.length}`,
    );
  }

  entries.forEach((entry, index) => {
    // Per-slot null guard — forEach skips truly empty slots but an array
    // literal `[null, validEntry]` yields `entry === null` at index 0.
    if (entry == null) {
      throw new PostAssertionValidationError(
        "entries_contain_null",
        index,
        `PostAssertion[${index}]: entry is ${entry === null ? "null" : "undefined"}`,
      );
    }
    validateSingleEntry(entry, index);
  });
}

// ─── Internal ─────────────────────────────────────────────────────────────

/**
 * Guard that rejects non-integer, out-of-range, non-finite, or negative
 * numeric field values at the validator layer — BEFORE Codama's u8/u16/u32
 * encoders would either silently truncate (`8.5` → `8`) or throw a
 * different error class (`-1` → SolanaError).
 *
 * Having a single typed rejection point means every invalid numeric input
 * surfaces as `PostAssertionValidationError` with the field's specific
 * `validationCode`, rather than a grab-bag of Codama runtime failures.
 */
function requireUintInRange(
  value: number,
  field: string,
  max: number,
  code: PostAssertionValidationCode,
  index: number,
): void {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > max
  ) {
    throw new PostAssertionValidationError(
      code,
      index,
      `PostAssertion[${index}]: ${field} must be an integer 0..=${max}, got ${JSON.stringify(value)} (${typeof value})`,
    );
  }
}

function validateSingleEntry(entry: PostAssertionEntry, index: number): void {
  // Strict numeric shape checks — integer, non-negative, fits the on-chain
  // field width. Catch non-integer (e.g. 8.5) and negative (-1) inputs that
  // one-sided `> MAX` comparisons would miss.
  requireUintInRange(
    entry.offset,
    "offset",
    0xffff,
    "offset_out_of_range",
    index,
  );
  requireUintInRange(
    entry.valueLen,
    "value_len",
    MAX_CONSTRAINT_VALUE_LEN,
    "value_len_out_of_range",
    index,
  );
  requireUintInRange(
    entry.operator,
    "operator",
    MAX_OPERATOR_VALUE,
    "operator_out_of_range",
    index,
  );
  requireUintInRange(
    entry.assertionMode,
    "assertion_mode",
    MAX_ASSERTION_MODE_VALUE,
    "assertion_mode_out_of_range",
    index,
  );
  // CrossFieldLte field range checks DELETED in Phase 1 Option A demolition.

  // value_len must additionally be >= 1 (the shared range check allows 0;
  // on-chain requires > 0 because a zero-length value is a semantic no-op).
  if (entry.valueLen === 0) {
    throw new PostAssertionValidationError(
      "value_len_out_of_range",
      index,
      `PostAssertion[${index}]: value_len must be 1..=${MAX_CONSTRAINT_VALUE_LEN}, got 0`,
    );
  }

  // expected_value must be at least `value_len` bytes. Callers that pass
  // a shorter buffer would have the on-chain program reject the entry —
  // catch here instead.
  if (entry.expectedValue.length < entry.valueLen) {
    throw new PostAssertionValidationError(
      "expected_value_too_short",
      index,
      `PostAssertion[${index}]: expected_value has ${entry.expectedValue.length} bytes but value_len=${entry.valueLen} (must be >= value_len)`,
    );
  }

  // Delta modes (1/2/3) compare the pre/post snapshot as u64 — so the
  // expected-value payload must fit in 8 bytes. The on-chain program
  // enforces this; we mirror the check here.
  if (entry.assertionMode >= 1 && entry.assertionMode <= 3) {
    if (entry.valueLen > DELTA_MAX_VALUE_LEN) {
      throw new PostAssertionValidationError(
        "delta_mode_value_len_too_large",
        index,
        `PostAssertion[${index}]: delta assertion_mode=${entry.assertionMode} requires value_len <= ${DELTA_MAX_VALUE_LEN}, got ${entry.valueLen}`,
      );
    }
  }

  // CrossFieldLte validation block DELETED in Phase 1 Option A demolition.
  // The B3 fields (crossFieldOffsetB, crossFieldMultiplierBps, crossFieldFlags)
  // no longer exist on PostAssertionEntry — Codama-regenerated type omits them
  // after Rust struct deletion. The on-chain validate_entries() check is
  // similarly stripped of B3 logic.
}
