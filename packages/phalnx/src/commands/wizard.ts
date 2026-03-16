import { Command } from "commander";
import * as prompts from "@clack/prompts";
import {
  scaffold,
  formatPostScaffoldMessage,
  cleanupOnFailure,
} from "../scaffolder";
import { validateProjectName, normalizeProjectName } from "../utils";
import { PRESETS, type PolicyPreset, PRESET_LABELS } from "../presets";
import {
  TEMPLATE_CHOICES,
  type TemplateName,
  type ProjectConfig,
} from "../templates/registry";

export function registerWizardCommand(program: Command): void {
  program
    .command("wizard")
    .description("Guided setup with explanations at each step")
    .action(async () => {
      prompts.intro("phalnx wizard — guided project setup");

      const config = await resolveWizardConfig();
      if (!config) {
        prompts.cancel("Wizard cancelled.");
        process.exitCode = 1;
        return;
      }

      const targetDir = `./${config.projectName}`;

      const s = prompts.spinner();
      s.start("Scaffolding project...");

      try {
        const result = scaffold(targetDir, config);
        s.stop("Project scaffolded.");

        const msg = formatPostScaffoldMessage(result);
        prompts.outro(`Project created! Run:\n${msg}`);
      } catch (err) {
        s.stop("Failed.");
        cleanupOnFailure(targetDir);
        prompts.log.error(
          `Scaffolding failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });
}

async function resolveWizardConfig(): Promise<ProjectConfig | null> {
  // Step 1: Project name
  prompts.note(
    "Your project name will be used as the directory name\n" +
      "and the npm package name. Use lowercase letters,\n" +
      "numbers, and hyphens only.",
    "Step 1: Project Name",
  );

  const nameValue = await prompts.text({
    message: "Project name?",
    placeholder: "my-agent",
    validate: validateProjectName,
  });
  if (prompts.isCancel(nameValue)) return null;
  const projectName = normalizeProjectName(nameValue);
  if (projectName !== nameValue.trim()) {
    prompts.log.info(`Normalized to: ${projectName}`);
  }

  // Step 2: Template
  prompts.note(
    "Templates determine your project structure:\n" +
      "- Standalone: Direct SDK usage with withVault()\n" +
      "- MCP: Claude Desktop MCP server config",
    "Step 2: Template",
  );

  const templateValue = await prompts.select({
    message: "Choose a template:",
    options: TEMPLATE_CHOICES.map((t) => ({
      value: t.name,
      label: t.label,
      hint: t.description,
    })),
  });
  if (prompts.isCancel(templateValue)) return null;
  const template = templateValue as TemplateName;

  // Step 3: Network
  prompts.note(
    "Choose your target network:\n" +
      "- Devnet: Free testing, no real funds at risk\n" +
      "- Mainnet: Production use, requires TEE provider",
    "Step 3: Network",
  );

  const networkValue = await prompts.select({
    message: "Choose a network:",
    options: [
      { value: "devnet", label: "Devnet", hint: "For development and testing" },
      {
        value: "mainnet-beta",
        label: "Mainnet",
        hint: "For production (requires TEE)",
      },
    ],
  });
  if (prompts.isCancel(networkValue)) return null;
  const network = networkValue as "devnet" | "mainnet-beta";

  // Step 4: TEE provider
  prompts.note(
    "TEE (Trusted Execution Environment) protects agent\n" +
      "private keys in hardware enclaves. Required for\n" +
      "mainnet. Devnet can use 'none' for testing.",
    "Step 4: TEE Provider",
  );

  const teeValue = await prompts.select({
    message: "TEE provider:",
    options: [
      { value: "crossmint", label: "Crossmint", hint: "Intel TDX enclaves" },
      { value: "turnkey", label: "Turnkey", hint: "AWS Nitro enclaves" },
      { value: "privy", label: "Privy", hint: "AWS Nitro, embedded wallet UX" },
      { value: "none", label: "None", hint: "Devnet only (no production use)" },
    ],
  });
  if (prompts.isCancel(teeValue)) return null;
  const teeProvider = teeValue as ProjectConfig["teeProvider"];

  // Step 5: Policy preset
  prompts.note(
    "Policy presets configure spending limits, allowed\n" +
      "protocols, and slippage tolerance:\n\n" +
      Object.entries(PRESET_LABELS)
        .map(([, label]) => `  ${label}`)
        .join("\n"),
    "Step 5: Policy",
  );

  const presetValue = await prompts.select({
    message: "Policy preset:",
    options: [
      {
        value: "conservative",
        label: "Conservative",
        hint: "$100/day, Jupiter only, 1% slippage",
      },
      {
        value: "moderate",
        label: "Moderate",
        hint: "$500/day, all protocols, 3% slippage",
      },
      {
        value: "aggressive",
        label: "Aggressive",
        hint: "$2K/day, all protocols, 5% slippage",
      },
      { value: "custom", label: "Custom", hint: "Configure manually" },
    ],
  });
  if (prompts.isCancel(presetValue)) return null;
  const policyPreset = presetValue as PolicyPreset;

  let dailyCapUsd: number;
  let maxSlippageBps: number;
  let protocols: ("jupiter" | "flash-trade" | "all")[];

  if (policyPreset !== "custom") {
    const preset = PRESETS[policyPreset as Exclude<PolicyPreset, "custom">];
    dailyCapUsd = preset.dailyCapUsd;
    maxSlippageBps = preset.maxSlippageBps;
    protocols = preset.protocols;
  } else {
    prompts.note(
      "Custom policy: configure your own spending cap,\n" +
        "slippage tolerance, and protocol allowlist.",
      "Custom Configuration",
    );

    const capValue = await prompts.text({
      message: "Daily spending cap (USD)?",
      placeholder: "500",
      validate: (v) => {
        const n = Number(v);
        if (isNaN(n) || n <= 0) return "Must be a positive number";
        return undefined;
      },
    });
    if (prompts.isCancel(capValue)) return null;
    dailyCapUsd = Number(capValue);

    const slippageValue = await prompts.text({
      message: "Max slippage (basis points)? (100 = 1%)",
      placeholder: "300",
      validate: (v) => {
        const n = Number(v);
        if (isNaN(n) || n < 0 || n > 5000) return "Must be 0-5000 (0% to 50%)";
        return undefined;
      },
    });
    if (prompts.isCancel(slippageValue)) return null;
    maxSlippageBps = Number(slippageValue);

    const protocolValue = await prompts.multiselect({
      message: "Allowed protocols:",
      options: [
        { value: "all", label: "All protocols" },
        { value: "jupiter", label: "Jupiter (swaps, lend, earn)" },
        { value: "flash-trade", label: "Flash Trade (perpetuals)" },
      ],
      required: true,
    });
    if (prompts.isCancel(protocolValue)) return null;
    protocols = protocolValue as ("jupiter" | "flash-trade" | "all")[];
  }

  // Summary
  prompts.note(
    `Project:   ${projectName}\n` +
      `Template:  ${template}\n` +
      `Network:   ${network}\n` +
      `TEE:       ${teeProvider}\n` +
      `Policy:    ${policyPreset}\n` +
      `Cap:       $${dailyCapUsd}/day\n` +
      `Slippage:  ${maxSlippageBps} bps (${(maxSlippageBps / 100).toFixed(1)}%)\n` +
      `Protocols: ${protocols.join(", ")}`,
    "Summary",
  );

  const confirmed = await prompts.confirm({
    message: "Create project with these settings?",
  });
  if (prompts.isCancel(confirmed) || !confirmed) return null;

  return {
    projectName,
    template,
    network,
    teeProvider,
    policyPreset,
    dailyCapUsd,
    maxSlippageBps,
    protocols,
  };
}
