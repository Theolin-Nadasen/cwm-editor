import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const STICKER_DIR = path.join(here, "..", "stickers");
const INDEX_FILE = path.join(STICKER_DIR, "index.json");

export function loadIndex() {
  if (!fs.existsSync(INDEX_FILE)) return {};
  return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
}

export function listStickers() {
  return Object.keys(loadIndex()).sort();
}

// Accepts a name from the index or a direct file path.
export function resolveSticker(name) {
  if (!name) throw new Error("Sticker name is required");
  if (fs.existsSync(name)) return path.resolve(name);
  const index = loadIndex();
  const entry = index[name];
  if (!entry) {
    const names = Object.keys(index).slice(0, 12).join(", ");
    throw new Error(`Unknown sticker "${name}". Try: ${names} ... (run: cwmeditor stickers)`);
  }
  return path.join(STICKER_DIR, path.basename(entry.file));
}
