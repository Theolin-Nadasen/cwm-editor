import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const displayIndex = args.indexOf("--display");
const display = displayIndex >= 0 ? args[displayIndex + 1] : null;
const newName = args.find((value, index) => !value.startsWith("--") && index !== displayIndex + 1);
const oldName = "cwmeditor";

if (!newName) {
  console.error("Usage: node scripts/rename.mjs <new-name> [--dry-run]");
  console.error("Example: node scripts/rename.mjs roughcut");
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]{1,24}$/.test(newName)) {
  console.error("Name must be lowercase letters, digits or dashes, starting with a letter.");
  process.exit(1);
}

const cap = (value) => value.charAt(0).toUpperCase() + value.slice(1);
const displayName = display ?? cap(newName);
const replacements = [
  [new RegExp(oldName.toUpperCase(), "g"), newName.toUpperCase()],
  [new RegExp(cap(oldName), "g"), displayName],
  [new RegExp(oldName, "g"), newName],
];

const SKIP_DIRS = new Set(["projects", "node_modules", ".git", "out", "work"]);
const SKIP_FILES = new Set(["scripts/rename.mjs"]);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name === "tmp") continue;
      files.push(...walk(path.join(dir, entry.name)));
    } else {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

const EXTENSIONS = new Set([".mjs", ".js", ".py", ".json", ".md", ".txt", ".html"]);
const changes = [];

for (const file of walk(root)) {
  const relative = path.relative(root, file).replace(/\\/g, "/");
  if (SKIP_FILES.has(relative)) continue;
  if (!EXTENSIONS.has(path.extname(file))) continue;
  const text = fs.readFileSync(file, "utf8");
  let next = text;
  for (const [pattern, value] of replacements) next = next.replace(pattern, value);
  if (next !== text) {
    const count = text.match(new RegExp(oldName, "gi"))?.length ?? 0;
    changes.push({ relative, count });
    if (!dryRun) fs.writeFileSync(file, next);
  }
}

const oldCli = path.join(root, `${oldName}.mjs`);
const newCli = path.join(root, `${newName}.mjs`);
if (fs.existsSync(oldCli) && !dryRun) fs.renameSync(oldCli, newCli);

console.log(dryRun ? "Dry run, nothing written." : "Renamed.");
console.log(`Files changed: ${changes.length}`);
for (const change of changes.sort((a, b) => b.count - a.count)) {
  console.log(`  ${change.relative}  (${change.count})`);
}
if (fs.existsSync(oldCli)) {
  console.log(`\n${dryRun ? "Would rename" : "Renamed"} ${oldName}.mjs -> ${newName}.mjs`);
}
console.log(`
Next steps:
  1. Rename the folder itself, e.g. D:\\Documents\\${oldName} -> D:\\Documents\\${newName}
  2. Existing projects store absolute asset paths under the old folder root.
     After moving the folder, update those paths in projects/*/project.json,
     plan.json and beats.json (or rebuild the projects).
  3. Update the MCP entry in your opencode.json to the new tool prefix.
`);
