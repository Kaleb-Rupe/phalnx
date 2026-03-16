import { z } from "zod";
import { getDescriptors } from "./constraint-shared";

export const getConstraintRuleTypesSchema = z.object({
  protocolId: z.string().describe("Protocol ID to get rule types for (e.g., 'flash-trade', 'kamino')"),
});

export type GetConstraintRuleTypesInput = z.infer<typeof getConstraintRuleTypesSchema>;

export async function getConstraintRuleTypes(
  _client: unknown,
  input: GetConstraintRuleTypesInput,
): Promise<string> {
  const DESCRIPTORS = await getDescriptors();

  const descriptor = DESCRIPTORS[input.protocolId];
  if (!descriptor) {
    return `❌ Unknown protocol: ${input.protocolId}. Available: ${Object.keys(DESCRIPTORS).join(", ")}`;
  }

  const ruleTypes = descriptor.getRuleTypes();
  const lines: string[] = [
    `## Constraint Rule Types — ${input.protocolId}`,
    "",
    `| Rule Type | Display Name | Description | Applicable Actions | Params |`,
    `|-----------|-------------|-------------|-------------------|--------|`,
  ];

  for (const rt of ruleTypes) {
    const params = rt.params.length > 0
      ? rt.params.map((p: any) => `${p.name}: ${p.type}${p.required ? " (required)" : ""}`).join(", ")
      : "none";
    lines.push(
      `| \`${rt.type}\` | ${rt.displayName} | ${rt.description} | ${rt.applicableActions.join(", ")} | ${params} |`,
    );
  }

  lines.push(
    "",
    `**Instructions:** ${Array.from(descriptor.schema.instructions.keys()).join(", ")}`,
    `**Program:** \`${descriptor.programAddress}\``,
  );

  return lines.join("\n");
}

export const getConstraintRuleTypesTool = {
  name: "shield_get_constraint_rule_types",
  description:
    "Get available constraint rule types for a protocol. Returns rule types, " +
    "their parameters, and applicable actions. No wallet required.",
  schema: getConstraintRuleTypesSchema,
  handler: getConstraintRuleTypes,
};
