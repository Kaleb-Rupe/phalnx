export type TemplateName = "standalone" | "mcp";
export type TeeProvider = "crossmint" | "turnkey" | "privy" | "none";

export interface ProjectConfig {
  projectName: string;
  template: TemplateName;
  network: "devnet" | "mainnet-beta";
  teeProvider: TeeProvider;
  policyPreset: string;
  dailyCapUsd: number;
  maxSlippageBps: number;
  protocols: ("jupiter" | "flash-trade" | "all")[];
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface TemplateGenerator {
  name: TemplateName;
  label: string;
  description: string;
  generate: (config: ProjectConfig) => GeneratedFile[];
}

const templateRegistry = new Map<TemplateName, TemplateGenerator>();

export function registerTemplate(generator: TemplateGenerator): void {
  templateRegistry.set(generator.name, generator);
}

export function getTemplate(name: TemplateName): TemplateGenerator | undefined {
  return templateRegistry.get(name);
}

export function getAllTemplates(): TemplateGenerator[] {
  return Array.from(templateRegistry.values());
}

export interface TemplateChoice {
  name: TemplateName;
  label: string;
  description: string;
}

export const TEMPLATE_CHOICES: TemplateChoice[] = [
  {
    name: "standalone",
    label: "Standalone Agent",
    description: "Minimal agent with on-chain vault protection",
  },
  {
    name: "mcp",
    label: "MCP Server",
    description: "Claude Desktop MCP server with @phalnx/mcp",
  },
];
