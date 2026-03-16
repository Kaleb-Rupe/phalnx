/**
 * Protocol Onboarding Pipeline — YAML Annotation Validator
 *
 * Validates the YAML annotation file against the corresponding Anchor IDL.
 * Catches typos, missing fields, and structural errors before generation.
 */

import type {
  AnnotationConfig,
  AnchorIdl,
  IdlInstruction,
  IdlType,
  InstructionAnnotation,
} from "./types.js";
import { VALID_ACTION_TYPES, VALID_OPERATORS } from "./types.js";
import { buildIdlTypeMap } from "./idl-helpers.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a parsed YAML annotation against its IDL.
 * Returns errors (blocking) and warnings (informational).
 */
export function validateAnnotation(
  config: AnnotationConfig,
  idl: AnchorIdl,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Protocol meta ──────────────────────────────────────────────────────

  if (!config.protocol.id || typeof config.protocol.id !== "string") {
    errors.push("protocol.id is required and must be a string");
  }
  if (!config.protocol.programAddress || typeof config.protocol.programAddress !== "string") {
    errors.push("protocol.programAddress is required and must be a string");
  }
  if (!config.protocol.idlFile || typeof config.protocol.idlFile !== "string") {
    errors.push("protocol.idlFile is required and must be a string");
  }
  if (!["snake", "camel"].includes(config.protocol.idlCase)) {
    errors.push(`protocol.idlCase must be "snake" or "camel", got "${config.protocol.idlCase}"`);
  }
  if (!["new", "old"].includes(config.protocol.idlFormat)) {
    errors.push(`protocol.idlFormat must be "new" or "old", got "${config.protocol.idlFormat}"`);
  }

  // ── Build IDL lookups ─────────────────────────────────────────────────

  const idlInstructions = new Map<string, IdlInstruction>();
  for (const ix of idl.instructions) {
    idlInstructions.set(ix.name, ix);
  }

  const idlTypes = buildIdlTypeMap(idl);

  // ── Instructions ──────────────────────────────────────────────────────

  if (!Array.isArray(config.instructions) || config.instructions.length === 0) {
    errors.push("instructions array is required and must be non-empty");
    return { valid: false, errors, warnings };
  }

  const sdkNames = new Set<string>();

  for (const ix of config.instructions) {
    const prefix = `instructions[${ix.idlName}]`;

    // Check idlName exists in IDL
    if (!idlInstructions.has(ix.idlName)) {
      errors.push(
        `${prefix}: idlName "${ix.idlName}" not found in IDL. Available: ${Array.from(idlInstructions.keys()).join(", ")}`,
      );
      continue;
    }

    // Check sdkName uniqueness
    if (sdkNames.has(ix.sdkName)) {
      errors.push(`${prefix}: sdkName "${ix.sdkName}" is not unique`);
    }
    sdkNames.add(ix.sdkName);

    // Check actionType is valid
    if (!VALID_ACTION_TYPES.includes(ix.actionType as typeof VALID_ACTION_TYPES[number])) {
      errors.push(
        `${prefix}: actionType "${ix.actionType}" is not valid. Must be one of: ${VALID_ACTION_TYPES.join(", ")}`,
      );
    }

    // Get IDL instruction for field/account validation
    const idlIx = idlInstructions.get(ix.idlName)!;

    // Check constrainableFields exist in IDL args
    if (ix.constrainableFields) {
      for (const cf of ix.constrainableFields) {
        const argExists = findArgInInstruction(idlIx, cf.idlFieldName, idlTypes);
        if (!argExists) {
          errors.push(
            `${prefix}: constrainableFields "${cf.idlFieldName}" not found in IDL instruction args. Available: ${idlIx.args.map((a) => a.name).join(", ")}`,
          );
        }
      }
    }

    // Check constrainableAccounts exist in IDL accounts
    if (ix.constrainableAccounts) {
      for (const ca of ix.constrainableAccounts) {
        const acctExists = idlIx.accounts.some((a) => a.name === ca.name);
        if (!acctExists) {
          errors.push(
            `${prefix}: constrainableAccounts "${ca.name}" not found in IDL instruction accounts. Available: ${idlIx.accounts.map((a) => a.name).join(", ")}`,
          );
        }
      }
    }

    // Check variableLengthAfter references a real arg
    if (ix.variableLengthAfter !== null && ix.variableLengthAfter !== undefined) {
      const vlArg = idlIx.args.find((a) => a.name === ix.variableLengthAfter);
      if (!vlArg) {
        errors.push(
          `${prefix}: variableLengthAfter "${ix.variableLengthAfter}" not found in IDL args`,
        );
      } else {
        // Verify constrainable fields appear BEFORE variableLengthAfter
        validateFieldOrdering(ix, idlIx, errors, prefix);
      }
    }
  }

  // ── Rule Types ────────────────────────────────────────────────────────

  if (config.ruleTypes) {
    for (const rt of config.ruleTypes) {
      const prefix = `ruleTypes[${rt.type}]`;

      // Check operator validity
      if (!VALID_OPERATORS.includes(rt.operator as typeof VALID_OPERATORS[number])) {
        errors.push(
          `${prefix}: operator "${rt.operator}" is not valid. Must be one of: ${VALID_OPERATORS.join(", ")}`,
        );
      }

      // Check applicableActions reference valid sdkNames
      for (const action of rt.applicableActions) {
        if (!sdkNames.has(action)) {
          errors.push(
            `${prefix}: applicableActions "${action}" does not match any instruction sdkName`,
          );
        }
      }

      // Check fieldMapping keys match applicableActions
      if (rt.fieldMapping) {
        for (const key of Object.keys(rt.fieldMapping)) {
          if (!rt.applicableActions.includes(key)) {
            errors.push(
              `${prefix}: fieldMapping key "${key}" not in applicableActions`,
            );
          }
        }
      }
    }
  }

  // ── Action Categories ─────────────────────────────────────────────────

  if (config.actionCategories) {
    for (const [category, actions] of Object.entries(config.actionCategories)) {
      for (const action of actions) {
        if (!sdkNames.has(action)) {
          warnings.push(
            `actionCategories.${category}: "${action}" does not match any instruction sdkName`,
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Check whether a field name exists in an instruction's args,
 * including nested defined types (for Flash Trade OraclePrice pattern).
 */
function findArgInInstruction(
  ix: IdlInstruction,
  fieldName: string,
  typeMap: Map<string, { kind: string; fields?: { name: string; type: IdlType }[] }>,
): boolean {
  for (const arg of ix.args) {
    if (arg.name === fieldName) return true;
    // Check nested defined types
    if (typeof arg.type === "object" && "defined" in arg.type) {
      const typeDef = typeMap.get(arg.type.defined.name);
      if (typeDef?.fields) {
        for (const f of typeDef.fields) {
          if (f.name === fieldName) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Verify that all constrainable fields appear BEFORE the variableLengthAfter arg
 * in the IDL argument order.
 */
function validateFieldOrdering(
  ix: InstructionAnnotation,
  idlIx: IdlInstruction,
  errors: string[],
  prefix: string,
): void {
  const argNames = idlIx.args.map((a) => a.name);
  const vlIndex = argNames.indexOf(ix.variableLengthAfter!);

  if (vlIndex === -1) return; // already caught above

  for (const cf of ix.constrainableFields ?? []) {
    const fieldIndex = argNames.indexOf(cf.idlFieldName);
    if (fieldIndex === -1) continue; // already caught above
    if (fieldIndex > vlIndex) {
      errors.push(
        `${prefix}: constrainableField "${cf.idlFieldName}" appears AFTER variableLengthAfter "${ix.variableLengthAfter}" in IDL — offsets will be unreliable`,
      );
    }
  }
}
