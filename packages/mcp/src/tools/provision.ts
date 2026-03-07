import { z } from "zod";

export const provisionSchema = z.object({
  platformUrl: z
    .string()
    .optional()
    .default("https://agent-middleware.vercel.app")
    .describe(
      "Phalnx Actions server URL (default: https://agent-middleware.vercel.app)",
    ),
  template: z
    .string()
    .optional()
    .default("conservative")
    .describe(
      "Policy template: conservative (500 USDC/day), moderate (2000), aggressive (10000)",
    ),
  dailyCap: z
    .number()
    .optional()
    .describe("Custom daily spending cap in USDC (overrides template default)"),
  agentPubkey: z
    .string()
    .optional()
    .describe(
      "Agent public key (base58) to register in the vault. " +
        "If not provided, uses the MCP server's agent keypair.",
    ),
  protocolMode: z
    .number()
    .optional()
    .describe(
      "Protocol access mode: 0 = all allowed, 1 = allowlist, 2 = denylist. Overrides template.",
    ),
  protocols: z
    .array(z.string())
    .optional()
    .describe("Custom protocol program IDs (base58). Overrides template."),
  maxLeverageBps: z
    .number()
    .optional()
    .describe("Custom max leverage in basis points. Overrides template."),
});

export type ProvisionInput = z.infer<typeof provisionSchema>;

const PROVISION_TEMPLATE_ALIASES: Record<string, string> = {
  safe: "conservative", cautious: "conservative", low: "conservative",
  medium: "moderate", mid: "moderate", balanced: "moderate",
  high: "aggressive", yolo: "aggressive", fast: "aggressive", max: "aggressive",
};

function provisionLevenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1]
        : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
  return d[a.length][b.length];
}

function normalizeProvisionTemplate(input: string): { value: string; note?: string } {
  const lower = input.trim().toLowerCase();
  const VALID = ["conservative", "moderate", "aggressive"] as const;
  if ((VALID as readonly string[]).includes(lower)) return { value: lower };
  if (PROVISION_TEMPLATE_ALIASES[lower]) return { value: PROVISION_TEMPLATE_ALIASES[lower] };
  const nearest = VALID.reduce((best, opt) =>
    provisionLevenshtein(lower, opt) < provisionLevenshtein(lower, best) ? opt : best
  );
  return { value: nearest, note: `> Using '${nearest}' (closest match to '${input}')` };
}

/**
 * Generate a Solana Action URL for vault provisioning.
 *
 * This tool does NOT create the vault itself — it generates a URL
 * that the user clicks to approve vault creation in their wallet.
 * The platform handles TEE wallet creation server-side.
 */
export async function provision(
  _client: any,
  input: ProvisionInput,
): Promise<string> {
  const rawTemplate = input.template ?? "conservative";
  const { value: templateName, note: templateNote } = normalizeProvisionTemplate(rawTemplate);

  const baseUrl = input.platformUrl.replace(/\/$/, "");

  const params = new URLSearchParams();
  params.set("template", templateName);
  if (input.dailyCap) {
    params.set("dailyCap", input.dailyCap.toString());
  }
  if (input.agentPubkey) {
    params.set("agentPubkey", input.agentPubkey);
  }

  const actionUrl = `${baseUrl}/api/actions/provision?${params.toString()}`;
  const blinkUrl = `https://dial.to/?action=solana-action:${encodeURIComponent(actionUrl)}`;

  const dailyCap =
    input.dailyCap ||
    {
      conservative: 500,
      moderate: 2000,
      aggressive: 10000,
    }[templateName];

  const output = [
    "## Vault Provisioning Request",
    "",
    "I need a protected wallet to trade. Please approve the vault creation by clicking the link below.",
    "",
    `**Policy:** ${templateName} (${dailyCap} USDC/day cap)`,
    "",
    "### How to approve:",
    `1. **Blink URL** (paste in any blink-compatible app): ${blinkUrl}`,
    `2. **Action URL** (for Solana Actions-compatible wallets): ${actionUrl}`,
    "",
    "The transaction atomically creates an on-chain vault and registers the agent.",
    "You sign ONE transaction — if anything fails, everything reverts.",
    "",
    "After you sign, I'll be able to trade within your policy limits.",
  ].join("\n");

  return templateNote ? `${templateNote}\n\n${output}` : output;
}

export const provisionTool = {
  name: "shield_provision",
  description:
    "Generate a Solana Action URL for one-click vault provisioning. " +
    "Creates an Action URL that the user clicks to approve vault creation with a TEE-backed agent wallet. " +
    "The user signs one transaction that atomically creates the vault, sets policies, and registers the agent.",
  schema: provisionSchema,
  handler: provision,
};
