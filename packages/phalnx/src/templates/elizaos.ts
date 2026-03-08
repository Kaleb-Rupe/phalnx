import {
  registerTemplate,
  type ProjectConfig,
  type GeneratedFile,
} from "./registry";

function generateElizaos(config: ProjectConfig): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  const deps: Record<string, string> = {
    "@phalnx/elizaos": "^0.4.0",
    "@phalnx/sdk": "^0.5.0",
    "@solana/web3.js": "^1.95.0",
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

  const teeEnvLines: string[] = [];
  if (config.teeProvider === "crossmint") {
    teeEnvLines.push("CROSSMINT_API_KEY=");
  } else if (config.teeProvider === "turnkey") {
    teeEnvLines.push("TURNKEY_API_KEY=");
    teeEnvLines.push("TURNKEY_ORGANIZATION_ID=");
  } else if (config.teeProvider === "privy") {
    teeEnvLines.push("PRIVY_APP_ID=");
    teeEnvLines.push("PRIVY_APP_SECRET=");
  }

  files.push({
    path: "src/index.ts",
    content: `import { phalnxPlugin } from "@phalnx/elizaos";

// Register with your ElizaOS runtime
export default {
  plugins: [
    phalnxPlugin({
      maxSpend: "${config.dailyCapUsd} USDC/day",
      maxSlippageBps: ${config.maxSlippageBps},${needsUnsafeSkip ? "\n      unsafeSkipTeeCheck: true," : ""}
    }),
  ],
};
`,
  });

  const envVars = [
    "RPC_URL=https://api.devnet.solana.com",
    "AGENT_PRIVATE_KEY=",
    ...teeEnvLines,
  ];

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
  name: "elizaos",
  label: "ElizaOS Plugin",
  description: "ElizaOS agent with @phalnx/elizaos plugin",
  generate: generateElizaos,
});
