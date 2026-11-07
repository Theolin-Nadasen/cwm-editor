import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clamp } from "./util.mjs";

export const DEFAULT_FORMAT = { w: 1920, h: 1080, fps: 30, fit: "cover" };
export const HISTORY_LIMIT = 25;

export const FORMAT_PRESETS = {
  landscape: { w: 1920, h: 1080, fit: "cover" },
  vertical: { w: 1080, h: 1920, fit: "blur" },
  tiktok: { w: 1080, h: 1920, fit: "blur" },
  shorts: { w: 1080, h: 1920, fit: "blur" },
  reels: { w: 1080, h: 1920, fit: "blur" },
  square: { w: 1080, h: 1080, fit: "blur" },
};

export function formatPreset(name) {
  if (name == null || name === "") return null;
  const preset = FORMAT_PRESETS[String(name).toLowerCase()];
  if (!preset) {
    throw new Error(`Unknown format preset: ${name}. Use ${Object.keys(FORMAT_PRESETS).join(", ")}`);
  }
  return { ...preset, name: String(name).toLowerCase() };
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_DIRS = new Set(["stickers", "sfx", "beds", "memes"]);

export function projectPaths(dir) {
  const root = path.resolve(dir);
  return {
    root,
    projectFile: path.join(root, "project.json"),
    media: path.join(root, "media"),
    work: path.join(root, "work"),
    out: path.join(root, "out"),
  };
}

export function resolveMember(dir, rel) {
  if (path.isAbsolute(rel)) return rel;
  const first = String(rel).split(/[\\/]/)[0];
  if (ASSET_DIRS.has(first)) return path.join(REPO_ROOT, rel);
  return path.join(dir, rel);
}

// Assets inside the repo are stored repo-relative so the project is portable.
export function toStoredPath(file) {
  const absolute = path.resolve(file);
  const relative = path.relative(REPO_ROOT, absolute).replace(/\\/g, "/");
  if (relative.startsWith("..") || path.isAbsolute(relative)) return absolute;
  const first = relative.split("/")[0];
  if (!ASSET_DIRS.has(first)) return absolute;
  return relative;
}

export function load(dir) {
  const { projectFile } = projectPaths(dir);
  if (!fs.existsSync(projectFile)) {
    throw new Error(`No project.json found in ${dir}. Run: cwmeditor init <dir> --source <file>`);
  }
  return JSON.parse(fs.readFileSync(projectFile, "utf8"));
}

export function serializable(project) {
  const copy = { ...project };
  for (const key of Object.keys(copy)) {
    if (key.startsWith("__") || key.startsWith("_")) delete copy[key];
  }
  return copy;
}

export function save(dir, project) {
  const { projectFile, root } = projectPaths(dir);
  fs.mkdirSync(root, { recursive: true });
  project.updated = new Date().toISOString();
  fs.writeFileSync(projectFile, `${JSON.stringify(serializable(project), null, 2)}\n`);
}

export function snapshot(project) {
  project.history = project.history ?? [];
  const { history, ...rest } = serializable(project);
  project.history.push({
    at: new Date().toISOString(),
    state: JSON.stringify(rest),
  });
  if (project.history.length > HISTORY_LIMIT) project.history.shift();
}

export function sortedCuts(project) {
  return [...project.cuts].sort((a, b) => a.start - b.start);
}

export function editedDuration(project) {
  const total = project.master.duration;
  let removed = 0;
  for (const cut of project.cuts) {
    removed += Math.max(0, Math.min(cut.end, total) - Math.max(cut.start, 0));
  }
  return Math.max(0, total - removed);
}

// Master-time ranges that survive the cuts, in order.
export function keptRanges(project) {
  const total = project.master.duration;
  const ranges = [];
  let cursor = 0;
  for (const cut of sortedCuts(project)) {
    const start = clamp(cut.start, 0, total);
    const end = clamp(cut.end, 0, total);
    if (start > cursor) ranges.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < total) ranges.push({ start: cursor, end: total });
  return ranges.filter((r) => r.end - r.start > 0.001);
}

export function masterToEdited(project, t) {
  let removed = 0;
  for (const cut of sortedCuts(project)) {
    if (t <= cut.start) break;
    if (t < cut.end) return cut.start - removed;
    removed += cut.end - cut.start;
  }
  return t - removed;
}

export function editedToMaster(project, t) {
  let removed = 0;
  for (const cut of sortedCuts(project)) {
    if (t < cut.start - removed) return t + removed;
    removed += cut.end - cut.start;
  }
  return t + removed;
}

export function isCutAway(project, masterTime) {
  return project.cuts.some((c) => masterTime >= c.start && masterTime < c.end);
}

export function nextId(items, prefix) {
  const used = new Set(items.map((i) => i.id));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

export function initProject({ name, source, format = DEFAULT_FORMAT, duration, hasVideo = true }) {
  return {
    version: 1,
    name,
    created: new Date().toISOString(),
    format: { ...DEFAULT_FORMAT, ...format },
    theme: "neon",
    master: {
      video: source,
      audio: source,
      duration,
      hasVideo,
    },
    cuts: [],
    broll: [],
    overlays: [],
    audio: {
      music: null,
      musicGainDb: -10,
      musicFit: "loop",
      musicFade: 0.6,
      duck: true,
      duckProfile: "soft",
      voiceClean: true,
      voiceStrength: "light",
      targetLufs: -14,
      truePeak: -1,
    },
    captions: { enabled: true, style: "karaoke", font: "Arial", fontSize: null },
    transcript: null,
    history: [],
  };
}

export function projectSummary(project) {
  return {
    name: project.name,
    format: `${project.format.w}x${project.format.h} @ ${project.format.fps}fps`,
    fit: project.format.fit ?? "cover",
    masterDuration: project.master.duration,
    editedDuration: editedDuration(project),
    cuts: project.cuts.length,
    broll: project.broll.length,
    overlays: project.overlays.length,
    captions: project.captions.enabled,
    music: project.audio.music ?? null,
    transcript: project.transcript ?? null,
  };
}
