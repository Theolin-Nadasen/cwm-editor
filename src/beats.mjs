import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { editedToMaster, masterToEdited } from "./project.mjs";
import { run } from "./util.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SNAP_KINDS = new Set(["zoom", "stamp", "stat", "command", "chapter", "notification"]);

export async function detectBeats(dir, src) {
  if (!src || !fs.existsSync(src)) throw new Error(`Music source not found: ${src}`);
  const out = path.join(dir, "beats.json");
  const script = path.join(here, "beats.py");
  await run("python", [script, src, "--out", out], { stream: !process.env.CWMEDITOR_QUIET });
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

export function snapOverlays(project, beats, window = 0.3) {
  let snapped = 0;
  for (const overlay of project.overlays) {
    if (!SNAP_KINDS.has(overlay.kind)) continue;
    const edited = masterToEdited(project, overlay.at);
    let best = null;
    let distance = Infinity;
    for (const beat of beats) {
      const delta = Math.abs(beat - edited);
      if (delta < distance) {
        distance = delta;
        best = beat;
      }
    }
    if (best !== null && distance <= window) {
      overlay.at = editedToMaster(project, best);
      snapped += 1;
    }
  }
  return snapped;
}
