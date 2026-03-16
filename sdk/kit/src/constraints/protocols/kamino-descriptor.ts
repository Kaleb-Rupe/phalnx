/**
 * Kamino Lending Protocol Descriptor — Rule Compilation
 *
 * Implements ProtocolDescriptor for Kamino Lending. Compiles 3 rule types
 * (allowAll, maxAmount, allowedReserves) into CompiledConstraint[].
 *
 * Rule types:
 *   allowAll          → discriminator-only entry (no field constraints)
 *   maxAmount         → Lte on amount field per action
 *   allowedReserves   → AccountConstraint on reserve index
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
  KAMINO_AMOUNT_CONSTRAINED_ACTIONS,
  KAMINO_LENDING_PROGRAM,
  KAMINO_RISK_REDUCING_ACTIONS,
  KAMINO_SCHEMA,
  KAMINO_SPENDING_ACTIONS,
} from "./kamino-schema.js";
import { KAMINO_RESERVES } from "../../integrations/config/kamino-markets.js";
import {
  getSchema as getSchemaGeneric,
  makeDiscriminatorConstraint,
  makeLteConstraint,
} from "./constraint-helpers.js";

// ─── Amount Field Mapping ────────────────────────────────────────────────────

const AMOUNT_FIELD_MAP: Record<string, string> = {
  depositCollateral: "collateralAmount",
  borrowLiquidity: "liquidityAmount",
  repayLiquidity: "liquidityAmount",
  withdrawCollateral: "collateralAmount",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getSchema(action: string) {
  return getSchemaGeneric(KAMINO_SCHEMA, action);
}

/** Map reserve key name to the account index for a given instruction */
function getReserveIndex(action: string): number | undefined {
  const schema = KAMINO_SCHEMA.instructions.get(action);
  if (!schema) return undefined;
  // Each instruction has a single reserve account with a unique name
  const reserveNames = Object.keys(schema.accounts);
  if (reserveNames.length === 0) return undefined;
  return schema.accounts[reserveNames[0]];
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

function compileMaxAmount(rule: ActionRule): CompiledConstraint[] {
  const maxAmount = BigInt(rule.params.maxAmount as string | bigint);
  return rule.actions
    .filter((a) =>
      KAMINO_AMOUNT_CONSTRAINED_ACTIONS.includes(
        a as (typeof KAMINO_AMOUNT_CONSTRAINED_ACTIONS)[number],
      ),
    )
    .map((action) => {
      const schema = getSchema(action);
      const fieldName = AMOUNT_FIELD_MAP[action];
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

function compileAllowedReserves(rule: ActionRule): CompiledConstraint[] {
  const reserveKeys = rule.params.reserves as string[];
  const results: CompiledConstraint[] = [];

  for (const action of rule.actions) {
    const schema = getSchema(action);
    const reserveIndex = getReserveIndex(action);
    if (reserveIndex === undefined) continue;

    for (const reserveKey of reserveKeys) {
      const reserveConfig = KAMINO_RESERVES[reserveKey];
      if (!reserveConfig) {
        throw new Error(
          `Unknown Kamino reserve: ${reserveKey}. Available: ${Object.keys(KAMINO_RESERVES).join(", ")}`,
        );
      }
      results.push({
        discriminators: [schema.discriminator],
        dataConstraints: [makeDiscriminatorConstraint(schema.discriminator)],
        accountConstraints: [
          { index: reserveIndex, expected: reserveConfig.reserve },
        ],
      });
    }
  }

  return results;
}

// ─── Descriptor ─────────────────────────────────────────────────────────────

const RULE_COMPILERS: Record<
  string,
  (rule: ActionRule) => CompiledConstraint[]
> = {
  allowAll: compileAllowAll,
  maxAmount: compileMaxAmount,
  allowedReserves: compileAllowedReserves,
};

const reserveOptions = Object.keys(KAMINO_RESERVES).map((k) => ({
  value: k,
  label: k,
}));

const RULE_TYPE_METADATA: RuleTypeMetadata[] = [
  {
    type: "allowAll",
    displayName: "Allow All Parameters",
    description:
      "Allow the action with any parameters (discriminator-only constraint).",
    applicableActions: [...Array.from(KAMINO_SCHEMA.instructions.keys())],
    params: [],
  },
  {
    type: "maxAmount",
    displayName: "Max Amount",
    description: "Cap the amount per instruction (Lte on amount field).",
    applicableActions: [...KAMINO_AMOUNT_CONSTRAINED_ACTIONS],
    params: [
      {
        name: "maxAmount",
        type: "bigint",
        label: "Maximum amount (in base units)",
        required: true,
      },
    ],
  },
  {
    type: "allowedReserves",
    displayName: "Allowed Reserves",
    description: "Restrict to specific lending reserves via AccountConstraint.",
    applicableActions: [...Array.from(KAMINO_SCHEMA.instructions.keys())],
    params: [
      {
        name: "reserves",
        type: "multiselect",
        label: "Allowed reserves",
        options: reserveOptions,
        required: true,
      },
    ],
  },
];

export const KaminoDescriptor: ProtocolDescriptor = {
  protocolId: "kamino",
  programAddress: KAMINO_LENDING_PROGRAM,
  schema: KAMINO_SCHEMA,

  compileRule(rule: ActionRule): CompiledConstraint[] {
    const compiler = RULE_COMPILERS[rule.type];
    if (!compiler) {
      throw new Error(
        `Unknown Kamino rule type: ${rule.type}. Available: ${Object.keys(RULE_COMPILERS).join(", ")}`,
      );
    }
    return compiler(rule);
  },

  getRuleTypes(): RuleTypeMetadata[] {
    return RULE_TYPE_METADATA;
  },

  validateRule(rule: ActionRule): string[] {
    const errors: string[] = [];

    if (!RULE_COMPILERS[rule.type]) {
      errors.push(`Unknown rule type: ${rule.type}`);
      return errors;
    }

    for (const action of rule.actions) {
      if (!KAMINO_SCHEMA.instructions.has(action)) {
        errors.push(`Unknown action: ${action}`);
      }
    }

    switch (rule.type) {
      case "maxAmount": {
        if (rule.params.maxAmount === undefined) {
          errors.push(`maxAmount requires "maxAmount" param`);
        }
        break;
      }
      case "allowedReserves": {
        const reserves = rule.params.reserves;
        if (!Array.isArray(reserves) || reserves.length === 0) {
          errors.push(`allowedReserves requires non-empty "reserves" array`);
        } else {
          for (const r of reserves) {
            if (!KAMINO_RESERVES[r as string]) {
              errors.push(`Unknown reserve: ${r}`);
            }
          }
        }
        break;
      }
    }

    return errors;
  },

  checkStrictModeWarnings(config: {
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
    const hasSpendingAction = KAMINO_SPENDING_ACTIONS.some((a) =>
      coveredActions.has(a),
    );

    if (!hasSpendingAction) return warnings;

    // Warn about missing risk-reducing actions
    const missingRiskReducing = KAMINO_RISK_REDUCING_ACTIONS.filter(
      (a) => !coveredActions.has(a),
    );

    if (missingRiskReducing.length > 0) {
      warnings.push(
        `strict_mode is ON but these risk-reducing actions have no rules (agent cannot execute them): ${missingRiskReducing.join(", ")}. ` +
          `Add an "allowAll" rule for these actions to prevent the agent from being unable to withdraw.`,
      );
    }

    return warnings;
  },
};
