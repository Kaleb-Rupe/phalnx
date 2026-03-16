/**
 * Protocol Onboarding Pipeline — Shared IDL Helpers
 *
 * Extracted from yaml-validator.ts and idl-parser.ts to eliminate
 * duplicated IDL type map construction and Codama path building.
 */

import { join } from "node:path";
import type { AnchorIdl, IdlField } from "./types.js";
import { snakeToCamel } from "./discriminator.js";

/**
 * Build a lookup map from IDL type definitions.
 * Used by both the YAML validator (field existence checks) and
 * the IDL parser (struct size computation).
 */
export function buildIdlTypeMap(
  idl: AnchorIdl,
): Map<string, { kind: string; fields?: IdlField[] }> {
  const map = new Map<string, { kind: string; fields?: IdlField[] }>();
  if (idl.types) {
    for (const t of idl.types) {
      map.set(t.name, t.type);
    }
  }
  return map;
}

/**
 * Build the expected Codama-generated instruction file path.
 * Used by verify.ts in both Check 1 and Check 4.
 */
export function codamaInstructionPath(
  codamaDir: string,
  idlName: string,
  idlCase: "snake" | "camel",
): string {
  const camelName = idlCase === "snake" ? snakeToCamel(idlName) : idlName;
  return join(codamaDir, "instructions", `${camelName}.ts`);
}
