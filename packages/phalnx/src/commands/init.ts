import { Command } from "commander";
import * as prompts from "@clack/prompts";
import {
  scaffold,
  formatPostScaffoldMessage,
  cleanupOnFailure,
} from "../scaffolder";
import { validateProjectName } from "../utils";
import { PRESETS, type PolicyPreset } from "../presets";
import {
  TEMPLATE_CHOICES,
  type TemplateName,
  type ProjectConfig,
} from "../templates/registry";

const VALID_TEMPLATES: TemplateName[] = ["standalone", "sak", "elizaos", "mcp"];
const VALID_NETWORKS = ["devnet", "mainnet-beta"] as const;

const DEFAULTS: ProjectConfig = {
  projectName: "my-agent",
  template: "standalone",
  network: "devnet",
  teeProvider: "none",
  policyPreset: "moderate",
  dailyCapUsd: PRESETS.moderate.dailyCapUsd,
  maxSlippageBps: PRESETS.moderate.maxSlippageBps,
  protocols: PRESETS.moderate.protocols,
};

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Scaffold a new phalnx-protected AI agent project")
    .option("--name <name>", "Project name")
    .option("--template <template>", "Template (standalone|sak|elizaos|mcp)")
    .option("--network <network>", "Network (devnet|mainnet-beta)")
    .option("-y, --yes", "Use defaults for all prompts")
    .option("--no-git", "Skip git init")
    .action(async (opts: Record<string, string | boolean | undefined>) => {
      prompts.intro("phalnx init");

      let config: ProjectConfig | null;

      if (opts.yes) {
        config = resolveNonInteractiveConfig(opts);
      } else {
        config = await resolveConfig(opts);
      }

      if (!config) {
        prompts.cancel("Setup cancelled.");
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

export function resolveNonInteractiveConfig(
  opts: Record<string, string | boolean | undefined>,
): ProjectConfig {
  const projectName =
    typeof opts.name === "string" ? opts.name : DEFAULTS.projectName;
  const template =
    typeof opts.template === "string" &&
    VALID_TEMPLATES.includes(opts.template as TemplateName)
      ? (opts.template as TemplateName)
      : DEFAULTS.template;
  const network =
    typeof opts.network === "string" &&
    VALID_NETWORKS.includes(opts.network as (typeof VALID_NETWORKS)[number])
      ? (opts.network as "devnet" | "mainnet-beta")
      : DEFAULTS.network;

  return {
    ...DEFAULTS,
    projectName,
    template,
    network,
  };
}

export async function resolveConfig(
  opts: Record<string, string | boolean | undefined>,
): Promise<ProjectConfig | null> {
  // 1. Project name
  let projectName: string;
  if (typeof opts.name === "string") {
    const err = validateProjectName(opts.name);
    if (err) {
      prompts.log.error(err);
      return null;
    }
    projectName = opts.name;
  } else {
    const value = await prompts.text({
      message: "Project name?",
      placeholder: "my-agent",
      validate: validateProjectName,
    });
    if (prompts.isCancel(value)) return null;
    projectName = value;
  }

  // 2. Template
  let template: TemplateName;
  if (
    typeof opts.template === "string" &&
    VALID_TEMPLATES.includes(opts.template as TemplateName)
  ) {
    template = opts.template as TemplateName;
  } else if (typeof opts.template === "string") {
    prompts.log.error(
      `Invalid template: ${opts.template}. Must be one of: ${VALID_TEMPLATES.join(", ")}`,
    );
    return null;
  } else {
    const value = await prompts.select({
      message: "Choose a template:",
      options: TEMPLATE_CHOICES.map((t) => ({
        value: t.name,
        label: t.label,
        hint: t.description,
      })),
    });
    if (prompts.isCancel(value)) return null;
    template = value as TemplateName;
  }

  // 3. Network
  let network: "devnet" | "mainnet-beta";
  if (
    typeof opts.network === "string" &&
    VALID_NETWORKS.includes(opts.network as (typeof VALID_NETWORKS)[number])
  ) {
    network = opts.network as "devnet" | "mainnet-beta";
  } else if (typeof opts.network === "string") {
    prompts.log.error(
      `Invalid network: ${opts.network}. Must be devnet or mainnet-beta`,
    );
    return null;
  } else {
    const value = await prompts.select({
      message: "Choose a network:",
      options: [
        {
          value: "devnet",
          label: "Devnet",
          hint: "For development and testing",
        },
        {
          value: "mainnet-beta",
          label: "Mainnet",
          hint: "For production (requires TEE)",
        },
      ],
    });
    if (prompts.isCancel(value)) return null;
    network = value as "devnet" | "mainnet-beta";
  }

  // 4. TEE provider
  const teeValue = await prompts.select({
    message: "TEE provider:",
    options: [
      { value: "crossmint", label: "Crossmint", hint: "Intel TDX enclaves" },
      { value: "turnkey", label: "Turnkey", hint: "AWS Nitro enclaves" },
      { value: "privy", label: "Privy", hint: "AWS Nitro, embedded wallet UX" },
      {
        value: "none",
        label: "None",
        hint: "Devnet only (no production use)",
      },
    ],
  });
  if (prompts.isCancel(teeValue)) return null;
  const teeProvider = teeValue as ProjectConfig["teeProvider"];

  // 5. Policy preset
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
    // Use preset values — do NOT prompt for protocols
    const preset = PRESETS[policyPreset];
    dailyCapUsd = preset.dailyCapUsd;
    maxSlippageBps = preset.maxSlippageBps;
    protocols = preset.protocols;
  } else {
    // Custom: ask for cap, slippage, and protocols
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
      message: "Max slippage (basis points)?",
      placeholder: "300",
      validate: (v) => {
        const n = Number(v);
        if (isNaN(n) || n < 0 || n > 5000) return "Must be 0-5000 (0% to 50%)";
        return undefined;
      },
    });
    if (prompts.isCancel(slippageValue)) return null;
    maxSlippageBps = Number(slippageValue);

    // Only prompt for protocols in custom mode
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
