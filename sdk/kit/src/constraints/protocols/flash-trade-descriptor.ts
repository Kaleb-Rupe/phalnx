/**
 * Flash Trade Protocol Descriptor — Rule Compilation
 *
 * Implements ProtocolDescriptor for Flash Trade. Compiles 6 rule types
 * (allowAll, maxPositionSize, maxCollateral, allowedMarkets,
 * allowedCollateral, maxOrderSize) into CompiledConstraint[].
 *
 * Rule types:
 *   allowAll          → discriminator-only entry (no field constraints)
 *   maxPositionSize   → Lte on sizeAmount/sizeDelta
 *   maxCollateral     → Lte on collateralAmount/collateralDelta
 *   allowedMarkets    → AccountConstraint on market index
 *   allowedCollateral → AccountConstraint on collateralCustody index (openPosition only)
 *   maxOrderSize      → Lte on sizeAmount/deltaSizeAmount for orders
 */

import type { Address } from "@solana/kit";
import type { AccountConstraintArgs } from "../../generated/index.js";
import type {
  ActionRule,
  CompiledConstraint,
  ProtocolDescriptor,
  RuleTypeMetadata,
} from "../types.js";
import {
  COLLATERAL_CONSTRAINED_ACTIONS,
  FLASH_TRADE_SCHEMA,
  FLASH_TRADE_PROGRAM,
  ORDER_SIZE_ACTIONS,
  RISK_REDUCING_ACTIONS,
  SIZE_CONSTRAINED_ACTIONS,
} from "./flash-trade-schema.js";
import { FLASH_MARKET_MAP } from "../../integrations/config/flash-trade-markets.js";
import {
  getSchema as getSchemaGeneric,
  makeDiscriminatorConstraint,
  makeLteConstraint,
} from "./constraint-helpers.js";

// ─── Size Field Mapping ─────────────────────────────────────────────────────

/** Map instruction name to the field name that represents position size */
const SIZE_FIELD_MAP: Record<string, string> = {
  openPosition: "sizeAmount",
  increaseSize: "sizeDelta",
  swapAndOpen: "sizeAmount",
};

/** Map instruction name to the field name that represents collateral */
const COLLATERAL_FIELD_MAP: Record<string, string> = {
  openPosition: "collateralAmount",
  addCollateral: "collateralDelta",
};

/** Map instruction name to the field name that represents order size */
const ORDER_SIZE_FIELD_MAP: Record<string, string> = {
  placeLimitOrder: "sizeAmount",
  editLimitOrder: "sizeAmount",
  placeTriggerOrder: "deltaSizeAmount",
  editTriggerOrder: "deltaSizeAmount",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getSchema(action: string) {
  return getSchemaGeneric(FLASH_TRADE_SCHEMA, action);
}

// ─── Rule Compilers ─────────────────────────────────────────────────────────

function compileAllowAll(rule: ActionRule): CompiledConstraint[] {
  return rule.actions.map((action) => {
    const schema = getSchema(action);
    return {
      discriminators: [schema.discriminator],
      dataConstraints: [makeDiscriminatorConstraint(schema.discriminator)],
      accountConstraints: [],
    };
  });
}

function compileMaxPositionSize(rule: ActionRule): CompiledConstraint[] {
  const maxSize = BigInt(rule.params.maxSize as string | bigint);
  return rule.actions
    .filter((a) =>
      SIZE_CONSTRAINED_ACTIONS.includes(
        a as (typeof SIZE_CONSTRAINED_ACTIONS)[number],
      ),
    )
    .map((action) => {
      const schema = getSchema(action);
      const fieldName = SIZE_FIELD_MAP[action];
      return {
        discriminators: [schema.discriminator],
        dataConstraints: [
          makeDiscriminatorConstraint(schema.discriminator),
          makeLteConstraint(schema, fieldName, maxSize),
        ],
        accountConstraints: [],
      };
    });
}

function compileMaxCollateral(rule: ActionRule): CompiledConstraint[] {
  const maxAmount = BigInt(rule.params.maxAmount as string | bigint);
  return rule.actions
    .filter((a) =>
      COLLATERAL_CONSTRAINED_ACTIONS.includes(
        a as (typeof COLLATERAL_CONSTRAINED_ACTIONS)[number],
      ),
    )
    .map((action) => {
      const schema = getSchema(action);
      const fieldName = COLLATERAL_FIELD_MAP[action];
      return {
        discriminators: [schema.discriminator],
        dataConstraints: [
          makeDiscriminatorConstraint(schema.discriminator),
          makeLteConstraint(schema, fieldName, maxAmount),
        ],
        accountConstraints: [],
      };
    });
}

function compileAllowedMarkets(rule: ActionRule): CompiledConstraint[] {
  const marketKeys = rule.params.markets as string[];
  const results: CompiledConstraint[] = [];

  for (const action of rule.actions) {
    const schema = getSchema(action);
    const marketIndex = schema.accounts.market;
    if (marketIndex === undefined) continue; // skip actions without market account

    for (const marketKey of marketKeys) {
      const marketConfig = FLASH_MARKET_MAP[marketKey];
      if (!marketConfig) {
        throw new Error(
          `Unknown Flash Trade market: ${marketKey}. Available: ${Object.keys(FLASH_MARKET_MAP).join(", ")}`,
        );
      }
      results.push({
        discriminators: [schema.discriminator],
        dataConstraints: [makeDiscriminatorConstraint(schema.discriminator)],
        accountConstraints: [
          { index: marketIndex, expected: marketConfig.market },
        ],
      });
    }
  }

  return results;
}

function compileAllowedCollateral(rule: ActionRule): CompiledConstraint[] {
  // Collateral custody is determined by the market (long = target custody,
  // short = USDC custody). Use allowedMarkets to restrict collateral indirectly.
  // This rule type generates discriminator-only entries as a passthrough.
  return rule.actions
    .filter((a) => FLASH_TRADE_SCHEMA.instructions.has(a))
    .map((action) => {
      const schema = getSchema(action);
      return {
        discriminators: [schema.discriminator],
        dataConstraints: [makeDiscriminatorConstraint(schema.discriminator)],
        accountConstraints: [],
      };
    });
}

function compileMaxOrderSize(rule: ActionRule): CompiledConstraint[] {
  const maxSize = BigInt(rule.params.maxSize as string | bigint);
  return rule.actions
    .filter((a) =>
      ORDER_SIZE_ACTIONS.includes(a as (typeof ORDER_SIZE_ACTIONS)[number]),
    )
    .map((action) => {
      const schema = getSchema(action);
      const fieldName = ORDER_SIZE_FIELD_MAP[action];
      return {
        discriminators: [schema.discriminator],
        dataConstraints: [
          makeDiscriminatorConstraint(schema.discriminator),
          makeLteConstraint(schema, fieldName, maxSize),
        ],
        accountConstraints: [],
      };
    });
}

// ─── Descriptor ─────────────────────────────────────────────────────────────

const RULE_COMPILERS: Record<
  string,
  (rule: ActionRule) => CompiledConstraint[]
> = {
  allowAll: compileAllowAll,
  maxPositionSize: compileMaxPositionSize,
  maxCollateral: compileMaxCollateral,
  allowedMarkets: compileAllowedMarkets,
  allowedCollateral: compileAllowedCollateral,
  maxOrderSize: compileMaxOrderSize,
};

const marketOptions = Object.keys(FLASH_MARKET_MAP).map((k) => ({
  value: k,
  label: k,
}));

const RULE_TYPE_METADATA: RuleTypeMetadata[] = [
  {
    type: "allowAll",
    displayName: "Allow All Parameters",
    description:
      "Allow the action with any parameters (discriminator-only constraint).",
    applicableActions: [...Array.from(FLASH_TRADE_SCHEMA.instructions.keys())],
    params: [],
  },
  {
    type: "maxPositionSize",
    displayName: "Max Position Size",
    description:
      "Cap position size per instruction (Lte on sizeAmount/sizeDelta).",
    applicableActions: [...SIZE_CONSTRAINED_ACTIONS],
    params: [
      {
        name: "maxSize",
        type: "bigint",
        label: "Maximum position size (in base units)",
        required: true,
      },
    ],
  },
  {
    type: "maxCollateral",
    displayName: "Max Collateral",
    description: "Cap collateral amount per instruction.",
    applicableActions: [...COLLATERAL_CONSTRAINED_ACTIONS],
    params: [
      {
        name: "maxAmount",
        type: "bigint",
        label: "Maximum collateral (in base units)",
        required: true,
      },
    ],
  },
  {
    type: "allowedMarkets",
    displayName: "Allowed Markets",
    description: "Restrict to specific market PDAs via AccountConstraint.",
    applicableActions: [
      ...Array.from(FLASH_TRADE_SCHEMA.instructions.entries())
        .filter(([_, ix]) => ix.accounts.market !== undefined)
        .map(([name]) => name),
    ],
    params: [
      {
        name: "markets",
        type: "multiselect",
        label: "Allowed markets",
        options: marketOptions,
        required: true,
      },
    ],
  },
  {
    type: "allowedCollateral",
    displayName: "Allowed Collateral Tokens",
    description: "Restrict which collateral tokens can be used.",
    applicableActions: ["openPosition"],
    params: [
      {
        name: "tokens",
        type: "multiselect",
        label: "Allowed collateral tokens",
        options: [
          { value: "USDC", label: "USDC" },
          { value: "SOL", label: "SOL" },
          { value: "BTC", label: "BTC" },
          { value: "ETH", label: "ETH" },
          { value: "JitoSOL", label: "JitoSOL" },
        ],
        required: true,
      },
    ],
  },
  {
    type: "maxOrderSize",
    displayName: "Max Order Size",
    description: "Cap size for limit and trigger orders.",
    applicableActions: [...ORDER_SIZE_ACTIONS],
    params: [
      {
        name: "maxSize",
        type: "bigint",
        label: "Maximum order size (in base units)",
        required: true,
      },
    ],
  },
];

export const FlashTradeDescriptor: ProtocolDescriptor = {
  protocolId: "flash-trade",
  programAddress: FLASH_TRADE_PROGRAM,
  schema: FLASH_TRADE_SCHEMA,

  compileRule(rule: ActionRule): CompiledConstraint[] {
    const compiler = RULE_COMPILERS[rule.type];
    if (!compiler) {
      throw new Error(
        `Unknown Flash Trade rule type: ${rule.type}. Available: ${Object.keys(RULE_COMPILERS).join(", ")}`,
      );
    }
    return compiler(rule);
  },

  getRuleTypes(): RuleTypeMetadata[] {
    return RULE_TYPE_METADATA;
  },

  checkStrictModeWarnings: checkStrictModeWarnings,

  validateRule(rule: ActionRule): string[] {
    const errors: string[] = [];

    // Check rule type exists
    if (!RULE_COMPILERS[rule.type]) {
      errors.push(`Unknown rule type: ${rule.type}`);
      return errors;
    }

    // Check actions exist in schema
    for (const action of rule.actions) {
      if (!FLASH_TRADE_SCHEMA.instructions.has(action)) {
        errors.push(`Unknown action: ${action}`);
      }
    }

    // Type-specific validation
    switch (rule.type) {
      case "maxPositionSize":
      case "maxOrderSize": {
        if (rule.params.maxSize === undefined) {
          errors.push(`${rule.type} requires "maxSize" param`);
        }
        break;
      }
      case "maxCollateral": {
        if (rule.params.maxAmount === undefined) {
          errors.push(`maxCollateral requires "maxAmount" param`);
        }
        break;
      }
      case "allowedMarkets": {
        const markets = rule.params.markets;
        if (!Array.isArray(markets) || markets.length === 0) {
          errors.push(`allowedMarkets requires non-empty "markets" array`);
        } else {
          for (const m of markets) {
            if (!FLASH_MARKET_MAP[m as string]) {
              errors.push(`Unknown market: ${m}`);
            }
          }
        }
        break;
      }
    }

    return errors;
  },
};

/**
 * Check strict_mode coverage and return warnings for missing risk-reducing actions.
 *
 * In strict_mode, any action WITHOUT a rule is REJECTED. If the user configures
 * spending actions but forgets risk-reducing actions (close, decrease, cancel),
 * the agent can open positions but can't close them.
 */
export function checkStrictModeWarnings(config: {
  actionRules: ActionRule[];
  strictMode?: boolean;
}): string[] {
  if (!config.strictMode) return [];

  const warnings: string[] = [];
  const coveredActions = new Set<string>();

  for (const rule of config.actionRules) {
    for (const action of rule.actions) {
      coveredActions.add(action);
    }
  }

  // Check if any spending actions are covered
  const hasSpendingAction = SIZE_CONSTRAINED_ACTIONS.some((a) =>
    coveredActions.has(a),
  );

  if (!hasSpendingAction) return warnings;

  // Warn about missing risk-reducing actions
  const missingRiskReducing = RISK_REDUCING_ACTIONS.filter(
    (a) => !coveredActions.has(a),
  );

  if (missingRiskReducing.length > 0) {
    warnings.push(
      `strict_mode is ON but these risk-reducing actions have no rules (agent cannot execute them): ${missingRiskReducing.join(", ")}. ` +
        `Add an "allowAll" rule for these actions to prevent the agent from being unable to close positions.`,
    );
  }

  return warnings;
}
