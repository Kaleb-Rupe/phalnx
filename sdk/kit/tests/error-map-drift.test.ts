/**
 * error-map-drift.test.ts — Phase 9 Batch D (ISC-54, ISC-104).
 *
 * Forward-looking ratchet. Closes the H-NEW-2 silent-miss class identified
 * in the Phase 0-5 audit, where Phase 6 added 6 on-chain error codes
 * (6097-6102) but the hand-maintained ON_CHAIN_ERROR_MAP in
 * `src/agent-errors.ts` only carried entries through 6096. The agent-side
 * SDK then routed the new codes through the FATAL/Unknown fallback instead
 * of returning the proper retry / recovery context.
 *
 * This test compares three sources of truth:
 *   1. `target/idl/sigil.json` — the canonical on-chain error surface.
 *   2. `src/errors/agent-errors.generated.ts` — auto-generated from (1).
 *   3. `src/agent-errors.ts` — hand-maintained map carrying the rich
 *      category / retryable / recovery_actions[] shape.
 *
 * Drift between (1) and (2) means someone changed the IDL but didn't
 * rerun `pnpm -C sdk/kit codegen:errors`. Drift between (1)/(2) and (3)
 * means someone added an on-chain error but didn't add the hand-maintained
 * mapping — exactly the H-NEW-2 attack surface.
 *
 * The count is derived from the IDL — NOT hardcoded — so future Phase
 * additions don't require updating this test.
 */

import { describe, it } from "mocha";
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IDL_ERROR_COUNT,
  IDL_ERROR_MAP,
  IDL_ERROR_MAX,
  IDL_ERROR_MIN,
} from "../src/errors/agent-errors.generated.js";
import {
  ON_CHAIN_ERROR_MAP,
  SIGIL_ON_CHAIN_ERROR_MAX,
  SIGIL_ON_CHAIN_ERROR_MIN,
} from "../src/agent-errors.js";

const __filename = fileURLToPath((import.meta as { url: string }).url);
const __dirname = dirname(__filename);
const IDL_PATH = resolve(__dirname, "../../../target/idl/sigil.json");

interface IdlError {
  code: number;
  name: string;
}

function loadIdlErrors(): readonly IdlError[] {
  const raw = readFileSync(IDL_PATH, "utf8");
  const idl = JSON.parse(raw) as { errors?: IdlError[] };
  const errors = idl.errors ?? [];
  return errors.slice().sort((a, b) => a.code - b.code);
}

describe("error-map-drift — IDL ↔ generated ↔ hand-maintained", () => {
  const idlErrors = loadIdlErrors();

  it("generated map count matches the IDL count (regenerate if this fails)", () => {
    expect(IDL_ERROR_COUNT, "regenerated count").to.equal(idlErrors.length);
    expect(Object.keys(IDL_ERROR_MAP)).to.have.lengthOf(idlErrors.length);
  });

  it("generated map min/max match the IDL extremes", () => {
    expect(IDL_ERROR_MIN).to.equal(idlErrors[0]!.code);
    expect(IDL_ERROR_MAX).to.equal(idlErrors[idlErrors.length - 1]!.code);
  });

  it("every IDL error code is present in the generated map", () => {
    const missing: number[] = [];
    for (const e of idlErrors) {
      if (!IDL_ERROR_MAP[e.code]) {
        missing.push(e.code);
      }
    }
    expect(missing, `IDL codes missing from generated map: ${missing.join(", ")}`).to.have.lengthOf(0);
  });

  it("generated map names match the IDL names byte-for-byte", () => {
    const mismatches: string[] = [];
    for (const e of idlErrors) {
      const entry = IDL_ERROR_MAP[e.code];
      if (entry && entry.name !== e.name) {
        mismatches.push(`${e.code}: IDL=${e.name} vs generated=${entry.name}`);
      }
    }
    expect(mismatches, `Name drift: ${mismatches.join("; ")}`).to.have.lengthOf(0);
  });

  it("hand-maintained ON_CHAIN_ERROR_MAP covers every IDL code", () => {
    const missing: number[] = [];
    for (const e of idlErrors) {
      // System hooks and chain-side anchor reserved codes < SIGIL_ON_CHAIN_ERROR_MIN
      // would never be in Sigil's hand-map; skip those by definition.
      if (e.code < SIGIL_ON_CHAIN_ERROR_MIN) continue;
      if (!(e.code in ON_CHAIN_ERROR_MAP)) {
        missing.push(e.code);
      }
    }
    expect(
      missing,
      `Hand-maintained map missing entries for: ${missing.join(", ")}. ` +
        "Add full {category, retryable, recovery_actions[]} entries to " +
        "src/agent-errors.ts before merging the new on-chain code.",
    ).to.have.lengthOf(0);
  });

  it("SIGIL_ON_CHAIN_ERROR_MAX matches the actual IDL max", () => {
    // Only Sigil-range errors count toward SIGIL_ON_CHAIN_ERROR_MAX.
    const sigilCodes = idlErrors
      .map((e) => e.code)
      .filter((c) => c >= SIGIL_ON_CHAIN_ERROR_MIN);
    const actualMax = sigilCodes[sigilCodes.length - 1]!;
    expect(SIGIL_ON_CHAIN_ERROR_MAX).to.equal(actualMax);
  });

  it("ON_CHAIN_ERROR_MAP entries all carry a name and message", () => {
    const violations: string[] = [];
    for (const [code, entry] of Object.entries(ON_CHAIN_ERROR_MAP)) {
      if (!entry.name || entry.name.length === 0) {
        violations.push(`${code}: empty name`);
      }
      if (!entry.message || entry.message.length === 0) {
        violations.push(`${code}: empty message`);
      }
    }
    expect(violations, `Hand-map shape violations: ${violations.join("; ")}`).to.have.lengthOf(0);
  });
});
