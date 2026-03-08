import {
  registerTemplate,
  type ProjectConfig,
  type GeneratedFile,
} from "./registry";

function generateStandalone(config: ProjectConfig): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  const deps: Record<string, string> = {
    "@phalnx/sdk": "^0.5.0",
    "@solana/web3.js": "^1.95.0",
  };
  if (config.teeProvider === "crossmint") {
    deps["@phalnx/custody-crossmint"] = "^0.1.0";
  }

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
    content: `import { withVault } from "@phalnx/sdk";
import { Connection, Keypair } from "@solana/web3.js";

const connection = new Connection(
  process.env.RPC_URL ?? "https://api.devnet.solana.com",
);

async function main() {
  const agentKeypair = Keypair.generate();

  const result = await withVault(agentKeypair, {
    maxSpend: "${config.dailyCapUsd} USDC/day",
    maxSlippageBps: ${config.maxSlippageBps},${needsUnsafeSkip ? "\n    unsafeSkipTeeCheck: true," : ""}
  }, { connection });

  console.log("Vault ready:", result.vault.toBase58());
}

main().catch(console.error);
`,
  });

  const envVars = [
    `RPC_URL=https://api.devnet.solana.com`,
    `AGENT_PRIVATE_KEY=`,
  ];
  if (config.teeProvider === "crossmint") {
    envVars.push("CROSSMINT_API_KEY=");
  } else if (config.teeProvider === "turnkey") {
    envVars.push("TURNKEY_API_KEY=");
    envVars.push("TURNKEY_ORGANIZATION_ID=");
  } else if (config.teeProvider === "privy") {
    envVars.push("PRIVY_APP_ID=");
    envVars.push("PRIVY_APP_SECRET=");
  }

  files.push({
    path: ".env.example",
    content: envVars.join("\n") + "\n",
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
  name: "standalone",
  label: "Standalone Agent",
  description: "Minimal agent with on-chain vault protection",
  generate: generateStandalone,
});
