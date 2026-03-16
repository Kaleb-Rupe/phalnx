import { expect } from "chai";
import {
  registerTemplate,
  getTemplate,
  getAllTemplates,
  TEMPLATE_CHOICES,
  type ProjectConfig,
  type TemplateGenerator,
} from "../src/templates/registry";

// Import templates to register them
import "../src/templates/standalone";
import "../src/templates/mcp";

const baseConfig: ProjectConfig = {
  projectName: "test-project",
  template: "standalone",
  network: "devnet",
  teeProvider: "none",
  policyPreset: "moderate",
  dailyCapUsd: 500,
  maxSlippageBps: 300,
  protocols: ["all"],
};

describe("templates", () => {
  describe("registry", () => {
    it("has all 2 templates registered", () => {
      const all = getAllTemplates();
      expect(all).to.have.lengthOf(2);
    });

    it("retrieves templates by name", () => {
      expect(getTemplate("standalone")).to.not.be.undefined;
      expect(getTemplate("mcp")).to.not.be.undefined;
    });

    it("returns undefined for unknown template", () => {
      expect(getTemplate("unknown" as any)).to.be.undefined;
    });

    it("TEMPLATE_CHOICES has 2 entries", () => {
      expect(TEMPLATE_CHOICES).to.have.lengthOf(2);
      const names = TEMPLATE_CHOICES.map((c) => c.name);
      expect(names).to.include("standalone");
      expect(names).to.include("mcp");
    });
  });

  describe("standalone template", () => {
    it("generates required files", () => {
      const tmpl = getTemplate("standalone")!;
      const files = tmpl.generate(baseConfig);
      const paths = files.map((f) => f.path);
      expect(paths).to.include("package.json");
      expect(paths).to.include("tsconfig.json");
      expect(paths).to.include("src/index.ts");
      expect(paths).to.include(".env.example");
      expect(paths).to.include(".gitignore");
    });

    it("includes unsafeSkipTeeCheck for devnet", () => {
      const tmpl = getTemplate("standalone")!;
      const files = tmpl.generate(baseConfig);
      const indexFile = files.find((f) => f.path === "src/index.ts")!;
      expect(indexFile.content).to.include("unsafeSkipTeeCheck");
    });

    it("omits unsafeSkipTeeCheck for mainnet with TEE", () => {
      const tmpl = getTemplate("standalone")!;
      const files = tmpl.generate({
        ...baseConfig,
        network: "mainnet-beta",
        teeProvider: "crossmint",
      });
      const indexFile = files.find((f) => f.path === "src/index.ts")!;
      expect(indexFile.content).to.not.include("unsafeSkipTeeCheck");
    });

    it("includes crossmint dependency when selected", () => {
      const tmpl = getTemplate("standalone")!;
      const files = tmpl.generate({
        ...baseConfig,
        teeProvider: "crossmint",
      });
      const pkg = files.find((f) => f.path === "package.json")!;
      expect(pkg.content).to.include("custody-crossmint");
    });

    it("includes crossmint env var when selected", () => {
      const tmpl = getTemplate("standalone")!;
      const files = tmpl.generate({
        ...baseConfig,
        teeProvider: "crossmint",
      });
      const env = files.find((f) => f.path === ".env.example")!;
      expect(env.content).to.include("CROSSMINT_API_KEY");
    });

    it("uses config values in generated code", () => {
      const tmpl = getTemplate("standalone")!;
      const files = tmpl.generate({
        ...baseConfig,
        dailyCapUsd: 100,
        maxSlippageBps: 100,
      });
      const indexFile = files.find((f) => f.path === "src/index.ts")!;
      expect(indexFile.content).to.include("100 USDC/day");
      expect(indexFile.content).to.include("maxSlippageBps: 100");
    });
  });

  describe("mcp template", () => {
    it("generates required files", () => {
      const tmpl = getTemplate("mcp")!;
      const files = tmpl.generate({ ...baseConfig, template: "mcp" });
      const paths = files.map((f) => f.path);
      expect(paths).to.include("package.json");
      expect(paths).to.include("mcp-config.json");
      expect(paths).to.include("README.md");
    });

    it("includes MCP dependency", () => {
      const tmpl = getTemplate("mcp")!;
      const files = tmpl.generate({ ...baseConfig, template: "mcp" });
      const pkg = files.find((f) => f.path === "package.json")!;
      expect(pkg.content).to.include("@phalnx/mcp");
    });

    it("mcp-config has correct structure", () => {
      const tmpl = getTemplate("mcp")!;
      const files = tmpl.generate({ ...baseConfig, template: "mcp" });
      const config = files.find((f) => f.path === "mcp-config.json")!;
      const parsed = JSON.parse(config.content);
      expect(parsed).to.have.property("mcpServers");
      expect(parsed.mcpServers).to.have.property("phalnx");
      expect(parsed.mcpServers.phalnx.command).to.equal("npx");
    });
  });

  describe("cross-template validation", () => {
    it("all templates generate .gitignore", () => {
      const templates = getAllTemplates();
      for (const tmpl of templates) {
        const files = tmpl.generate({
          ...baseConfig,
          template: tmpl.name,
        });
        const paths = files.map((f) => f.path);
        expect(paths, `${tmpl.name} missing .gitignore`).to.include(
          ".gitignore",
        );
      }
    });

    it("all templates generate package.json with project name", () => {
      const templates = getAllTemplates();
      for (const tmpl of templates) {
        const files = tmpl.generate({
          ...baseConfig,
          template: tmpl.name,
          projectName: "my-test-proj",
        });
        const pkg = files.find((f) => f.path === "package.json")!;
        expect(pkg.content, `${tmpl.name} missing project name`).to.include(
          "my-test-proj",
        );
      }
    });

    it("all templates generate valid JSON package.json", () => {
      const templates = getAllTemplates();
      for (const tmpl of templates) {
        const files = tmpl.generate({
          ...baseConfig,
          template: tmpl.name,
        });
        const pkg = files.find((f) => f.path === "package.json")!;
        expect(() => JSON.parse(pkg.content), `${tmpl.name} invalid JSON`).to
          .not.throw;
      }
    });
  });
});
