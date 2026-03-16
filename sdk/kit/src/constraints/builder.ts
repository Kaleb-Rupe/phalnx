/**
 * Constraint Builder — Protocol-Agnostic Compile Engine
 *
 * Takes ProtocolRuleConfig[] → ConstraintBuildResult with entry merge/optimize.
 *
 * Merge algorithm:
 * 1. For each instruction, collect all applicable rules
 * 2. Compile each rule → data constraints + account constraints
 * 3. If NO account constraints: merge ALL data constraints into 1 entry (AND)
 * 4. If account constraints exist: one entry per unique account constraint set,
 *    each carrying ALL data constraints
 * 5. Deduplicate identical data constraints (same offset+operator+value)
 *
 * Entry budget: 16 max across all protocols.
 */

import type { Address, ReadonlyUint8Array } from "@solana/kit";
import type {
  AccountConstraintArgs,
  ConstraintEntryArgs,
  DataConstraintArgs,
} from "../generated/index.js";
import type {
  ActionRule,
  CompiledConstraint,
  ConstraintBuildResult,
  ProtocolDescriptor,
  ProtocolRuleConfig,
} from "./types.js";

const MAX_ENTRIES = 16;
const MAX_DATA_CONSTRAINTS_PER_ENTRY = 8;
const MAX_ACCOUNT_CONSTRAINTS_PER_ENTRY = 5;

export class ConstraintBudgetExceededError extends Error {
  constructor(
    public readonly used: number,
    public readonly total: number,
    public readonly perProtocol: Record<string, number>,
  ) {
    super(
      `Constraint budget exceeded: ${used}/${total} entries. ` +
        `Per protocol: ${JSON.stringify(perProtocol)}. ` +
        `Remove market restrictions or use fewer constrained actions.`,
    );
    this.name = "ConstraintBudgetExceededError";
  }
}

/**
 * ConstraintBuilder compiles protocol-specific security rules into on-chain
 * InstructionConstraints entries. Hard limit: 16 entries per vault.
 *
 * Budget Strategy:
 * - Discriminator constraints: 1 entry each (required per instruction)
 * - Value constraints (maxPositionSize, maxAmount): 1 entry each
 * - Allowlist constraints (allowedMarkets): 1 entry per allowed value
 *
 * Overflow Mitigation:
 * 1. Prioritize discriminator constraints (security-critical)
 * 2. Use allowAll rule type sparingly (1 entry covers all instructions)
 * 3. For >16 rules: split across multiple vaults (one per protocol)
 * 4. estimateEntryCount() before compile() to pre-check budget
 */
export class ConstraintBuilder {
  private descriptors = new Map<string, ProtocolDescriptor>();

  /** Register a protocol descriptor. */
  register(descriptor: ProtocolDescriptor): this {
    this.descriptors.set(descriptor.protocolId, descriptor);
    return this;
  }

  /** Compile ProtocolRuleConfig[] into on-chain ConstraintEntryArgs[]. */
  compile(configs: ProtocolRuleConfig[]): ConstraintBuildResult {
    const allEntries: ConstraintEntryArgs[] = [];
    const perProtocol: Record<string, number> = {};
    const summaries: string[] = [];
    const warnings: string[] = [];
    let strictMode = false;

    for (const config of configs) {
      const descriptor = this.descriptors.get(config.protocolId);
      if (!descriptor) {
        throw new Error(
          `No descriptor registered for protocol: ${config.protocolId}. ` +
            `Register with builder.register(descriptor) first.`,
        );
      }

      if (config.strictMode) {
        strictMode = true;
      }

      // Validate all rules first
      for (const rule of config.actionRules) {
        const errors = descriptor.validateRule(rule);
        if (errors.length > 0) {
          throw new Error(
            `Invalid rule for ${config.protocolId}: ${errors.join("; ")}`,
          );
        }
      }

      // Compile all rules into CompiledConstraints
      const compiled: CompiledConstraint[] = [];
      for (const rule of config.actionRules) {
        compiled.push(...descriptor.compileRule(rule));
      }

      // Merge compiled constraints into entries
      const entries = mergeConstraints(compiled, descriptor.programAddress);

      // Check strict_mode warnings (protocol-agnostic via descriptor)
      if (descriptor.checkStrictModeWarnings) {
        warnings.push(...descriptor.checkStrictModeWarnings(config));
      }

      // Generate summaries
      for (const entry of entries) {
        const discDesc = describeEntry(entry, descriptor);
        summaries.push(discDesc);
      }

      perProtocol[config.protocolId] = entries.length;
      allEntries.push(...entries);
    }

    const used = allEntries.length;
    if (used > MAX_ENTRIES) {
      throw new ConstraintBudgetExceededError(used, MAX_ENTRIES, perProtocol);
    }

    return {
      entries: allEntries,
      strictMode,
      budget: { used, total: MAX_ENTRIES, perProtocol },
      summary: summaries,
      warnings,
    };
  }

  /** Estimate entry count without full compile. */
  estimateEntryCount(configs: ProtocolRuleConfig[]): {
    used: number;
    total: number;
    perProtocol: Record<string, number>;
  } {
    const perProtocol: Record<string, number> = {};
    let total = 0;

    for (const config of configs) {
      const descriptor = this.descriptors.get(config.protocolId);
      if (!descriptor) {
        throw new Error(
          `No descriptor registered for protocol: ${config.protocolId}`,
        );
      }

      const compiled: CompiledConstraint[] = [];
      for (const rule of config.actionRules) {
        compiled.push(...descriptor.compileRule(rule));
      }

      // Group by discriminator key to estimate merge
      const groups = groupByDiscriminatorKey(compiled);
      let count = 0;
      for (const group of groups.values()) {
        const hasAccountConstraints = group.some(
          (c) => c.accountConstraints.length > 0,
        );
        if (hasAccountConstraints) {
          // Each unique account constraint set = 1 entry
          const uniqueAccountSets = new Set<string>();
          for (const c of group) {
            if (c.accountConstraints.length > 0) {
              uniqueAccountSets.add(accountConstraintKey(c.accountConstraints));
            }
          }
          count += Math.max(uniqueAccountSets.size, 1);
        } else {
          count += 1; // All data constraints merge into 1 entry
        }
      }

      perProtocol[config.protocolId] = count;
      total += count;
    }

    return { used: total, total: MAX_ENTRIES, perProtocol };
  }
}

// ─── Merge Engine ───────────────────────────────────────────────────────────

/** Key for grouping: discriminator bytes as comma-separated string */
function discriminatorKey(disc: Uint8Array): string {
  return Array.from(disc).join(",");
}

/** Key for deduplicating account constraint sets */
function accountConstraintKey(acs: AccountConstraintArgs[]): string {
  return acs
    .map((ac) => `${ac.index}:${ac.expected}`)
    .sort()
    .join("|");
}

/** Key for deduplicating data constraints */
function dataConstraintKey(dc: DataConstraintArgs): string {
  return `${dc.offset}:${dc.operator}:${Array.from(dc.value as Uint8Array).join(",")}`;
}

/** Group compiled constraints by discriminator */
function groupByDiscriminatorKey(
  compiled: CompiledConstraint[],
): Map<string, CompiledConstraint[]> {
  const groups = new Map<string, CompiledConstraint[]>();

  for (const c of compiled) {
    for (const disc of c.discriminators) {
      const key = discriminatorKey(disc);
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(c);
    }
  }

  return groups;
}

/**
 * Merge compiled constraints into ConstraintEntryArgs[].
 *
 * Groups by discriminator. Within each group:
 * - All data constraints merge (AND) with dedup
 * - Account constraints create OR alternatives (separate entries)
 */
function mergeConstraints(
  compiled: CompiledConstraint[],
  programId: Address,
): ConstraintEntryArgs[] {
  const groups = groupByDiscriminatorKey(compiled);
  const entries: ConstraintEntryArgs[] = [];

  for (const group of groups.values()) {
    // Collect all unique data constraints
    const dataMap = new Map<string, DataConstraintArgs>();
    for (const c of group) {
      for (const dc of c.dataConstraints) {
        const key = dataConstraintKey(dc);
        if (!dataMap.has(key)) {
          dataMap.set(key, dc);
        }
      }
    }
    const mergedData = Array.from(dataMap.values());

    if (mergedData.length > MAX_DATA_CONSTRAINTS_PER_ENTRY) {
      throw new Error(
        `Too many data constraints for a single entry: ${mergedData.length}/${MAX_DATA_CONSTRAINTS_PER_ENTRY}. ` +
          `Reduce rule complexity or split across multiple entries.`,
      );
    }

    // Check for account constraints
    const accountGroups = new Map<string, AccountConstraintArgs[]>();
    const hasAccountConstraints = group.some(
      (c) => c.accountConstraints.length > 0,
    );

    if (hasAccountConstraints) {
      for (const c of group) {
        if (c.accountConstraints.length > 0) {
          const key = accountConstraintKey(c.accountConstraints);
          if (!accountGroups.has(key)) {
            accountGroups.set(key, c.accountConstraints);
          }
        }
      }

      // One entry per unique account constraint set, each with ALL data constraints
      for (const acs of accountGroups.values()) {
        if (acs.length > MAX_ACCOUNT_CONSTRAINTS_PER_ENTRY) {
          throw new Error(
            `Too many account constraints for a single entry: ${acs.length}/${MAX_ACCOUNT_CONSTRAINTS_PER_ENTRY}.`,
          );
        }
        entries.push({
          programId,
          dataConstraints: mergedData,
          accountConstraints: acs,
        });
      }
    } else {
      // No account constraints — single entry with all data constraints
      entries.push({
        programId,
        dataConstraints: mergedData,
        accountConstraints: [],
      });
    }
  }

  return entries;
}

// ─── Summary Helpers ────────────────────────────────────────────────────────

function describeEntry(
  entry: ConstraintEntryArgs,
  descriptor: ProtocolDescriptor,
): string {
  const parts: string[] = [];

  // Find instruction name from discriminator
  const discData = entry.dataConstraints.find((dc) => dc.offset === 0);
  if (discData) {
    for (const [name, schema] of descriptor.schema.instructions) {
      if (arraysEqual(schema.discriminator, discData.value as Uint8Array)) {
        parts.push(name);
        break;
      }
    }
  }

  // Describe data constraints (skip discriminator)
  const fieldConstraints = entry.dataConstraints.filter(
    (dc) => dc.offset !== 0,
  );
  if (fieldConstraints.length > 0) {
    parts.push(`${fieldConstraints.length} field constraint(s)`);
  }

  // Describe account constraints
  if (entry.accountConstraints.length > 0) {
    parts.push(`${entry.accountConstraints.length} account constraint(s)`);
  }

  return parts.join(": ") || "unknown entry";
}

function arraysEqual(
  a: Uint8Array,
  b: Uint8Array | ReadonlyUint8Array,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
