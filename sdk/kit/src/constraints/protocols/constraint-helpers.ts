/**
 * Shared constraint helpers for protocol descriptors.
 *
 * Extracted from flash-trade-descriptor.ts to prevent copy-paste duplication
 * across protocol descriptors. Every descriptor needs these three functions.
 */

import type { ReadonlyUint8Array } from "@solana/kit";
import { ConstraintOperator } from "../../generated/index.js";
import type { DataConstraintArgs } from "../../generated/index.js";
import { bigintToLeBytes } from "../encoding.js";
import type { InstructionSchema, ProtocolSchema } from "../types.js";

/**
 * Look up an instruction schema by action name, throwing if not found.
 */
export function getSchema(
  schema: ProtocolSchema,
  action: string,
): InstructionSchema {
  const ix = schema.instructions.get(action);
  if (!ix) {
    throw new Error(`Unknown ${schema.protocolId} action: ${action}`);
  }
  return ix;
}

/**
 * Build an Eq data constraint matching an 8-byte discriminator at offset 0.
 */
export function makeDiscriminatorConstraint(
  disc: Uint8Array,
): DataConstraintArgs {
  return {
    offset: 0,
    operator: ConstraintOperator.Eq,
    value: disc as ReadonlyUint8Array,
  };
}

/**
 * Build an Lte data constraint for a named field in an instruction schema.
 */
export function makeLteConstraint(
  schema: InstructionSchema,
  fieldName: string,
  maxValue: bigint,
): DataConstraintArgs {
  const field = schema.fields.find((f) => f.name === fieldName);
  if (!field) {
    throw new Error(
      `Field "${fieldName}" not found in ${schema.name}. Available: ${schema.fields.map((f) => f.name).join(", ")}`,
    );
  }
  return {
    offset: field.offset,
    operator: ConstraintOperator.Lte,
    value: bigintToLeBytes(maxValue, field.size) as ReadonlyUint8Array,
  };
}
