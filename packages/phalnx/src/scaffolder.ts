import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  getTemplate,
  type ProjectConfig,
  type GeneratedFile,
} from "./templates/registry";
import {
  detectPackageManager,
  getInstallCommand,
  getRunCommand,
} from "./utils";

// Side-effect imports to register all templates
import "./templates/standalone";
import "./templates/mcp";

export interface ScaffoldResult {
  projectDir: string;
  files: string[];
  config: ProjectConfig;
  gitInitialized: boolean;
}

export function scaffold(
  targetDir: string,
  config: ProjectConfig,
): ScaffoldResult {
  const template = getTemplate(config.template);
  if (!template) {
    throw new Error(`Unknown template: ${config.template}`);
  }

  const absDir = path.resolve(targetDir);

  if (fs.existsSync(absDir)) {
    const contents = fs.readdirSync(absDir);
    if (contents.length > 0) {
      throw new Error(`Directory ${targetDir} already exists and is not empty`);
    }
  }

  fs.mkdirSync(absDir, { recursive: true });

  const generated: GeneratedFile[] = template.generate(config);
  const writtenFiles: string[] = [];

  for (const file of generated) {
    const filePath = path.join(absDir, file.path);
    const fileDir = path.dirname(filePath);
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }
    fs.writeFileSync(filePath, file.content, "utf-8");
    writtenFiles.push(file.path);
  }

  const gitInitialized = tryGitInit(absDir);

  return {
    projectDir: absDir,
    files: writtenFiles,
    config,
    gitInitialized,
  };
}

export function cleanupOnFailure(targetDir: string): void {
  const absDir = path.resolve(targetDir);
  if (fs.existsSync(absDir)) {
    fs.rmSync(absDir, { recursive: true, force: true });
  }
}

export function formatPostScaffoldMessage(result: ScaffoldResult): string {
  const pm = detectPackageManager();
  const lines: string[] = [];

  lines.push(`  cd ${result.config.projectName}`);
  lines.push(`  ${getInstallCommand(pm)}`);
  lines.push(`  ${getRunCommand(pm, "build")}`);
  lines.push(`  ${getRunCommand(pm, "start")}`);

  if (result.gitInitialized) {
    lines.push("");
    lines.push("  Git repository initialized.");
  }

  lines.push("");
  lines.push("  Docs: https://docs.phalnx.com");

  return lines.join("\n");
}

function tryGitInit(dir: string): boolean {
  try {
    // Skip if already inside a git repo (execFileSync avoids shell injection)
    const result = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: dir,
      stdio: "pipe",
    });
    if (result.toString().trim() === "true") {
      return false;
    }
  } catch {
    // Not in a git repo — initialize one
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
