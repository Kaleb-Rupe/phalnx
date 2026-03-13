#!/usr/bin/env tsx
/**
 * CI Staleness Detection — Verify ALL Codama-generated discriminators.
 *
 * Two verification layers:
 * 1. IDL-based: Computes SHA256("global:<ix_name>")[0..8] from IDL, compares with generated code
 * 2. Schema-based: Compares constraint schema discriminators with generated exports
 *
 * Usage:
 *   npx tsx scripts/verify-codama-staleness.ts
 *
 * Exit codes:
 *   0 — All discriminators match
 *   1 — Discriminator mismatch detected (protocol upgrade?)
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ─── Schema imports (existing 20 checks) ──────────────────────────────────

import { FLASH_TRADE_SCHEMA } from "../sdk/kit/src/constraints/protocols/flash-trade-schema.js";
import { KAMINO_SCHEMA } from "../sdk/kit/src/constraints/protocols/kamino-schema.js";

// ─── Helpers ─────────────────────────────────────────────────────────────

function snakeToCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function camelToSnake(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function computeAnchorDiscriminator(ixName: string): Uint8Array {
  const hash = createHash("sha256").update(`global:${ixName}`).digest();
  return new Uint8Array(hash.buffer, hash.byteOffset, 8);
}

function extractDiscriminatorFromFile(filePath: string): Uint8Array | null {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  // Match: new Uint8Array([ 123, 45, ... ])
  const match = content.match(
    /_DISCRIMINATOR\s*=\s*new\s+Uint8Array\(\[\s*([\d\s,]+)\s*\]\)/,
  );
  if (!match) return null;
  const bytes = match[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => parseInt(s, 10));
  return new Uint8Array(bytes);
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ─── Protocol config ────────────────────────────────────────────────────

const PROTOCOLS = [
  {
    name: "flash-trade",
    idlPath: join("sdk", "kit", "idls", "perpetuals.json"),
    generatedDir: join(
      "sdk",
      "kit",
      "src",
      "generated",
      "protocols",
      "flash-trade",
      "instructions",
    ),
    // IDL uses snake_case instruction names
    idlCase: "snake" as const,
  },
  {
    name: "kamino",
    idlPath: join("sdk", "kit", "idls", "kamino-lending.json"),
    generatedDir: join(
      "sdk",
      "kit",
      "src",
      "generated",
      "protocols",
      "kamino",
      "instructions",
    ),
    // IDL uses camelCase instruction names
    idlCase: "camel" as const,
  },
];

// ─── Layer 1: IDL-based verification (ALL instructions) ─────────────────

let totalChecked = 0;
let totalPassed = 0;
let totalFailed = 0;
let totalMissing = 0;

console.log("═══ Layer 1: IDL → Generated Code Discriminator Check ═══\n");

for (const proto of PROTOCOLS) {
  const idl = JSON.parse(readFileSync(proto.idlPath, "utf-8"));
  const instructions = idl.instructions ?? [];
  let protoPassed = 0;
  let protoFailed = 0;
  let protoMissing = 0;

  for (const ix of instructions) {
    const idlName: string = ix.name;

    // Determine snake_case name for discriminator and camelCase name for file
    let snakeName: string;
    let camelName: string;

    if (proto.idlCase === "snake") {
      snakeName = idlName;
      camelName = snakeToCamel(idlName);
    } else {
      camelName = idlName;
      snakeName = camelToSnake(idlName);
    }

    const filePath = join(proto.generatedDir, `${camelName}.ts`);

    const expected = computeAnchorDiscriminator(snakeName);
    const actual = extractDiscriminatorFromFile(filePath);

    totalChecked++;

    if (!actual) {
      protoMissing++;
      totalMissing++;
      // Missing files are not failures — the IDL may have admin-only instructions
      // that aren't generated for the client
      continue;
    }

    if (arraysEqual(expected, actual)) {
      protoPassed++;
      totalPassed++;
    } else {
      protoFailed++;
      totalFailed++;
      console.error(
        `❌ MISMATCH: ${proto.name}/${snakeName}\n` +
          `   Expected: [${Array.from(expected).join(", ")}]\n` +
          `   Actual:   [${Array.from(actual).join(", ")}]`,
      );
    }
  }

  console.log(
    `  ${proto.name}: ${protoPassed} passed, ${protoFailed} failed, ${protoMissing} no generated file (of ${instructions.length} IDL instructions)`,
  );
}

// ─── Layer 2: Schema-based verification (constraint schemas) ────────────

console.log("\n═══ Layer 2: Constraint Schema → Generated Code Check ═══\n");

interface SchemaCheck {
  protocol: string;
  instruction: string;
  schema: Uint8Array;
  generated: Uint8Array;
}

const schemaChecks: SchemaCheck[] = [];

// Build schema checks from constraint schemas
for (const [name, schema] of FLASH_TRADE_SCHEMA.instructions) {
  const camelName = name; // Schema keys are already camelCase
  const filePath = join(PROTOCOLS[0].generatedDir, `${camelName}.ts`);
  const generated = extractDiscriminatorFromFile(filePath);
  if (generated) {
    schemaChecks.push({
      protocol: "flash-trade",
      instruction: name,
      schema: schema.discriminator,
      generated,
    });
  }
}

for (const [name, schema] of KAMINO_SCHEMA.instructions) {
  // Schema keys may map to different generated file names
  const nameMap: Record<string, string> = {
    depositCollateral: "depositObligationCollateral",
    borrowLiquidity: "borrowObligationLiquidity",
    repayLiquidity: "repayObligationLiquidity",
    withdrawCollateral:
      "withdrawObligationCollateralAndRedeemReserveCollateral",
  };
  const generatedName = nameMap[name] ?? name;
  const filePath = join(PROTOCOLS[1].generatedDir, `${generatedName}.ts`);
  const generated = extractDiscriminatorFromFile(filePath);
  if (generated) {
    schemaChecks.push({
      protocol: "kamino",
      instruction: name,
      schema: schema.discriminator,
      generated,
    });
  }
}

let schemaPassed = 0;
let schemaFailed = 0;

for (const check of schemaChecks) {
  if (arraysEqual(check.schema, check.generated)) {
    schemaPassed++;
  } else {
    schemaFailed++;
    console.error(
      `❌ SCHEMA MISMATCH: ${check.protocol}/${check.instruction}\n` +
        `   Schema:    [${Array.from(check.schema).join(", ")}]\n` +
        `   Generated: [${Array.from(check.generated).join(", ")}]`,
    );
  }
}

console.log(`  Schema checks: ${schemaPassed}/${schemaChecks.length} passed`);

// ─── Summary ─────────────────────────────────────────────────────────────

console.log(`\n═══ Summary ═══`);
console.log(
  `  IDL-based:    ${totalPassed}/${totalChecked} verified (${totalMissing} skipped, ${totalFailed} failed)`,
);
console.log(
  `  Schema-based: ${schemaPassed}/${schemaChecks.length} verified (${schemaFailed} failed)`,
);

if (totalFailed > 0 || schemaFailed > 0) {
  console.error(
    `\n❌ Discriminator mismatches detected!\n` +
      `Re-generate Codama types or update constraint schemas.`,
  );
  process.exit(1);
} else {
  console.log(`\n✅ All discriminators verified.`);
}
