/**
 * Constraint Builder — Type Definitions
 *
 * Three-layer abstraction:
 *   ProtocolSchema    → protocol-specific instruction knowledge
 *   ProtocolRuleConfig → dashboard-produced JSON config
 *   ProtocolDescriptor → protocol-specific rule compiler
 */

import type { Address, ReadonlyUint8Array } from "@solana/kit";
import type {
  AccountConstraintArgs,
  ConstraintEntryArgs,
  DataConstraintArgs,
} from "../generated/index.js";

// ─── Instruction Schema (protocol-specific knowledge) ─────────────────────

export type FieldType =
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "i64"
  | "bool"
  | "pubkey";

export interface InstructionFieldSchema {
  /** Field name, e.g. "sizeAmount" */
  name: string;
  /** Byte offset in instruction data (includes 8-byte discriminator) */
  offset: number;
  /** Determines byte width */
  type: FieldType;
  /** Explicit byte width */
  size: number;
}

export interface InstructionSchema {
  /** Instruction name, e.g. "openPosition" */
  name: string;
  /** 8-byte discriminator */
  discriminator: Uint8Array;
  /** Constrainable fields in instruction data */
  fields: InstructionFieldSchema[];
  /** Named account indices, e.g. { market: 7 } */
  accounts: Record<string, number>;
  /** Total instruction data size */
  dataSize: number;
}

export interface ProtocolSchema {
  protocolId: string;
  programAddress: Address;
  instructions: Map<string, InstructionSchema>;
}

// ─── Rule Config (dashboard-produced, JSON-serializable) ──────────────────

export interface ProtocolRuleConfig {
  protocolId: string;
  actionRules: ActionRule[];
  strictMode?: boolean;
}

export interface ActionRule {
  /** Which instructions this rule applies to */
  actions: string[];
  /** Rule type, e.g. "maxPositionSize", "allowedMarkets", "allowAll" */
  type: string;
  /** Type-specific params (empty {} for allowAll) */
  params: Record<string, unknown>;
}

// ─── Compiled Constraint (intermediate) ───────────────────────────────────

export interface CompiledConstraint {
  /** Which instruction discriminators this constraint applies to */
  discriminators: Uint8Array[];
  /** Data constraints to apply (AND within an entry) */
  dataConstraints: DataConstraintArgs[];
  /** Account constraints to apply */
  accountConstraints: AccountConstraintArgs[];
}

// ─── Descriptor (protocol-specific compiler) ──────────────────────────────

export interface ProtocolDescriptor {
  protocolId: string;
  programAddress: Address;
  schema: ProtocolSchema;
  /** Compile a single ActionRule into intermediate constraints */
  compileRule(rule: ActionRule): CompiledConstraint[];
  /** Return metadata for all supported rule types (for dashboard rendering) */
  getRuleTypes(): RuleTypeMetadata[];
  /** Validate a rule config, return error messages */
  validateRule(rule: ActionRule): string[];
  /** Check strict_mode coverage and return warnings (e.g. missing risk-reducing actions) */
  checkStrictModeWarnings?(config: {
    actionRules: ActionRule[];
    strictMode?: boolean;
  }): string[];
}

// ─── Build Result ─────────────────────────────────────────────────────────

export interface ConstraintBuildResult {
  entries: ConstraintEntryArgs[];
  strictMode: boolean;
  budget: {
    used: number;
    total: number;
    perProtocol: Record<string, number>;
  };
  summary: string[];
  warnings: string[];
}

// ─── Dashboard Metadata (for UI rendering) ────────────────────────────────

export interface RuleTypeMetadata {
  type: string;
  displayName: string;
  description: string;
  applicableActions: string[];
  params: RuleParamMeta[];
}

export interface RuleParamMeta {
  name: string;
  type: "number" | "bigint" | "select" | "multiselect";
  label: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  required?: boolean;
}
