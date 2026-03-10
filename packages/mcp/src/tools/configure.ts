import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  getConfigDir,
  loadShieldConfig,
  saveShieldConfig,
  type ShieldLocalConfig,
} from "../config";
import { saveCredential, getCredential, KC } from "../keychain";

/**
 * Template definitions for configure tool.
 * Duplicated from actions-server/src/lib/templates.ts for zero-dependency use.
 * Keep in sync — see apps/actions-server/src/lib/templates.ts.
 */
const CONFIGURE_TEMPLATES = {
  conservative: {
    dailySpendingCapUsd: 500,
    protocolMode: 1 as number,
    protocols: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
    maxLeverageBps: 0,
    rateLimit: 60,
  },
  moderate: {
    dailySpendingCapUsd: 2000,
    protocolMode: 1 as number,
    protocols: [
      "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
      "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
      "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
    ],
    maxLeverageBps: 20000,
    rateLimit: 120,
  },
  aggressive: {
    dailySpendingCapUsd: 10000,
    protocolMode: 0 as number,
    protocols: [
      "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
      "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
      "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
      "F1aShdFvR4FHMqAjMbBiGWCHKYaUqR6sFg1MG2pPVfkz",
    ],
    maxLeverageBps: 50000,
    rateLimit: 300,
  },
} as const;

type ConfigureTemplate = keyof typeof CONFIGURE_TEMPLATES;

const TEMPLATE_ALIASES: Record<string, string> = {
  safe: "conservative",
  cautious: "conservative",
  low: "conservative",
  medium: "moderate",
  mid: "moderate",
  balanced: "moderate",
  high: "aggressive",
  yolo: "aggressive",
  fast: "aggressive",
  max: "aggressive",
};

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] =
        a[i - 1] === b[j - 1]
          ? d[i - 1][j - 1]
          : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
  return d[a.length][b.length];
}

function normalizeTemplate(input: string): { value: string; note?: string } {
  const lower = input.trim().toLowerCase();
  const VALID = ["conservative", "moderate", "aggressive"] as const;
  if ((VALID as readonly string[]).includes(lower)) return { value: lower };
  if (TEMPLATE_ALIASES[lower]) return { value: TEMPLATE_ALIASES[lower] };
  const nearest = VALID.reduce((best, opt) =>
    levenshtein(lower, opt) < levenshtein(lower, best) ? opt : best,
  );
  return {
    value: nearest,
    note: `> Using '${nearest}' (closest match to '${input}')`,
  };
}

const ACTIONS_SERVER_URL = "https://agent-middleware.vercel.app";

export const configureSchema = z.object({
  teeProvider: z
    .enum(["crossmint", "turnkey", "privy"])
    .optional()
    .default("crossmint")
    .describe("TEE custody provider (default: crossmint)"),
  template: z
    .string()
    .optional()
    .default("conservative")
    .describe(
      "Policy template: conservative, moderate, or aggressive (default: conservative)",
    ),
  dailySpendingCapUsd: z
    .number()
    .optional()
    .describe("Custom daily spending cap in USD (overrides template)"),
  protocolMode: z
    .number()
    .optional()
    .describe(
      "Protocol access mode: 0 = all allowed, 1 = allowlist, 2 = denylist (overrides template)",
    ),
  protocols: z
    .array(z.string())
    .optional()
    .describe("Custom protocol program IDs (base58, overrides template)"),
  maxLeverageBps: z
    .number()
    .optional()
    .describe("Custom max leverage in basis points"),
  rateLimit: z
    .number()
    .optional()
    .describe("Custom rate limit in transactions per minute"),
  network: z
    .enum(["devnet", "mainnet-beta"])
    .optional()
    .default("devnet")
    .describe("Solana network (default: devnet)"),
  walletPath: z
    .string()
    .optional()
    .describe("Path to existing keypair JSON (generates new if omitted)"),
  turnkeyOrganizationId: z
    .string()
    .optional()
    .describe("Turnkey organization ID (saved to OS keychain)"),
  turnkeyApiKeyId: z
    .string()
    .optional()
    .describe("Turnkey API key ID (saved to OS keychain)"),
  turnkeyApiPrivateKey: z
    .string()
    .optional()
    .describe("Turnkey API private key PEM (saved to OS keychain)"),
  crossmintApiKey: z
    .string()
    .optional()
    .describe("Crossmint API key (saved to OS keychain)"),
  privyAppId: z
    .string()
    .optional()
    .describe("Privy app ID (saved to OS keychain)"),
  privyAppSecret: z
    .string()
    .optional()
    .describe("Privy app secret (saved to OS keychain)"),
});

export type ConfigureInput = z.input<typeof configureSchema>;

/**
 * Set up Phalnx with full on-chain guardrails.
 * Generates keypair, provisions TEE wallet, and creates vault Blink URL.
 */
export async function configure(
  _client: any,
  input: ConfigureInput,
): Promise<string> {
  try {
    const rawTemplate = input.template ?? "conservative";
    const { value: templateName, note: templateNote } =
      normalizeTemplate(rawTemplate);
    const network = input.network ?? "devnet";
    const template =
      CONFIGURE_TEMPLATES[templateName as ConfigureTemplate] ??
      CONFIGURE_TEMPLATES.conservative;

    const dailySpendingCapUsd =
      input.dailySpendingCapUsd ?? template.dailySpendingCapUsd;
    const protocolMode = input.protocolMode ?? template.protocolMode;
    const protocols = input.protocols ?? [...template.protocols];
    const maxLeverageBps = input.maxLeverageBps ?? template.maxLeverageBps;
    const rateLimit = input.rateLimit ?? template.rateLimit;

    // ── Mainnet hard guard ───────────────────────────────────────────
    if (network === "mainnet-beta") {
      return [
        "## Error: TEE Wallet Required for Mainnet",
        "",
        "Local keypair wallets are not permitted on mainnet-beta.",
        "Your agent's private key must live in a hardware enclave.",
        "",
        "Provide credentials for one of these providers:",
        "- **Crossmint** (easiest): pass `crossmintApiKey` to this tool",
        "- **Turnkey**: pass `turnkeyOrganizationId`, `turnkeyApiKeyId`, `turnkeyApiPrivateKey`",
        "- **Privy**: pass `privyAppId`, `privyAppSecret`",
      ].join("\n");
    }

    // ── Step 1: Generate/load keypair ──────────────────────────────
    let walletPath = input.walletPath || null;
    let walletPublicKey: string;

    if (walletPath) {
      const { Keypair } = await import("@solana/web3.js");
      const resolved = walletPath.startsWith("~")
        ? walletPath.replace("~", os.homedir())
        : walletPath;
      const raw = fs.readFileSync(resolved, "utf-8");
      const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
      walletPublicKey = kp.publicKey.toBase58();
    } else {
      const { Keypair } = await import("@solana/web3.js");
      const kp = Keypair.generate();
      const walletsDir = path.join(getConfigDir(), "wallets");
      if (!fs.existsSync(walletsDir)) {
        fs.mkdirSync(walletsDir, { recursive: true, mode: 0o700 });
      }
      walletPath = path.join(walletsDir, "agent.json");
      fs.writeFileSync(walletPath, JSON.stringify(Array.from(kp.secretKey)), {
        mode: 0o600,
      });
      walletPublicKey = kp.publicKey.toBase58();
    }

    const config: ShieldLocalConfig = {
      version: 1,
      layers: {
        shield: {
          enabled: true,
          dailySpendingCapUsd,
          protocolMode,
          protocols,
          maxLeverageBps,
          rateLimit,
        },
        tee: { enabled: false, locator: null, publicKey: null },
        vault: {
          enabled: false,
          address: null,
          owner: null,
          vaultId: null,
        },
      },
      wallet: {
        type: "keypair",
        path: walletPath,
        publicKey: walletPublicKey,
      },
      agentKeypairPath: walletPath,
      network: network as "devnet" | "mainnet-beta",
      template: templateName as ConfigureTemplate,
      configuredAt: new Date().toISOString(),
    };

    const lines: string[] = [
      "## Phalnx Configured",
      "",
      `**Wallet:** ${walletPublicKey}`,
      `**Network:** ${config.network}`,
      `**Template:** ${templateName}`,
      `**Daily Cap:** $${dailySpendingCapUsd}`,
      `**Protocol Mode:** ${protocolMode === 0 ? "All Allowed" : protocolMode === 1 ? "Allowlist" : "Denylist"}`,
      `**Protocols:** ${protocols.length}`,
      `**Max Leverage:** ${maxLeverageBps} BPS`,
    ];

    // ── Step 2: Provision TEE wallet ──────────────────────────────
    const teeProvider = input.teeProvider ?? "crossmint";

    // Dedup guard: if we already have a TEE wallet from a previous run, reuse it
    const existingConfig = loadShieldConfig();
    if (
      existingConfig?.layers.tee.enabled &&
      existingConfig.layers.tee.locator
    ) {
      config.layers.tee = { ...existingConfig.layers.tee };
      config.wallet.type = existingConfig.wallet.type as
        | "keypair"
        | "crossmint"
        | "privy"
        | "turnkey";
      config.wallet.publicKey =
        existingConfig.layers.tee.publicKey ?? walletPublicKey;

      lines.push("");
      lines.push("### TEE Custody (reused existing)");
      lines.push(`- **TEE Public Key:** ${config.wallet.publicKey}`);
      lines.push(`- **Locator:** ${config.layers.tee.locator}`);
      lines.push(
        "- Your agent's private key is protected in a hardware enclave.",
      );
    } else if (teeProvider === "privy") {
      const privyAppId =
        input.privyAppId ??
        (await getCredential(KC.PRIVY_APP_ID)) ??
        process.env.PRIVY_APP_ID;
      const privyAppSecret =
        input.privyAppSecret ??
        (await getCredential(KC.PRIVY_APP_SECRET)) ??
        process.env.PRIVY_APP_SECRET;
      if (privyAppId && privyAppSecret) {
        // Local Privy creation — dev has their own API credentials
        try {
          let mod: any;
          try {
            mod = require("@phalnx/custody-privy");
          } catch {
            return (
              "Error: @phalnx/custody-privy is not installed.\n" +
              "Run: npm install @phalnx/custody-privy"
            );
          }
          if (input.privyAppId) {
            const savedId = await saveCredential(
              KC.PRIVY_APP_ID,
              input.privyAppId,
            );
            if (!savedId)
              lines.push(
                "⚠️  keytar unavailable — set PRIVY_APP_ID env var for subsequent sessions.",
              );
          }
          if (input.privyAppSecret) {
            const savedSecret = await saveCredential(
              KC.PRIVY_APP_SECRET,
              input.privyAppSecret,
            );
            if (!savedSecret)
              lines.push(
                "⚠️  keytar unavailable — set PRIVY_APP_SECRET env var for subsequent sessions.",
              );
          }
          const custodyWallet = await mod.privy({
            appId: privyAppId,
            appSecret: privyAppSecret,
          });

          config.layers.tee = {
            enabled: true,
            locator: custodyWallet.walletId,
            publicKey: custodyWallet.publicKey.toBase58(),
          };
          config.wallet.type = "privy";
          config.wallet.publicKey = custodyWallet.publicKey.toBase58();

          lines.push("");
          lines.push("### TEE Custody (Privy)");
          lines.push(`- **TEE Public Key:** ${config.wallet.publicKey}`);
          lines.push(`- **Wallet ID:** ${config.layers.tee.locator}`);
          lines.push(
            "- Your agent's private key is protected in a Privy AWS Nitro Enclave.",
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return `Error creating Privy wallet: ${msg}\n💡 Check PRIVY_APP_ID and PRIVY_APP_SECRET are set correctly.`;
        }
      }
    } else if (teeProvider === "turnkey") {
      const turnkeyOrgId =
        input.turnkeyOrganizationId ??
        (await getCredential(KC.TURNKEY_ORG_ID)) ??
        process.env.TURNKEY_ORGANIZATION_ID;
      const turnkeyApiKeyId =
        input.turnkeyApiKeyId ??
        (await getCredential(KC.TURNKEY_API_KEY_ID)) ??
        process.env.TURNKEY_API_KEY_ID;
      const turnkeyApiPrivateKey =
        input.turnkeyApiPrivateKey ??
        (await getCredential(KC.TURNKEY_API_PRIVATE_KEY)) ??
        process.env.TURNKEY_API_PRIVATE_KEY;
      if (turnkeyOrgId && turnkeyApiKeyId && turnkeyApiPrivateKey) {
        // Local Turnkey creation — dev has their own API credentials
        try {
          let mod: any;
          try {
            mod = require("@phalnx/custody-turnkey");
          } catch {
            return (
              "Error: @phalnx/custody-turnkey is not installed.\n" +
              "Run: npm install @phalnx/custody-turnkey"
            );
          }
          if (input.turnkeyOrganizationId) {
            const s = await saveCredential(
              KC.TURNKEY_ORG_ID,
              input.turnkeyOrganizationId,
            );
            if (!s)
              lines.push(
                "⚠️  keytar unavailable — set TURNKEY_ORGANIZATION_ID env var for subsequent sessions.",
              );
          }
          if (input.turnkeyApiKeyId) {
            const s = await saveCredential(
              KC.TURNKEY_API_KEY_ID,
              input.turnkeyApiKeyId,
            );
            if (!s)
              lines.push(
                "⚠️  keytar unavailable — set TURNKEY_API_KEY_ID env var for subsequent sessions.",
              );
          }
          if (input.turnkeyApiPrivateKey) {
            const s = await saveCredential(
              KC.TURNKEY_API_PRIVATE_KEY,
              input.turnkeyApiPrivateKey,
            );
            if (!s)
              lines.push(
                "⚠️  keytar unavailable — set TURNKEY_API_PRIVATE_KEY env var for subsequent sessions.",
              );
          }
          const custodyWallet = await mod.turnkey({
            organizationId: turnkeyOrgId,
            apiKeyId: turnkeyApiKeyId,
            apiPrivateKey: turnkeyApiPrivateKey,
          });

          config.layers.tee = {
            enabled: true,
            locator: custodyWallet.walletId,
            publicKey: custodyWallet.publicKey.toBase58(),
          };
          config.wallet.type = "turnkey";
          config.wallet.publicKey = custodyWallet.publicKey.toBase58();

          lines.push("");
          lines.push("### TEE Custody (Turnkey)");
          lines.push(`- **TEE Public Key:** ${config.wallet.publicKey}`);
          lines.push(`- **Wallet ID:** ${config.layers.tee.locator}`);
          lines.push(
            "- Your agent's private key is protected in Turnkey's secure infrastructure.",
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return `Error creating Turnkey wallet: ${msg}\n💡 Check TURNKEY_ORGANIZATION_ID, TURNKEY_API_KEY_ID, and TURNKEY_API_PRIVATE_KEY are set.`;
        }
      }
    } else if (teeProvider === "crossmint") {
      const crossmintApiKey =
        input.crossmintApiKey ??
        (await getCredential(KC.CROSSMINT_API_KEY)) ??
        process.env.CROSSMINT_API_KEY;
      if (crossmintApiKey) {
        // Local Crossmint creation — dev has their own API key
        try {
          let mod: any;
          try {
            mod = require("@phalnx/custody-crossmint");
          } catch {
            return (
              "Error: @phalnx/custody-crossmint is not installed.\n" +
              "Run: npm install @phalnx/custody-crossmint"
            );
          }
          if (input.crossmintApiKey) {
            const saved = await saveCredential(
              KC.CROSSMINT_API_KEY,
              input.crossmintApiKey,
            );
            if (!saved)
              lines.push(
                "⚠️  keytar unavailable — set CROSSMINT_API_KEY env var for subsequent sessions.",
              );
          }
          const baseUrl =
            (network as string) === "mainnet-beta"
              ? "https://crossmint.com"
              : "https://staging.crossmint.com";
          const custodyWallet = await mod.crossmint({
            apiKey: crossmintApiKey,
            baseUrl,
            linkedUser: `userId:phalnx-${walletPublicKey}`,
          });

          config.layers.tee = {
            enabled: true,
            locator: `userId:phalnx-${walletPublicKey}`,
            publicKey: custodyWallet.publicKey.toBase58(),
          };
          config.wallet.type = "crossmint";
          config.wallet.publicKey = custodyWallet.publicKey.toBase58();

          lines.push("");
          lines.push("### TEE Custody (local Crossmint)");
          lines.push(`- **TEE Public Key:** ${config.wallet.publicKey}`);
          lines.push(`- **Locator:** ${config.layers.tee.locator}`);
          lines.push(
            "- Your agent's private key is protected in a hardware enclave.",
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return `Error creating Crossmint wallet: ${msg}\n💡 Check CROSSMINT_API_KEY is set.`;
        }
      } else {
        // No credentials found — fall through to hosted API below
      }
    }

    // Fall back to hosted Actions Server if no TEE credentials were available
    if (!config.layers.tee.enabled) {
      try {
        const response = await fetch(
          `${ACTIONS_SERVER_URL}/api/actions/provision-tee`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              network,
              publicKey: walletPublicKey,
              provider: teeProvider,
            }),
          },
        );

        if (!response.ok) {
          const errorBody = await response.text();
          return `Error provisioning TEE wallet: ${response.status} ${errorBody}`;
        }

        const teeResult = (await response.json()) as {
          publicKey: string;
          locator: string;
        };
        config.layers.tee = {
          enabled: true,
          locator: teeResult.locator,
          publicKey: teeResult.publicKey,
        };
        config.wallet.type = teeProvider as "crossmint" | "privy" | "turnkey";
        config.wallet.publicKey = teeResult.publicKey;

        lines.push("");
        lines.push(`### TEE Custody (${teeProvider})`);
        lines.push(`- **TEE Public Key:** ${teeResult.publicKey}`);
        lines.push(`- **Locator:** ${teeResult.locator}`);
        lines.push(
          "- Your agent's private key is protected in a hardware enclave.",
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if ((network as string) === "mainnet-beta") {
          return [
            "## Error: TEE Provisioning Failed (Mainnet)",
            "",
            `Provisioning failed: ${msg}`,
            "",
            "No configuration saved. Provide direct credentials (crossmintApiKey, turnkeyOrganizationId, etc.) to avoid the hosted fallback.",
          ].join("\n");
        }
        return `Could not provision a TEE wallet: ${msg}\n\n💡 To use local TEE custody instead of the hosted service, set one of:\n  CROSSMINT_API_KEY (easiest)\n  TURNKEY_ORGANIZATION_ID + TURNKEY_API_KEY_ID + TURNKEY_API_PRIVATE_KEY\n  PRIVY_APP_ID + PRIVY_APP_SECRET`;
      }
    }

    // ── Step 3: Generate vault Blink URL ──────────────────────────
    const params = new URLSearchParams();
    params.set("template", templateName);
    if (input.dailySpendingCapUsd) {
      params.set("dailyCap", input.dailySpendingCapUsd.toString());
    }
    params.set("agentPubkey", config.wallet.publicKey);

    const actionUrl = `${ACTIONS_SERVER_URL}/api/actions/provision?${params.toString()}`;
    const blinkUrl = `https://dial.to/?action=solana-action:${encodeURIComponent(actionUrl)}`;

    config.layers.vault.enabled = true;

    lines.push("");
    lines.push("### On-Chain Vault");
    lines.push(
      "Your vault needs one more step — sign the creation transaction:",
    );
    lines.push(`1. **Blink URL:** ${blinkUrl}`);
    lines.push(`2. **Action URL:** ${actionUrl}`);
    lines.push("");
    lines.push(
      "After signing, your vault address will be saved automatically.",
    );

    // Save config
    saveShieldConfig(config);

    lines.push("");
    lines.push("### Next Steps");
    lines.push("1. Sign the vault creation transaction using the link above");
    lines.push(
      "2. After signing, run `shield_confirm_vault` to save your vault address",
    );
    lines.push("3. Fund your vault with SOL and tokens");
    lines.push("4. You're ready to trade with full on-chain protection!");
    lines.push("");
    lines.push(
      "**→ Next:** Click the vault link above, then run `shield_confirm_vault` to save your vault address.",
    );

    const output = lines.join("\n");
    return templateNote ? `${templateNote}\n\n${output}` : output;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Error configuring Phalnx: ${msg}`;
  }
}

export const configureTool = {
  name: "shield_configure",
  description:
    "Set up Phalnx with full on-chain guardrails. " +
    "Generates keypair, provisions TEE wallet, and creates vault Blink URL.",
  schema: configureSchema,
  handler: configure,
};
