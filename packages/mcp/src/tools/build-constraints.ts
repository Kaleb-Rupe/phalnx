import { z } from "zod";
import { protocolConfigSchema, loadKit, getDescriptors } from "./constraint-shared";

export const buildConstraintsSchema = z.object({
  configs: z.array(protocolConfigSchema).describe("Protocol constraint configurations"),
});

export type BuildConstraintsInput = z.infer<typeof buildConstraintsSchema>;

export async function buildConstraints(
  _client: unknown,
  input: BuildConstraintsInput,
): Promise<string> {
  const kit = await loadKit();
  const DESCRIPTORS = await getDescriptors();

  try {
    const builder = new kit.ConstraintBuilder();

    // Register all needed descriptors
    for (const config of input.configs) {
      const descriptor = DESCRIPTORS[config.protocolId];
      if (!descriptor) {
        return `❌ Unknown protocol: ${config.protocolId}. Available: ${Object.keys(DESCRIPTORS).join(", ")}`;
      }
      builder.register(descriptor);
    }

    const result = builder.compile(input.configs);

    const lines: string[] = [
      "## Constraint Build Result",
      "",
      `**Entries:** ${result.budget.used}/${result.budget.total}`,
      `**Strict Mode:** ${result.strictMode ? "ON" : "OFF"}`,
      "",
      "### Per Protocol",
    ];

    for (const [proto, count] of Object.entries(result.budget.perProtocol)) {
      lines.push(`- **${proto}:** ${count} entries`);
    }

    if (result.summary.length > 0) {
      lines.push("", "### Entry Summary");
      for (const s of result.summary) {
        lines.push(`- ${s}`);
      }
    }

    if (result.warnings.length > 0) {
      lines.push("", "### ⚠️ Warnings");
      for (const w of result.warnings) {
        lines.push(`- ${w}`);
      }
    }

    lines.push(
      "",
      "### Raw Entries (for createInstructionConstraints)",
      `\`\`\`json`,
      JSON.stringify(
        result.entries.map((e: { programId: string; dataConstraints: unknown[]; accountConstraints: unknown[] }) => ({
          programId: e.programId,
          dataConstraints: e.dataConstraints.length,
          accountConstraints: e.accountConstraints.length,
        })),
        null,
        2,
      ),
      `\`\`\``,
    );

    return lines.join("\n");
  } catch (err: unknown) {
    if (err instanceof kit.ConstraintBudgetExceededError) {
      return [
        "❌ Constraint Budget Exceeded",
        "",
        `**Used:** ${(err as any).used}/${(err as any).total}`,
        `**Per Protocol:** ${JSON.stringify((err as any).perProtocol)}`,
        "",
        "**Suggestion:** Remove market restrictions or use fewer constrained actions to reduce entry count.",
      ].join("\n");
    }
    return `❌ Build failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export const buildConstraintsTool = {
  name: "shield_build_constraints",
  description:
    "Compile protocol constraint configurations into on-chain ConstraintEntryArgs[]. " +
    "Takes dashboard-friendly JSON rules and produces optimized entries. " +
    "Supports Flash Trade and Kamino protocols. No wallet required.",
  schema: buildConstraintsSchema,
  handler: buildConstraints,
};
