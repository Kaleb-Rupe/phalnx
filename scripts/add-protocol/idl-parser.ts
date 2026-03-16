/**
 * Protocol Onboarding Pipeline — IDL Parser with Offset Computation
 *
 * Parses an Anchor IDL and computes byte offsets for instruction data fields.
 * Detects variable-length boundaries (Option, Vec, string, bytes) and aborts
 * if any constrainable field falls after such a boundary.
 */

import type {
  AnchorIdl,
  AnnotationConfig,
  IdlField,
  IdlType,
  ParsedField,
  ParsedAccount,
  ParsedInstruction,
} from "./types.js";
import { computeDiscriminator } from "./discriminator.js";
import { buildIdlTypeMap } from "./idl-helpers.js";

// ─── Borsh Type-to-Size Map (no padding) ────────────────────────────────────

const PRIMITIVE_SIZES: Record<string, number> = {
  u8: 1,
  u16: 2,
  u32: 4,
  u64: 8,
  u128: 16,
  i8: 1,
  i16: 2,
  i32: 4,
  i64: 8,
  i128: 16,
  bool: 1,
  publicKey: 32,
  f32: 4,
  f64: 8,
};

/**
 * Maps Borsh type to our schema FieldType for constraint encoding.
 */
function borshToFieldType(size: number): string {
  switch (size) {
    case 1: return "u8";
    case 2: return "u16";
    case 4: return "u32";
    case 8: return "u64";
    case 16: return "u128";
    case 32: return "pubkey";
    default: return `bytes${size}`;
  }
}

// ─── Variable-Length Detection ───────────────────────────────────────────────

interface SizeResult {
  size: number;
  isVariableLength: boolean;
}

/**
 * Compute the byte size of an IDL type.
 * Returns { size, isVariableLength } where isVariableLength means the type
 * has no fixed size (Option, Vec, string, bytes).
 */
function computeTypeSize(
  type: IdlType,
  typeMap: Map<string, { kind: string; fields?: IdlField[] }>,
): SizeResult {
  // Primitive types
  if (typeof type === "string") {
    if (type === "string" || type === "bytes") {
      return { size: -1, isVariableLength: true };
    }
    const size = PRIMITIVE_SIZES[type];
    if (size !== undefined) {
      return { size, isVariableLength: false };
    }
    throw new Error(`Unknown primitive type: ${type}`);
  }

  // Defined type — resolve from IDL types array
  if ("defined" in type) {
    const typeDef = typeMap.get(type.defined.name);
    if (!typeDef) {
      throw new Error(
        `Undefined type reference: ${type.defined.name}. Available: ${Array.from(typeMap.keys()).join(", ")}`,
      );
    }
    if (typeDef.kind === "enum") {
      // Borsh enums: 1 byte discriminator for simple enums
      return { size: 1, isVariableLength: false };
    }
    // Struct: sum all field sizes
    let totalSize = 0;
    for (const field of typeDef.fields ?? []) {
      const fieldResult = computeTypeSize(field.type, typeMap);
      if (fieldResult.isVariableLength) {
        return { size: -1, isVariableLength: true };
      }
      totalSize += fieldResult.size;
    }
    return { size: totalSize, isVariableLength: false };
  }

  // Option<T> — variable length (1 byte when None, 1 + T when Some)
  if ("option" in type) {
    return { size: -1, isVariableLength: true };
  }

  // Vec<T> — variable length
  if ("vec" in type) {
    return { size: -1, isVariableLength: true };
  }

  // Fixed array [T; N] — fixed size
  if ("array" in type) {
    const [innerType, count] = type.array;
    const innerResult = computeTypeSize(innerType, typeMap);
    if (innerResult.isVariableLength) {
      return { size: -1, isVariableLength: true };
    }
    return { size: innerResult.size * count, isVariableLength: false };
  }

  throw new Error(`Unsupported IDL type: ${JSON.stringify(type)}`);
}

// ─── Main Parser ────────────────────────────────────────────────────────────

/**
 * Parse all annotated instructions from the IDL and compute byte offsets.
 *
 * @throws If any constrainable field appears after a variable-length boundary.
 */
export function parseIdl(
  config: AnnotationConfig,
  idl: AnchorIdl,
): ParsedInstruction[] {
  // Build type lookup
  const typeMap = buildIdlTypeMap(idl);

  const results: ParsedInstruction[] = [];

  for (const ixAnnotation of config.instructions) {
    const idlIx = idl.instructions.find((ix) => ix.name === ixAnnotation.idlName);
    if (!idlIx) {
      throw new Error(
        `IDL instruction "${ixAnnotation.idlName}" not found — should have been caught by validator`,
      );
    }

    // Compute discriminator
    const discriminator = computeDiscriminator(
      ixAnnotation.idlName,
      idlIx,
      config.protocol.idlFormat,
      config.protocol.idlCase,
    );

    // Build constrainable field lookup
    const constrainableFieldNames = new Set(
      (ixAnnotation.constrainableFields ?? []).map((cf) => cf.idlFieldName),
    );
    const fieldNameToSchemaName = new Map(
      (ixAnnotation.constrainableFields ?? []).map((cf) => [cf.idlFieldName, cf.schemaFieldName]),
    );

    // Walk args and compute offsets
    let offset = 8; // start after 8-byte discriminator
    let hitVariableBoundary = false;
    const variableLengthAfter = ixAnnotation.variableLengthAfter;
    const parsedFields: ParsedField[] = [];
    const allArgs: { name: string; offset: number; size: number; type: string }[] = [];

    for (const arg of idlIx.args) {
      const sizeResult = computeTypeSize(arg.type, typeMap);

      // Check for variable-length boundary
      if (sizeResult.isVariableLength) {
        hitVariableBoundary = true;
      }

      // If we haven't hit variable length, this field has a known offset
      if (!hitVariableBoundary && !sizeResult.isVariableLength) {
        const fieldType = borshToFieldType(sizeResult.size);

        // Check if this arg is also inside a defined struct
        if (typeof arg.type === "object" && "defined" in arg.type) {
          // Expand struct fields with their sub-offsets
          const typeDef = typeMap.get(arg.type.defined.name);
          if (typeDef?.fields) {
            let subOffset = offset;
            for (const subField of typeDef.fields) {
              const subSize = computeTypeSize(subField.type, typeMap);
              const subType = borshToFieldType(subSize.size);

              allArgs.push({
                name: subField.name,
                offset: subOffset,
                size: subSize.size,
                type: subType,
              });

              if (constrainableFieldNames.has(subField.name)) {
                parsedFields.push({
                  name: subField.name,
                  schemaFieldName: fieldNameToSchemaName.get(subField.name) ?? subField.name,
                  offset: subOffset,
                  size: subSize.size,
                  type: subType,
                  constrainable: true,
                });
              }

              subOffset += subSize.size;
            }
          }
        } else {
          allArgs.push({
            name: arg.name,
            offset,
            size: sizeResult.size,
            type: fieldType,
          });

          if (constrainableFieldNames.has(arg.name)) {
            parsedFields.push({
              name: arg.name,
              schemaFieldName: fieldNameToSchemaName.get(arg.name) ?? arg.name,
              offset,
              size: sizeResult.size,
              type: fieldType,
              constrainable: true,
            });
          }
        }

        offset += sizeResult.size;
      } else if (sizeResult.isVariableLength) {
        // Can't compute offset for this or subsequent args
        allArgs.push({
          name: arg.name,
          offset: -1,
          size: -1,
          type: "variable",
        });
      }

      // Check if any constrainable field was requested after variable boundary
      if (hitVariableBoundary && constrainableFieldNames.has(arg.name)) {
        throw new Error(
          `ABORT: Constrainable field "${arg.name}" in instruction "${ixAnnotation.idlName}" ` +
          `appears after a variable-length boundary. Offsets cannot be computed reliably.`,
        );
      }

      // Check if we've passed the variableLengthAfter marker
      if (variableLengthAfter && arg.name === variableLengthAfter) {
        hitVariableBoundary = true;
      }
    }

    // Compute accounts
    const constrainableAccountNames = new Set(
      (ixAnnotation.constrainableAccounts ?? []).map((ca) => ca.name),
    );
    const parsedAccounts: ParsedAccount[] = [];

    for (let i = 0; i < idlIx.accounts.length; i++) {
      const acct = idlIx.accounts[i];
      if (constrainableAccountNames.has(acct.name)) {
        parsedAccounts.push({ name: acct.name, index: i });
      }
    }

    results.push({
      idlName: ixAnnotation.idlName,
      sdkName: ixAnnotation.sdkName,
      actionType: ixAnnotation.actionType,
      isSpending: ixAnnotation.isSpending,
      category: ixAnnotation.category,
      discriminator,
      fields: parsedFields,
      accounts: parsedAccounts,
      dataSize: offset, // total computed data size (valid only if no variable-length)
      allArgs,
    });
  }

  return results;
}
