// Constraint Builder — Public API

// Core types
export type {
  FieldType,
  InstructionFieldSchema,
  InstructionSchema,
  ProtocolSchema,
  ProtocolRuleConfig,
  ActionRule,
  CompiledConstraint,
  ProtocolDescriptor,
  ConstraintBuildResult,
  RuleTypeMetadata,
  RuleParamMeta,
} from "./types.js";

// Encoding utilities
export { bigintToLeBytes, numberToLeBytes, mapOperator, fieldTypeToSize } from "./encoding.js";

// Builder
export { ConstraintBuilder, ConstraintBudgetExceededError } from "./builder.js";

// Flash Trade
export { FLASH_TRADE_SCHEMA, FLASH_TRADE_PROGRAM } from "./protocols/flash-trade-schema.js";
export {
  SPENDING_ACTIONS,
  RISK_REDUCING_ACTIONS,
  SIZE_CONSTRAINED_ACTIONS,
  COLLATERAL_CONSTRAINED_ACTIONS,
  ORDER_SIZE_ACTIONS,
} from "./protocols/flash-trade-schema.js";
export {
  FlashTradeDescriptor,
  checkStrictModeWarnings,
} from "./protocols/flash-trade-descriptor.js";

// Kamino
export { KAMINO_SCHEMA, KAMINO_LENDING_PROGRAM } from "./protocols/kamino-schema.js";
export {
  KAMINO_SPENDING_ACTIONS,
  KAMINO_RISK_REDUCING_ACTIONS,
  KAMINO_AMOUNT_CONSTRAINED_ACTIONS,
} from "./protocols/kamino-schema.js";
export { KaminoDescriptor } from "./protocols/kamino-descriptor.js";
