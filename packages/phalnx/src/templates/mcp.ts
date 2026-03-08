import {
  registerTemplate,
  type ProjectConfig,
  type GeneratedFile,
} from "./registry";

function generateMcp(config: ProjectConfig): GeneratedFile[] {
  const files: GeneratedFile[] = [];

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
        dependencies: {
          "@phalnx/mcp": "^0.4.0",
        },
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

  files.push({
    path: "src/index.ts",
    content: `// MCP server entry point
// The @phalnx/mcp package provides the full MCP server.
// Configure it via ~/.phalnx/config.json (created by the shield_configure tool).
console.log("Use the phalnx-mcp binary or configure via Claude Desktop.");
console.log("Run: npx @phalnx/mcp");
`,
  });

  const mcpConfig = {
    mcpServers: {
      phalnx: {
        command: "npx",
        args: ["-y", "@phalnx/mcp"],
        env: {
          RPC_URL: "https://api.devnet.solana.com",
        },
      },
    },
  };

  files.push({
    path: "mcp-config.json",
    content: JSON.stringify(mcpConfig, null, 2) + "\n",
  });

  files.push({
    path: "README.md",
    content: `# ${config.projectName}

## Setup

1. Copy \`mcp-config.json\` to your Claude Desktop config:
   - macOS: \`~/Library/Application Support/Claude/claude_desktop_config.json\`
   - Windows: \`%APPDATA%\\Claude\\claude_desktop_config.json\`

2. Configure your vault:
   - Use the \`shield_configure\` tool in Claude Desktop
   - Or create \`~/.phalnx/config.json\` manually

3. Restart Claude Desktop

## Available Tools

The MCP server provides 49 tools for vault management, DeFi operations,
and Squads multisig governance. Use \`shield_setup_status\` to check your
configuration.
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
  name: "mcp",
  label: "MCP Server",
  description: "Claude Desktop MCP server with @phalnx/mcp",
  generate: generateMcp,
});
