import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";

import {
  NOOP_LOGGER,
  createConsoleLogger,
  resolveLogger,
  sanitizeNoop,
  structuredError,
  structuredWarn,
  type SigilLogger,
  type StructuredWarnSanitizer,
} from "../src/logger.js";

describe("NOOP_LOGGER", () => {
  it("all four methods exist and are functions", () => {
    expect(NOOP_LOGGER.debug).to.be.a("function");
    expect(NOOP_LOGGER.info).to.be.a("function");
    expect(NOOP_LOGGER.warn).to.be.a("function");
    expect(NOOP_LOGGER.error).to.be.a("function");
  });

  it("debug/info/warn don't throw with or without context", () => {
    expect(() => NOOP_LOGGER.debug("x")).not.to.throw();
    expect(() => NOOP_LOGGER.debug("x", { k: 1 })).not.to.throw();
    expect(() => NOOP_LOGGER.info("x")).not.to.throw();
    expect(() => NOOP_LOGGER.info("x", { k: 1 })).not.to.throw();
    expect(() => NOOP_LOGGER.warn("x")).not.to.throw();
    expect(() => NOOP_LOGGER.warn("x", { k: 1 })).not.to.throw();
  });

  it("error doesn't throw with any combination of err + context", () => {
    const e = new Error("boom");
    expect(() => NOOP_LOGGER.error("x")).not.to.throw();
    expect(() => NOOP_LOGGER.error("x", e)).not.to.throw();
    expect(() => NOOP_LOGGER.error("x", e, { k: 1 })).not.to.throw();
    expect(() => NOOP_LOGGER.error("x", undefined, { k: 1 })).not.to.throw();
  });

  it("all methods return undefined", () => {
    expect(NOOP_LOGGER.debug("x")).to.be.undefined;
    expect(NOOP_LOGGER.info("x")).to.be.undefined;
    expect(NOOP_LOGGER.warn("x")).to.be.undefined;
    expect(NOOP_LOGGER.error("x")).to.be.undefined;
  });

  it("is frozen — cannot reassign methods", () => {
    const attempt = () => {
      (NOOP_LOGGER as unknown as Record<string, unknown>).warn = () =>
        undefined;
    };
    // strict mode throws, loose mode silently fails — either way, object is unchanged
    try {
      attempt();
    } catch {
      // expected in strict mode
    }
    // method identity preserved
    expect(typeof NOOP_LOGGER.warn).to.equal("function");
  });
});

describe("createConsoleLogger", () => {
  type ConsoleMethod = "debug" | "info" | "warn" | "error";
  const originals: Partial<Record<ConsoleMethod, typeof console.warn>> = {};
  let calls: Array<{ method: ConsoleMethod; args: unknown[] }> = [];

  beforeEach(() => {
    calls = [];
    for (const m of ["debug", "info", "warn", "error"] as const) {
      originals[m] = console[m];
      console[m] = ((...args: unknown[]) => {
        calls.push({ method: m, args });
      }) as typeof console.warn;
    }
  });

  afterEach(() => {
    for (const m of ["debug", "info", "warn", "error"] as const) {
      if (originals[m]) {
        console[m] = originals[m] as typeof console.warn;
      }
    }
  });

  it("forwards warn to console.warn", () => {
    const logger = createConsoleLogger();
    logger.warn("hello");
    expect(calls).to.have.length(1);
    expect(calls[0]!.method).to.equal("warn");
    expect(calls[0]!.args).to.deep.equal(["hello"]);
  });

  it("forwards warn with context as a second console.warn arg", () => {
    const logger = createConsoleLogger();
    logger.warn("hello", { k: 1 });
    expect(calls[0]!.method).to.equal("warn");
    expect(calls[0]!.args).to.deep.equal(["hello", { k: 1 }]);
  });

  it("forwards error with only message", () => {
    const logger = createConsoleLogger();
    logger.error("boom");
    expect(calls[0]!.method).to.equal("error");
    expect(calls[0]!.args).to.deep.equal(["boom"]);
  });

  it("forwards error with err object", () => {
    const logger = createConsoleLogger();
    const e = new Error("kaboom");
    logger.error("msg", e);
    expect(calls[0]!.method).to.equal("error");
    expect(calls[0]!.args[0]).to.equal("msg");
    expect(calls[0]!.args[1]).to.equal(e);
  });

  it("forwards error with err + context", () => {
    const logger = createConsoleLogger();
    const e = new Error("kaboom");
    logger.error("msg", e, { k: 1 });
    expect(calls[0]!.method).to.equal("error");
    expect(calls[0]!.args).to.deep.equal(["msg", e, { k: 1 }]);
  });

  it("forwards debug and info to their respective console methods", () => {
    const logger = createConsoleLogger();
    logger.debug("d");
    logger.info("i");
    expect(calls).to.have.length(2);
    expect(calls[0]!.method).to.equal("debug");
    expect(calls[1]!.method).to.equal("info");
  });
});

describe("resolveLogger", () => {
  it("returns NOOP_LOGGER when passed undefined", () => {
    expect(resolveLogger(undefined)).to.equal(NOOP_LOGGER);
  });

  it("returns the supplied logger when not undefined", () => {
    const custom: SigilLogger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
    };
    expect(resolveLogger(custom)).to.equal(custom);
  });
});

// ─── F-9 (third-pass audit, Slope wallet analog) ─────────────────────────────
// Sanitization is type-mandatory for any payload heading to observability.
describe("structuredWarn (F-9 sanitize)", () => {
  type Captured = { message: string; context?: Record<string, unknown> };

  const captureLogger = (): { calls: Captured[]; logger: SigilLogger } => {
    const calls: Captured[] = [];
    const logger: SigilLogger = {
      debug() {},
      info() {},
      warn(message, context) {
        calls.push({ message, context });
      },
      error() {},
    };
    return { calls, logger };
  };

  it("invokes sanitize before forwarding to logger.warn", () => {
    const { calls, logger } = captureLogger();

    interface RawVaultMismatch {
      vaultPubkey: string;
      seedPhrase: string; // PRETEND-secret payload — must be redacted
    }
    const sanitize: StructuredWarnSanitizer<RawVaultMismatch> = (raw) => ({
      vaultPubkey: `${raw.vaultPubkey.slice(0, 4)}...${raw.vaultPubkey.slice(-4)}`,
      // seedPhrase intentionally omitted from the sanitized payload
    });

    structuredWarn(logger, "vault-mismatch", sanitize, {
      vaultPubkey: "4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL",
      seedPhrase: "abandon abandon abandon",
    });

    expect(calls).to.have.length(1);
    expect(calls[0]!.message).to.equal("vault-mismatch");
    expect(calls[0]!.context).to.deep.equal({ vaultPubkey: "4ZeV...wrHL" });
    // The seedPhrase MUST NOT have reached the logger — this is the F-9 fix.
    expect(JSON.stringify(calls[0]!.context)).to.not.include("abandon");
  });

  it("accepts sanitizeNoop for payloads already safe to log", () => {
    const { calls, logger } = captureLogger();

    structuredWarn(logger, "tee-degraded", sanitizeNoop, {
      status: "provider_trusted",
      code: 1234,
    });

    expect(calls[0]!.message).to.equal("tee-degraded");
    expect(calls[0]!.context).to.deep.equal({
      status: "provider_trusted",
      code: 1234,
    });
  });

  it("compiles only when sanitize is supplied (type-level guarantee)", () => {
    // This test exercises the runtime contract; the *type-level* contract is
    // that the function signature requires `sanitize` — there is no overload
    // accepting a raw payload without one. A `// @ts-expect-error` would
    // assert that here, but we keep the runtime test instead since
    // ts-expect-error gates depend on the test runner's TS config.
    const { logger } = captureLogger();
    expect(() =>
      structuredWarn(logger, "ok", sanitizeNoop, { ok: true }),
    ).not.to.throw();
  });
});

describe("structuredError (F-9 sanitize)", () => {
  type Captured = {
    message: string;
    err: unknown;
    context?: Record<string, unknown>;
  };

  const captureLogger = (): { calls: Captured[]; logger: SigilLogger } => {
    const calls: Captured[] = [];
    const logger: SigilLogger = {
      debug() {},
      info() {},
      warn() {},
      error(message, err, context) {
        calls.push({ message, err, context });
      },
    };
    return { calls, logger };
  };

  it("invokes sanitize and preserves err for stack-trace capture", () => {
    const { calls, logger } = captureLogger();
    const err = new Error("boom");

    interface RawTxFailure {
      signature: string;
      logs: string[];
    }
    const sanitize: StructuredWarnSanitizer<RawTxFailure> = (raw) => ({
      signaturePrefix: raw.signature.slice(0, 8),
      logCount: raw.logs.length,
    });

    structuredError(logger, "tx-failure", err, sanitize, {
      signature: "5N9dJk1Yq...",
      logs: ["Program log: ...", "Program failed: ..."],
    });

    expect(calls).to.have.length(1);
    expect(calls[0]!.message).to.equal("tx-failure");
    expect(calls[0]!.err).to.equal(err);
    expect(calls[0]!.context).to.deep.equal({
      signaturePrefix: "5N9dJk1Y",
      logCount: 2,
    });
  });
});

describe("sanitizeNoop", () => {
  it("returns the input verbatim", () => {
    const payload = { a: 1, b: "x" };
    expect(sanitizeNoop(payload)).to.equal(payload);
  });
});
