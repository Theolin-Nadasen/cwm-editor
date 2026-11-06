import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const from = args[args.indexOf("--from") + 1];
const to = args[args.indexOf("--to") + 1];

if (!from || !to) {
  console.error("Usage: node scripts/migrate-paths.mjs --from D:/old/root --to D:/new/root");
  process.exit(1);
}

const forms = (value) => [
  value.replace(/\\/g, "\\\\"),
  value.replace(/\\/g, "/"),
  value,
];

const pairs = forms(from).map((value, index) => [value, forms(to)[index]]);
const root = path.resolve("projects");
const files = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (["project.json", "plan.json", "beats.json"].includes(entry.name)) files.push(full);
  }
}

walk(root);

let changed = 0;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  let next = text;
  for (const [oldValue, newValue] of pairs) next = next.split(oldValue).join(newValue);
  if (next !== text) {
    fs.writeFileSync(file, next);
    changed += 1;
  }
}

console.log(`Checked ${files.length} project files, rewrote ${changed}.`);
