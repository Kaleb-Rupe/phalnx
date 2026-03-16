/**
 * Constraint Builder — Encoding Utilities
 *
 * Little-endian byte encoding for constraint values.
 */

import { ConstraintOperator } from "../generated/index.js";
import type { FieldType } from "./types.js";

/** Encode a bigint as little-endian bytes (u64 = 8 bytes, i64 = 8 bytes). */
export function bigintToLeBytes(value: bigint, byteLength: number): Uint8Array {
  const buf = new Uint8Array(byteLength);
  let v = value;
  for (let i = 0; i < byteLength; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

/** Encode a number as little-endian bytes (u8=1, u16=2, u32=4). */
export function numberToLeBytes(value: number, byteLength: number): Uint8Array {
  const buf = new Uint8Array(byteLength);
  let v = value;
  for (let i = 0; i < byteLength; i++) {
    buf[i] = v & 0xff;
    v >>>= 8;
  }
  return buf;
}

/** Map string operator names to ConstraintOperator enum values. */
export function mapOperator(op: string): ConstraintOperator {
  switch (op) {
    case "eq":
      return ConstraintOperator.Eq;
    case "ne":
      return ConstraintOperator.Ne;
    case "gte":
      return ConstraintOperator.Gte;
    case "lte":
      return ConstraintOperator.Lte;
    case "gteSigned":
      return ConstraintOperator.GteSigned;
    case "lteSigned":
      return ConstraintOperator.LteSigned;
    case "bitmask":
      return ConstraintOperator.Bitmask;
    default:
      throw new Error(`Unknown constraint operator: ${op}`);
  }
}

/** Return byte width for a FieldType. */
export function fieldTypeToSize(type: FieldType): number {
  switch (type) {
    case "u8":
    case "bool":
      return 1;
    case "u16":
      return 2;
    case "u32":
      return 4;
    case "u64":
    case "i64":
      return 8;
    case "pubkey":
      return 32;
  }
}
