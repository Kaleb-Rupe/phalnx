// codama.mjs — Generate Kit-native client from Anchor IDL
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { createFromRoot } from "codama";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read the committed Anchor IDL
const idlPath = join(__dirname, "..", "..", "target", "idl", "phalnx.json");
const anchorIdl = JSON.parse(readFileSync(idlPath, "utf-8"));

// Parse into Codama IDL
const codama = createFromRoot(rootNodeFromAnchor(anchorIdl));

// Generate Kit-native JS client
// renderVisitor creates a full npm package structure (package.json + src/generated/).
// We render to a temp dir and move the inner src/generated/ to our src/generated/.
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "codama-"));
await codama.accept(renderVisitor(tempDir));

const outputDir = join(__dirname, "src", "generated");
rmSync(outputDir, { recursive: true, force: true });
cpSync(join(tempDir, "src", "generated"), outputDir, { recursive: true });
rmSync(tempDir, { recursive: true, force: true });

console.log(`Generated Kit-native client in ${outputDir}`);
