import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  scaffold,
  cleanupOnFailure,
  formatPostScaffoldMessage,
  type ScaffoldResult,
} from "../src/scaffolder";
import type { ProjectConfig } from "../src/templates/registry";

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

describe("scaffolder", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phalnx-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("scaffold", () => {
    it("creates directory and writes files", () => {
      const targetDir = path.join(tmpDir, "test-project");
      const result = scaffold(targetDir, baseConfig);

      expect(fs.existsSync(targetDir)).to.be.true;
      expect(result.files).to.be.an("array").that.is.not.empty;
      expect(result.config).to.deep.equal(baseConfig);
    });

    it("returns list of generated files", () => {
      const targetDir = path.join(tmpDir, "test-project");
      const result = scaffold(targetDir, baseConfig);
      expect(result.files).to.include("package.json");
      expect(result.files).to.include("src/index.ts");
    });

    it("throws if directory exists and is not empty", () => {
      const targetDir = path.join(tmpDir, "test-project");
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, "existing.txt"), "data");

      expect(() => scaffold(targetDir, baseConfig)).to.throw(
        "already exists and is not empty",
      );
    });

    it("allows scaffolding into existing empty directory", () => {
      const targetDir = path.join(tmpDir, "test-project");
      fs.mkdirSync(targetDir, { recursive: true });

      const result = scaffold(targetDir, baseConfig);
      expect(result.files).to.be.an("array").that.is.not.empty;
    });

    it("throws for unknown template", () => {
      const targetDir = path.join(tmpDir, "test-project");
      expect(() =>
        scaffold(targetDir, {
          ...baseConfig,
          template: "unknown" as any,
        }),
      ).to.throw("Unknown template");
    });

    it("works with all 2 templates", () => {
      const templates = ["standalone", "mcp"] as const;
      for (const tmpl of templates) {
        const targetDir = path.join(tmpDir, `test-${tmpl}`);
        const result = scaffold(targetDir, {
          ...baseConfig,
          template: tmpl,
        });
        expect(
          result.files.length,
          `${tmpl} should generate files`,
        ).to.be.greaterThan(0);
      }
    });

    it("creates subdirectories for nested files", () => {
      const targetDir = path.join(tmpDir, "test-project");
      scaffold(targetDir, baseConfig);
      expect(fs.existsSync(path.join(targetDir, "src"))).to.be.true;
    });

    it("writes actual file contents", () => {
      const targetDir = path.join(tmpDir, "test-project");
      scaffold(targetDir, baseConfig);
      const pkgContent = fs.readFileSync(
        path.join(targetDir, "package.json"),
        "utf-8",
      );
      const pkg = JSON.parse(pkgContent);
      expect(pkg.name).to.equal("test-project");
    });

    it("uses config values in generated code", () => {
      const targetDir = path.join(tmpDir, "test-project");
      scaffold(targetDir, { ...baseConfig, dailyCapUsd: 1000 });
      const indexContent = fs.readFileSync(
        path.join(targetDir, "src", "index.ts"),
        "utf-8",
      );
      expect(indexContent).to.include("1000");
    });

    it("includes unsafeSkipTeeCheck for devnet", () => {
      const targetDir = path.join(tmpDir, "test-project");
      scaffold(targetDir, baseConfig);
      const indexContent = fs.readFileSync(
        path.join(targetDir, "src", "index.ts"),
        "utf-8",
      );
      expect(indexContent).to.include("unsafeSkipTeeCheck");
    });

    it("initializes git when not inside an existing repo", () => {
      // tmpDir is in os.tmpdir() which is outside any git repo
      const targetDir = path.join(tmpDir, "test-project");
      const result = scaffold(targetDir, baseConfig);
      expect(result.gitInitialized).to.be.true;
      expect(fs.existsSync(path.join(targetDir, ".git"))).to.be.true;
    });
  });

  describe("cleanupOnFailure", () => {
    it("removes directory when it exists", () => {
      const targetDir = path.join(tmpDir, "cleanup-test");
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, "file.txt"), "data");

      cleanupOnFailure(targetDir);
      expect(fs.existsSync(targetDir)).to.be.false;
    });

    it("does nothing when directory does not exist", () => {
      const targetDir = path.join(tmpDir, "nonexistent");
      // Should not throw
      cleanupOnFailure(targetDir);
      expect(fs.existsSync(targetDir)).to.be.false;
    });
  });

  describe("formatPostScaffoldMessage", () => {
    it("includes cd, install, build, and start commands", () => {
      const result: ScaffoldResult = {
        projectDir: "/tmp/test-project",
        files: ["package.json", "src/index.ts"],
        config: baseConfig,
        gitInitialized: false,
      };

      const msg = formatPostScaffoldMessage(result);
      expect(msg).to.include("cd test-project");
      expect(msg).to.include("install");
      expect(msg).to.include("build");
      expect(msg).to.include("start");
    });

    it("includes git message when git was initialized", () => {
      const result: ScaffoldResult = {
        projectDir: "/tmp/test-project",
        files: ["package.json"],
        config: baseConfig,
        gitInitialized: true,
      };

      const msg = formatPostScaffoldMessage(result);
      expect(msg).to.include("Git repository initialized");
    });

    it("omits git message when git was not initialized", () => {
      const result: ScaffoldResult = {
        projectDir: "/tmp/test-project",
        files: ["package.json"],
        config: baseConfig,
        gitInitialized: false,
      };

      const msg = formatPostScaffoldMessage(result);
      expect(msg).to.not.include("Git repository initialized");
    });

    it("includes docs link", () => {
      const result: ScaffoldResult = {
        projectDir: "/tmp/test-project",
        files: ["package.json"],
        config: baseConfig,
        gitInitialized: false,
      };

      const msg = formatPostScaffoldMessage(result);
      expect(msg).to.include("docs.phalnx.com");
    });

    it("handles different project names", () => {
      const result: ScaffoldResult = {
        projectDir: "/tmp/my-cool-agent",
        files: ["package.json"],
        config: { ...baseConfig, projectName: "my-cool-agent" },
        gitInitialized: false,
      };

      const msg = formatPostScaffoldMessage(result);
      expect(msg).to.include("cd my-cool-agent");
    });
  });
});
