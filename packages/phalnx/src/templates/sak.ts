import {
  registerTemplate,
  type ProjectConfig,
  type GeneratedFile,
} from "./registry";

function generateSak(config: ProjectConfig): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  const deps: Record<string, string> = {
    "@phalnx/plugin-solana-agent-kit": "^0.4.0",
    "@phalnx/sdk": "^0.5.0",
    "@solana/web3.js": "^1.95.0",
    "solana-agent-kit": "^1.0.0",
  };

  files.push({
    path: "package.json",
    content: JSON.stringify(
      {
        name: config.projectName,
        version: "0.1.0",
        type: "module",
        scripts: {
          build: "tsc",
          start: "node dist/index.js",
        },
        dependencies: deps,
        devDependencies: {
          typescript: "^5.3.3",
          "@types/node": "^20.11.0",
        },
      },
      null,
      2,
    ),
  });

  files.push({
    path: "tsconfig.json",
    content: JSON.stringify(
      {
        compilerOptions: {
          target: "es2022",
          module: "es2022",
          moduleResolution: "node",
          strict: true,
          esModuleInterop: true,
          outDir: "./dist",
          rootDir: "./src",
          declaration: true,
          skipLibCheck: true,
        },
        include: ["src/**/*"],
      },
      null,
      2,
    ),
  });

  const needsUnsafeSkip =
    config.network === "devnet" || config.teeProvider === "none";

  files.push({
    path: "src/index.ts",
    content: `import { createPhalnxPlugin } from "@phalnx/plugin-solana-agent-kit";
import { SolanaAgentKit } from "solana-agent-kit";

async function main() {
  const agent = new SolanaAgentKit(
    process.env.AGENT_PRIVATE_KEY!,
    process.env.RPC_URL ?? "https://api.devnet.solana.com",
  );

  const phalnxPlugin = createPhalnxPlugin({
    maxSpend: "${config.dailyCapUsd} USDC/day",
    maxSlippageBps: ${config.maxSlippageBps},${needsUnsafeSkip ? "\n    unsafeSkipTeeCheck: true," : ""}
  });

  // Register the plugin with the agent
  agent.use(phalnxPlugin);

  console.log("SAK agent ready with Phalnx protection");
}

main().catch(console.error);
`,
  });

  files.push({
    path: ".env.example",
    content: `RPC_URL=https://api.devnet.solana.com
AGENT_PRIVATE_KEY=
`,
  });

  files.push({
    path: ".gitignore",
    content: `node_modules/
dist/
.env
`,
  });

  return files;
}

registerTemplate({
  name: "sak",
  label: "Solana Agent Kit",
  description: "Agent using @phalnx/plugin-solana-agent-kit",
  generate: generateSak,
});
