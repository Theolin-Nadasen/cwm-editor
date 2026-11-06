import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SFX_DIR = path.join(here, "..", "sfx");
const INDEX = path.join(SFX_DIR, "index.json");

export function listSfx() {
  if (!fs.existsSync(INDEX)) return [];
  return Object.keys(JSON.parse(fs.readFileSync(INDEX, "utf8")));
}

export function resolveSfx(name) {
  if (!name || name === "none") return null;
  const file = path.join(SFX_DIR, `${name}.wav`);
  if (!fs.existsSync(file)) {
    throw new Error(`Unknown sound "${name}". Try: ${listSfx().join(", ")}`);
  }
  return file;
}
