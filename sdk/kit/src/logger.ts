/**
 * SigilLogger — pluggable structured logger for `@usesigil/kit`.
 *
 * Every internal `console.warn` / `console.error` / `console.debug` in the
 * SDK routes through an injected `SigilLogger`. Consumers embedding the
 * SDK into their own application decide where that output goes — a
 * Pino/Bunyan/Winston instance, an OpenTelemetry span, a custom appender,
 * or the bundled `NOOP_LOGGER` that discards everything.
 *
 * Default behavior: `NOOP_LOGGER`. No output is emitted unless the
 * consumer explicitly opts in. This matters because the SDK is embedded
 * in TEE-signed agent workflows where stray stdout/stderr can leak
 * sensitive fields (vault addresses, mint addresses, cap values) to
 * unintended destinations.
 *
 * For local development and test suites, `createConsoleLogger()` returns
 * a drop-in forwarder that emits to `console.*`.
 *
 * Rationale: see the plan in
 * `.claude/worktrees/<wt>/Plans/recursive-snuggling-reddy.md` step A5.
 * This replaces raw `console.*` calls scattered across 13 files.
 */

/** Structured logger interface. All methods are side-effect-only. */
export interface SigilLogger {
  /** Diagnostic messages — verbose, disabled by default. */
  debug(message: string, context?: Record<string, unknown>): void;
  /** Informational messages — nominal operational events. */
  info(message: string, context?: Record<string, unknown>): void;
  /** Warnings — unexpected but recoverable conditions. */
  warn(message: string, context?: Record<string, unknown>): void;
  /**
   * Errors — failures the caller should know about. The `err` parameter
   * is the originating exception, if any; it is logged separately from
   * `context` to encourage structured-field reporting.
   */
  error(
    message: string,
    err?: unknown,
    context?: Record<string, unknown>,
  ): void;
}

// ---------------------------------------------------------------------------
// NOOP logger — zero-output default
// ---------------------------------------------------------------------------

const noop = (): void => undefined;

/**
 * `NOOP_LOGGER` — discards every log call. Exported as a `const` so
 * consumers may pass it explicitly; also used internally as the fallback
 * when a `SigilClient` / `OwnerClient` is constructed without a logger.
 */
export const NOOP_LOGGER: SigilLogger = Object.freeze({
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
});

// ---------------------------------------------------------------------------
// Console logger — opt-in forwarder to `console.*`
// ---------------------------------------------------------------------------

/**
 * `createConsoleLogger` — opt-in logger that forwards to `console.*`.
 *
 * Use in test suites and development when you want SDK output on stderr/
 * stdout. Not the default, because production consumers should inject
 * their own structured logger (pino, bunyan, otel, etc.) rather than
 * rely on `console`.
 */
export function createConsoleLogger(): SigilLogger {
  return {
    debug: (message, context) => {
      if (context !== undefined) {
        // eslint-disable-next-line no-console
        console.debug(message, context);
      } else {
        // eslint-disable-next-line no-console
        console.debug(message);
      }
    },
    info: (message, context) => {
      if (context !== undefined) {
        // eslint-disable-next-line no-console
        console.info(message, context);
      } else {
        // eslint-disable-next-line no-console
        console.info(message);
      }
    },
    warn: (message, context) => {
      if (context !== undefined) {
        // eslint-disable-next-line no-console
        console.warn(message, context);
      } else {
        // eslint-disable-next-line no-console
        console.warn(message);
      }
    },
    error: (message, err, context) => {
      if (err !== undefined && context !== undefined) {
        // eslint-disable-next-line no-console
        console.error(message, err, context);
      } else if (err !== undefined) {
        // eslint-disable-next-line no-console
        console.error(message, err);
      } else if (context !== undefined) {
        // eslint-disable-next-line no-console
        console.error(message, context);
      } else {
        // eslint-disable-next-line no-console
        console.error(message);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// resolveLogger — internal helper for SDK entry points
// ---------------------------------------------------------------------------

/**
 * Internal helper: if the caller supplied a logger, use it; otherwise
 * return the no-op default. All public SDK entry points (SigilClient,
 * OwnerClient, seal, shielded-fetch, etc.) should call this once during
 * construction so the rest of the module can assume a non-null logger.
 *
 * Marked public so subpackages (dashboard, custody) can reuse the same
 * resolution rule.
 */
export function resolveLogger(logger: SigilLogger | undefined): SigilLogger {
  return logger ?? NOOP_LOGGER;
}

// ---------------------------------------------------------------------------
// Module-level logger — leaf-utility fallback
// ---------------------------------------------------------------------------
//
// Some SDK internals (walk(), alt-loader, balance-tracker, dashboard
// reads, etc.) are called from deep in the stack where threading a
// per-call `logger` argument would require signature changes across
// many consumers. For these sites, the SDK uses a module-level logger
// that SigilClient / OwnerClient constructors set from config.logger
// during initialization.
//
// Default: NOOP_LOGGER — nothing is emitted until a consumer opts in.
//
// Trade-off: this is module-local mutable state. Tests that want to
// observe warnings should call `setSigilModuleLogger` in `beforeEach`
// and reset with `setSigilModuleLogger(NOOP_LOGGER)` in `afterEach`.
// The state is process-wide, so parallel test suites must NOT share a
// worker unless all cooperate on the reset.

let _sigilModuleLogger: SigilLogger = NOOP_LOGGER;

/**
 * Set the module-level logger used by leaf SDK utilities that don't
 * accept a per-call logger parameter.
 *
 * Called by `SigilClient.create()` / `new SigilClient()` / `OwnerClient`
 * constructors when `config.logger` is provided, so an application's
 * chosen logger reaches every corner of the SDK.
 */
export function setSigilModuleLogger(logger: SigilLogger): void {
  _sigilModuleLogger = logger;
}

/**
 * Read the current module-level logger. Internal SDK sites that cannot
 * thread a per-call logger should call this to emit warnings/errors.
 */
export function getSigilModuleLogger(): SigilLogger {
  return _sigilModuleLogger;
}

// ---------------------------------------------------------------------------
// Structured warn/error — Sentry-safe payloads (F-9 Slope wallet analog)
// ---------------------------------------------------------------------------
//
// The Slope wallet incident (Aug 2022, ~$8M lost) leaked seed phrases through
// Sentry breadcrumbs because raw mnemonic strings were passed into the
// in-app logger and forwarded verbatim to the observability backend. Any
// structured-warn payload that flows toward Sentry / Datadog / OpenTelemetry
// MUST be sanitized at the callsite, not "later" — once a payload reaches the
// logger transport it is too late.
//
// The third-pass adversarial review (F-9) flagged that the existing
// `SigilLogger.warn(msg, context?)` shape made `context` optional, so a
// callsite could quietly forget to redact. Forgetting is the failure mode
// that caused the Slope incident.
//
// `structuredWarn` / `structuredError` make sanitization a *type-level
// requirement*: the caller passes a `sanitize` function that returns the
// safe-to-log shape, plus the raw payload. The helper invokes `sanitize`
// on the raw payload before calling through to `logger.warn`/`logger.error`.
// There is no overload that lets a caller pass `raw` without `sanitize`.
//
// For payloads that are genuinely safe to log verbatim (already-redacted
// strings, pure status enums, etc.), the helper exports `sanitizeNoop` —
// a typed identity function — so the callsite still explicitly opts into
// "no sanitization needed". This keeps the audit trail visible: a
// `sanitizeNoop` import in a file is grep-able and reviewable; an absent
// `context` argument is not.

/**
 * Sanitizer for a structured-warn payload. Takes the raw payload and
 * returns a `Record<string, unknown>` that is safe to ship to an
 * observability backend (Sentry, Datadog, OpenTelemetry).
 *
 * **Contract:**
 * - MUST NOT include secrets (seed phrases, private keys, signed-but-not-
 *   yet-broadcast transactions, raw user input that may contain tokens).
 * - MUST NOT include PII unless the consumer's data-residency policy
 *   explicitly permits it for this backend.
 * - MAY include base58 vault PDAs, mint addresses, slot numbers, error
 *   codes, status enums — these are public on-chain data.
 * - SHOULD truncate long base58 strings (e.g., `"4ZeV...wrHL"`) when the
 *   backend has display-width constraints.
 */
export type StructuredWarnSanitizer<TRaw> = (
  raw: TRaw,
) => Record<string, unknown>;

/**
 * Identity sanitizer for payloads that are already safe to log verbatim.
 *
 * Use this ONLY when the raw payload is, by construction, free of secrets
 * and PII — for example, a pre-built `{ status: "degraded", code: 1234 }`
 * record. Importing `sanitizeNoop` makes the "no sanitization needed"
 * decision explicit and grep-able in code review.
 */
export const sanitizeNoop: StructuredWarnSanitizer<Record<string, unknown>> = (
  raw,
) => raw;

/**
 * Emit a structured warning with a *mandatory* sanitization step.
 *
 * The `sanitize` function runs on `raw` before the result is passed to
 * `logger.warn`. The TypeScript signature requires `sanitize` — there is
 * no overload that accepts a raw payload without one. For payloads that
 * are already safe to log verbatim, pass `sanitizeNoop`.
 *
 * @example Sentry-safe vault-mismatch warning
 * ```ts
 * structuredWarn(logger, "vault-mismatch", redactPubkey, {
 *   expected: vault.address,
 *   actual: tx.accounts.vault,
 * });
 * ```
 */
export function structuredWarn<TRaw>(
  logger: SigilLogger,
  message: string,
  sanitize: StructuredWarnSanitizer<TRaw>,
  raw: TRaw,
): void {
  logger.warn(message, sanitize(raw));
}

/**
 * Emit a structured error with a *mandatory* sanitization step. Same
 * contract as {@link structuredWarn} but routes to `logger.error` and
 * preserves the originating `err` for stack-trace capture.
 */
export function structuredError<TRaw>(
  logger: SigilLogger,
  message: string,
  err: unknown,
  sanitize: StructuredWarnSanitizer<TRaw>,
  raw: TRaw,
): void {
  logger.error(message, err, sanitize(raw));
}
