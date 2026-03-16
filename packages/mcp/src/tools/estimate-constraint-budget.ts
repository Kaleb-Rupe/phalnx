import { z } from "zod";
import { protocolConfigSchema, loadKit, getDescriptors } from "./constraint-shared";

export const estimateConstraintBudgetSchema = z.object({
  configs: z.array(protocolConfigSchema).describe("Protocol configs to estimate"),
});

export type EstimateConstraintBudgetInput = z.infer<typeof estimateConstraintBudgetSchema>;

export async function estimateConstraintBudget(
  _client: unknown,
  input: EstimateConstraintBudgetInput,
): Promise<string> {
  const kit = await loadKit();
  const DESCRIPTORS = await getDescriptors();

  try {
    const builder = new kit.ConstraintBuilder();

    for (const config of input.configs) {
      const descriptor = DESCRIPTORS[config.protocolId];
      if (!descriptor) {
        return `❌ Unknown protocol: ${config.protocolId}. Available: ${Object.keys(DESCRIPTORS).join(", ")}`;
      }
      builder.register(descriptor);
    }

    const estimate = builder.estimateEntryCount(input.configs);

    const lines: string[] = [
      "## Constraint Budget Estimate",
      "",
      `**Total:** ${estimate.used}/${estimate.total} entries${estimate.used > estimate.total ? " ⚠️ OVER BUDGET" : ""}`,
      "",
      "### Per Protocol",
    ];

    for (const [proto, count] of Object.entries(estimate.perProtocol)) {
      lines.push(`- **${proto}:** ${count} entries`);
    }

    const remaining = estimate.total - estimate.used;
    lines.push(
      "",
      `**Remaining budget:** ${Math.max(0, remaining)} entries`,
    );

    if (estimate.used > estimate.total) {
      lines.push(
        "",
        "⚠️ Over budget — reduce market restrictions or constrained actions to fit within 16 entries.",
      );
    }

    return lines.join("\n");
  } catch (err: unknown) {
    return `❌ Estimate failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export const estimateConstraintBudgetTool = {
  name: "shield_estimate_constraint_budget",
  description:
    "Estimate the constraint entry count for a set of protocol configurations. " +
    "Returns budget usage without full compilation. No wallet required.",
  schema: estimateConstraintBudgetSchema,
  handler: estimateConstraintBudget,
};
