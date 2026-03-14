/**
 * Protocol Onboarding Pipeline — Discriminator Extraction & Cross-Check
 *
 * Three-source discriminator verification:
 * 1. IDL JSON discriminator field (new-format Anchor IDLs)
 * 2. SHA256("global:snake_name")[0..8] computation
 * 3. Codama-generated file extraction (post-generation)
 *
 * Reuses patterns from scripts/verify-codama-staleness.ts.
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import type { IdlInstruction } from "./types.js";

/**
 * Compute the Anchor discriminator: SHA256("global:snake_name")[0..8]
 */
export function computeAnchorDiscriminator(snakeName: string): Uint8Array {
  const hash = createHash("sha256").update(`global:${snakeName}`).digest();
  return new Uint8Array(hash.buffer, hash.byteOffset, 8);
}

/**
 * Convert camelCase to snake_case.
 */
export function camelToSnake(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Convert snake_case to camelCase.
 */
export function snakeToCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Compute the discriminator for an instruction, using the best available source.
 *
 * Priority:
 * 1. IDL JSON `discriminator` field (new-format) — authoritative
 * 2. SHA256("global:snake_name")[0..8] computation (old-format fallback)
 */
export function computeDiscriminator(
  idlName: string,
  idlIx: IdlInstruction,
  idlFormat: "new" | "old",
  idlCase: "snake" | "camel",
): Uint8Array {
  // Source 1: IDL discriminator field (new-format)
  if (idlFormat === "new" && idlIx.discriminator && Array.isArray(idlIx.discriminator)) {
    return new Uint8Array(idlIx.discriminator);
  }

  // Source 2: Compute from snake_case name
  const snakeName = idlCase === "snake" ? idlName : camelToSnake(idlName);
  return computeAnchorDiscriminator(snakeName);
}

/**
 * Extract discriminator bytes from a Codama-generated TypeScript file.
 * Looks for: _DISCRIMINATOR = new Uint8Array([ ... ])
 */
export function extractDiscriminatorFromFile(filePath: string): Uint8Array | null {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
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

/**
 * Compare two Uint8Arrays for equality.
 */
export function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Three-source cross-check for a single instruction's discriminator.
 *
 * @returns null if all sources agree, or an error message string
 */
export function crossCheckDiscriminator(
  idlName: string,
  idlIx: IdlInstruction,
  idlFormat: "new" | "old",
  idlCase: "snake" | "camel",
  codamaFilePath: string,
): string | null {
  const snakeName = idlCase === "snake" ? idlName : camelToSnake(idlName);
  const camelName = idlCase === "camel" ? idlName : snakeToCamel(idlName);

  // Source 1: IDL field (if available)
  let idlDiscriminator: Uint8Array | null = null;
  if (idlFormat === "new" && idlIx.discriminator && Array.isArray(idlIx.discriminator)) {
    idlDiscriminator = new Uint8Array(idlIx.discriminator);
  }

  // Source 2: SHA256 computation
  const computedDiscriminator = computeAnchorDiscriminator(snakeName);

  // Source 3: Codama generated file
  const codamaDiscriminator = extractDiscriminatorFromFile(codamaFilePath);

  // Cross-check: IDL vs computed (if IDL available)
  if (idlDiscriminator && !arraysEqual(idlDiscriminator, computedDiscriminator)) {
    return (
      `Discriminator mismatch for ${idlName}: ` +
      `IDL=[${Array.from(idlDiscriminator)}] vs ` +
      `computed=[${Array.from(computedDiscriminator)}]`
    );
  }

  // Cross-check: against Codama (if available)
  if (codamaDiscriminator) {
    const reference = idlDiscriminator ?? computedDiscriminator;
    if (!arraysEqual(reference, codamaDiscriminator)) {
      return (
        `Discriminator mismatch for ${idlName}: ` +
        `reference=[${Array.from(reference)}] vs ` +
        `codama=[${Array.from(codamaDiscriminator)}]`
      );
    }
  }

  return null; // all sources agree
}
