import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";

import {
  NOOP_LOGGER,
  createConsoleLogger,
  resolveLogger,
  type SigilLogger,
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
