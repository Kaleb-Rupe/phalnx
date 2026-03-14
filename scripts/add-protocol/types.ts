/**
 * Protocol Onboarding Pipeline — Type Definitions
 *
 * TypeScript interfaces mirroring the YAML annotation schema.
 * Used by the YAML validator, IDL parser, and all generators.
 */

// ─── YAML Annotation Schema ────────────────────────────────────────────────

export interface AnnotationConfig {
  protocol: ProtocolMeta;
  instructions: InstructionAnnotation[];
  ruleTypes: RuleTypeAnnotation[];
  actionCategories: Record<string, string[]>;
  markets?: Record<string, Record<string, string>>;
  prerequisites?: Record<string, string[]>;
}

export interface ProtocolMeta {
  id: string;
  displayName: string;
  programAddress: string;
  idlFile: string;
  idlCase: "snake" | "camel";
  idlFormat: "new" | "old";
}

export interface InstructionAnnotation {
  idlName: string;
  sdkName: string;
  actionType: string;
  isSpending: boolean;
  category: "spending" | "riskReducing" | "sizeConstrained" | "collateralConstrained" | "orderSize";
  variableLengthAfter: string | null;
  constrainableFields: ConstrainableFieldAnnotation[];
  constrainableAccounts: ConstrainableAccountAnnotation[];
}

export interface ConstrainableFieldAnnotation {
  idlFieldName: string;
  schemaFieldName: string;
}

export interface ConstrainableAccountAnnotation {
  name: string;
}

export interface RuleTypeAnnotation {
  type: string;
  displayName: string;
  description: string;
  applicableActions: string[];
  params: RuleParamAnnotation[];
  fieldMapping: Record<string, string>;
  constraintType: "data" | "account";
  operator: string;
}

export interface RuleParamAnnotation {
  name: string;
  type: "bigint" | "multiselect" | "string";
  label: string;
  required: boolean;
  options?: { value: string; label: string }[];
}

// ─── IDL Types (Anchor IDL JSON) ───────────────────────────────────────────

export interface AnchorIdl {
  name?: string;
  version?: string;
  metadata?: { name?: string; version?: string };
  instructions: IdlInstruction[];
  accounts?: IdlAccount[];
  types?: IdlTypeDef[];
  events?: IdlEvent[];
}

export interface IdlInstruction {
  name: string;
  discriminator?: number[];
  accounts: IdlAccountItem[];
  args: IdlField[];
}

export interface IdlAccountItem {
  name: string;
  isMut?: boolean;
  isSigner?: boolean;
  docs?: string[];
}

export interface IdlField {
  name: string;
  type: IdlType;
}

export type IdlType =
  | "u8" | "u16" | "u32" | "u64" | "u128"
  | "i8" | "i16" | "i32" | "i64" | "i128"
  | "bool" | "publicKey" | "f32" | "f64"
  | "string" | "bytes"
  | { defined: { name: string } }
  | { option: IdlType }
  | { vec: IdlType }
  | { array: [IdlType, number] };

export interface IdlTypeDef {
  name: string;
  type: {
    kind: "struct" | "enum";
    fields?: IdlField[];
    variants?: { name: string; fields?: IdlField[] }[];
  };
}

export interface IdlAccount {
  name: string;
  discriminator?: number[];
}

export interface IdlEvent {
  name: string;
  fields?: IdlField[];
}

// ─── Parsed Output ──────────────────────────────────────────────────────────

export interface ParsedField {
  name: string;
  schemaFieldName: string;
  offset: number;
  size: number;
  type: string;
  constrainable: boolean;
}

export interface ParsedAccount {
  name: string;
  index: number;
}

export interface ParsedInstruction {
  idlName: string;
  sdkName: string;
  actionType: string;
  isSpending: boolean;
  category: string;
  discriminator: Uint8Array;
  fields: ParsedField[];
  accounts: ParsedAccount[];
  dataSize: number;
  allArgs: { name: string; offset: number; size: number; type: string }[];
}

// ─── CLI Options ────────────────────────────────────────────────────────────

export interface PipelineOptions {
  yamlPath: string;
  verifyOnly: boolean;
  schemaOnly: boolean;
  dryRun: boolean;
  force: boolean;
}

// ─── Valid Operators ────────────────────────────────────────────────────────

export const VALID_OPERATORS = [
  "eq", "ne", "gte", "lte", "gteSigned", "lteSigned", "bitmask",
] as const;

export type ValidOperator = typeof VALID_OPERATORS[number];

// ─── Valid ActionType names (from Codama-generated enum) ────────────────────

export const VALID_ACTION_TYPES = [
  "Swap",
  "OpenPosition",
  "ClosePosition",
  "IncreasePosition",
  "DecreasePosition",
  "Deposit",
  "Withdraw",
  "Transfer",
  "AddCollateral",
  "RemoveCollateral",
  "PlaceTriggerOrder",
  "EditTriggerOrder",
  "CancelTriggerOrder",
  "PlaceLimitOrder",
  "EditLimitOrder",
  "CancelLimitOrder",
  "SwapAndOpenPosition",
  "CloseAndSwapPosition",
  "CreateEscrow",
  "SettleEscrow",
  "RefundEscrow",
] as const;

export type ValidActionType = typeof VALID_ACTION_TYPES[number];
