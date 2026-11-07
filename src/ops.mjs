import fs from "node:fs";
import path from "node:path";
import {
  editedDuration,
  editedToMaster,
  isCutAway,
  masterToEdited,
  nextId,
  resolveMember,
  snapshot,
  toStoredPath,
} from "./project.mjs";
import { THEMES, getTheme, themeNames } from "./themes.mjs";
import { resolveSticker } from "./stickers.mjs";
import { clamp, parseTime, round } from "./util.mjs";

function editedBounds(project, from, to) {
  const duration = editedDuration(project);
  const start = clamp(parseTime(from), 0, duration);
  const end = clamp(parseTime(to), 0, duration);
  if (end - start < 0.05) throw new Error(`Range too small: ${from} -> ${to}`);
  return { start, end };
}

export function addCut(project, { from, to, label = "cut" }) {
  const { start, end } = editedBounds(project, from, to);
  const masterStart = editedToMaster(project, start);
  const masterEnd = editedToMaster(project, end);
  snapshot(project);
  project.cuts.push({
    id: nextId(project.cuts, "c"),
    start: round(masterStart, 3),
    end: round(masterEnd, 3),
    label,
  });
  project.cuts.sort((a, b) => a.start - b.start);
  return { removed: round(end - start, 2), at: round(start, 2), label };
}

export function removeCut(project, id) {
  const index = project.cuts.findIndex((c) => c.id === id);
  if (index === -1) throw new Error(`No cut ${id}`);
  snapshot(project);
  const [cut] = project.cuts.splice(index, 1);
  return { restored: round(cut.end - cut.start, 2), id };
}

export function addBroll(project, { from, to, src, srcIn = 0 }) {
  const { start, end } = editedBounds(project, from, to);
  const absolute = resolveMember(projectDirOf(project), src);
  if (!fs.existsSync(absolute)) {
    throw new Error(`B-roll source not found: ${src}`);
  }
  const stored = toStoredPath(absolute);
  const masterStart = editedToMaster(project, start);
  const masterEnd = editedToMaster(project, end);
  snapshot(project);
  project.broll = project.broll.filter((b) => b.end <= masterStart || b.start >= masterEnd);
  project.broll.push({
    id: nextId(project.broll, "b"),
    start: round(masterStart, 3),
    end: round(masterEnd, 3),
    src: stored,
    srcIn: round(parseTime(srcIn), 3),
    fit: "cover",
  });
  project.broll.sort((a, b) => a.start - b.start);
  return { at: round(start, 2), duration: round(end - start, 2), src: stored };
}

export function removeBroll(project, id) {
  const index = project.broll.findIndex((b) => b.id === id);
  if (index === -1) throw new Error(`No b-roll ${id}`);
  snapshot(project);
  project.broll.splice(index, 1);
  return { id };
}

export function clearBroll(project) {
  snapshot(project);
  const count = project.broll.length;
  project.broll = [];
  return { cleared: count };
}

export function addMeme(project, { at, src, dur = 1.2, pos = "center", scale = 0.4, style = "pop", sound = null }) {
  if (!fs.existsSync(resolveMember(projectDirOf(project), src))) {
    throw new Error(`Meme source not found: ${src}`);
  }
  const duration = editedDuration(project);
  const start = clamp(parseTime(at), 0, Math.max(0, duration - 0.1));
  const masterStart = editedToMaster(project, start);
  snapshot(project);
  const overlay = {
    id: nextId(project.overlays, "o"),
    kind: "meme",
    at: round(masterStart, 3),
    dur: round(Number(dur), 3),
    src,
    pos,
    scale: clamp(Number(scale), 0.05, 1),
    style,
    sound: sound ?? null,
  };
  project.overlays.push(overlay);
  return { id: overlay.id, at: round(start, 2), dur: overlay.dur, src };
}

export function addText(project, { at, text, dur = 2, pos = "bottom" }) {
  const duration = editedDuration(project);
  const start = clamp(parseTime(at), 0, Math.max(0, duration - 0.1));
  snapshot(project);
  const overlay = {
    id: nextId(project.overlays, "o"),
    kind: "text",
    at: round(editedToMaster(project, start), 3),
    dur: round(Number(dur), 3),
    text,
    pos,
  };
  project.overlays.push(overlay);
  return { id: overlay.id, at: round(start, 2), dur: overlay.dur, text };
}

export function removeOverlay(project, id) {
  const index = project.overlays.findIndex((o) => o.id === id);
  if (index === -1) throw new Error(`No overlay ${id}`);
  snapshot(project);
  project.overlays.splice(index, 1);
  return { id };
}

export function addSticker(project, { name, at, dur = 1.4, pos = "center", scale = 0.2, sound = "pop" }) {
  const src = resolveSticker(name);
  const duration = editedDuration(project);
  const start = clamp(parseTime(at), 0, Math.max(0, duration - 0.1));
  snapshot(project);
  const overlay = {
    id: nextId(project.overlays, "o"),
    kind: "sticker",
    at: round(editedToMaster(project, start), 3),
    dur: round(Number(dur), 3),
    src: toStoredPath(src),
    pos,
    scale: clamp(Number(scale), 0.04, 0.8),
    sound: sound ?? "pop",
  };
  project.overlays.push(overlay);
  return { id: overlay.id, at: round(start, 2), dur: overlay.dur, sticker: name };
}

export function addBubble(project, { text, at, dur = 2.2, pos = "bottom-right", side = "left", label = "chat", sound = "pop", icon = "thinking" }) {
  const duration = editedDuration(project);
  const start = clamp(parseTime(at), 0, Math.max(0, duration - 0.1));
  snapshot(project);
  const overlay = {
    id: nextId(project.overlays, "o"),
    kind: "bubble",
    at: round(editedToMaster(project, start), 3),
    dur: round(Number(dur), 3),
    text: String(text),
    pos,
    side,
    label,
    icon,
    sound: sound ?? "pop",
  };
  project.overlays.push(overlay);
  return { id: overlay.id, at: round(start, 2), dur: overlay.dur, text: overlay.text };
}

export function addToast(project, { text, at, dur = 3, pos = "top", label = "Achievement unlocked", sound = "ding", icon = "check" }) {
  const duration = editedDuration(project);
  const start = clamp(parseTime(at), 0, Math.max(0, duration - 0.1));
  snapshot(project);
  const overlay = {
    id: nextId(project.overlays, "o"),
    kind: "toast",
    at: round(editedToMaster(project, start), 3),
    dur: round(Number(dur), 3),
    text: String(text),
    label,
    pos,
    icon,
    sound: sound ?? "ding",
  };
  project.overlays.push(overlay);
  return { id: overlay.id, at: round(start, 2), dur: overlay.dur, text: overlay.text };
}

export function addChat(project, { messages, at, dur = 4, pos = "bottom-right", sound = "pop" }) {
  const list = (Array.isArray(messages) ? messages : String(messages).split("|"))
    .map((m) => (typeof m === "string" ? { text: m.trim() } : m))
    .filter((m) => m.text);
  if (!list.length) throw new Error("chat needs at least one message");
  const duration = editedDuration(project);
  const start = clamp(parseTime(at), 0, Math.max(0, duration - 0.1));
  snapshot(project);
  const overlay = {
    id: nextId(project.overlays, "o"),
    kind: "chat",
    at: round(editedToMaster(project, start), 3),
    dur: round(Number(dur), 3),
    messages: list,
    pos,
    sound: sound ?? "pop",
  };
  project.overlays.push(overlay);
  return { id: overlay.id, at: round(start, 2), dur: overlay.dur, messages: list.length };
}

function addSpecCard(project, kind, spec, { at, dur, pos, sound }) {
  const duration = editedDuration(project);
  const start = clamp(parseTime(at), 0, Math.max(0, duration - 0.1));
  snapshot(project);
  const overlay = {
    id: nextId(project.overlays, "o"),
    kind,
    at: round(editedToMaster(project, start), 3),
    dur: round(Number(dur), 3),
    spec,
    pos,
    sound,
  };
  project.overlays.push(overlay);
  return { id: overlay.id, at: round(start, 2), dur: overlay.dur, kind };
}

export function addKeycap(project, { keys, at, dur = 1.6, pos = "bottom", sound = "click" }) {
  const list = Array.isArray(keys) ? keys : String(keys).split("|").map((k) => k.trim()).filter(Boolean);
  return addSpecCard(project, "keycap", { keys: list.slice(0, 4) }, { at, dur, pos, sound });
}

export function addCommand(project, { command, at, dur = 2.6, pos = "bottom-left", label = "terminal", sound = "pop" }) {
  return addSpecCard(project, "command", { command, label }, { at, dur, pos, sound });
}

export function addStamp(project, { text, at, dur = 1.2, pos = "center", color = "#FF2D95", angle = -8, sound = "boom" }) {
  return addSpecCard(project, "stamp", { text, color, angle }, { at, dur, pos, sound });
}

export function addStat(project, { value, label, at, dur = 1.8, pos = "center", accent = "#FF2D95", sound = "pop" }) {
  return addSpecCard(project, "stat", { value, label, accent }, { at, dur, pos, sound });
}

export function addChapter(project, { part, title, at, dur = 2.4, pos = "left", sound = "whoosh" }) {
  return addSpecCard(project, "chapter", { part, title }, { at, dur, pos, sound });
}

export function addNotification(project, { app = "System", title, body = "", icon = "warning", at, dur = 2.5, pos = "top-right", sound = "ding" }) {
  return addSpecCard(project, "notification", { app, title, body, icon }, { at, dur, pos, sound });
}

export function addChecklist(project, { title, items, ticks, at, dur = 6, pos = "top-right", sound = "pop" }) {
  const list = (Array.isArray(items) ? items : String(items).split("|")).map((item) =>
    typeof item === "string" ? { text: item.trim() } : item,
  );
  const tickList = (Array.isArray(ticks) ? ticks : String(ticks ?? "").split("|"))
    .map((tick) => {
      if (typeof tick === "object" && tick !== null) return tick;
      const [time, count] = String(tick).split(":");
      return { at: parseTime(time), count: Number(count) };
    })
    .filter((tick) => Number.isFinite(tick.at) && Number.isFinite(tick.count) && tick.count > 0)
    .map((tick) => ({ atMaster: round(editedToMaster(project, tick.at), 3), count: tick.count }));

  return addSpecCard(project, "checklist", { title, items: list, ticks: tickList }, { at, dur, pos, sound });
}

export function addProgress(project, { label, at, dur = 3, pos = "bottom", frames = 5, sound = "pop" }) {
  return addSpecCard(project, "progress", { label, frames }, { at, dur, pos, sound });
}

export function addZoom(project, { at, dur = 0.9, factor = 1.35, cx = 0.5, cy = 0.5 }) {
  const duration = editedDuration(project);
  const start = clamp(parseTime(at), 0, Math.max(0, duration - 0.1));
  snapshot(project);
  const overlay = {
    id: nextId(project.overlays, "o"),
    kind: "zoom",
    at: round(editedToMaster(project, start), 3),
    dur: round(Number(dur), 3),
    factor: clamp(Number(factor), 1.05, 3),
    center: [clamp(Number(cx), 0, 1), clamp(Number(cy), 0, 1)],
  };
  project.overlays.push(overlay);
  return { id: overlay.id, at: round(start, 2), dur: overlay.dur, factor: overlay.factor };
}

export function setMusic(project, { src = null, gain = -10, duck = true, duckProfile = null, fit = "loop", fade = 0.6 }) {
  snapshot(project);
  let stored = null;
  if (src) {
    const absolute = resolveMember(projectDirOf(project), src);
    if (!fs.existsSync(absolute)) throw new Error(`Music source not found: ${src}`);
    stored = toStoredPath(absolute);
  }
  project.audio.music = stored;
  project.audio.musicGainDb = Number(gain);
  project.audio.duck = duckProfile ? duckProfile !== "off" : Boolean(duck);
  project.audio.duckProfile = duckProfile ?? (duck ? "soft" : "off");
  project.audio.musicFit = fit;
  project.audio.musicFade = Number(fade);
  return {
    music: stored,
    gain: project.audio.musicGainDb,
    duck: project.audio.duckProfile,
    fit: project.audio.musicFit,
    fade: project.audio.musicFade,
  };
}

export function setVoice(project, { enabled, strength }) {
  snapshot(project);
  if (typeof enabled === "boolean") project.audio.voiceClean = enabled;
  if (strength) project.audio.voiceStrength = strength;
  return { voiceClean: Boolean(project.audio.voiceClean), strength: project.audio.voiceStrength ?? "normal" };
}

const LOUDNESS_PRESETS = {
  youtube: { lufs: -14, truePeak: -1 },
  tiktok: { lufs: -14, truePeak: -1 },
  instagram: { lufs: -14, truePeak: -1 },
  podcast: { lufs: -16, truePeak: -1 },
  cinema: { lufs: -23, truePeak: -2 },
};

export function addSfx(project, { sound, at, gain = -6 }) {
  const duration = editedDuration(project);
  const start = clamp(parseTime(at), 0, Math.max(0, duration - 0.05));
  snapshot(project);
  project.audio.sfx = project.audio.sfx ?? [];
  const entry = {
    id: nextId(project.audio.sfx, "x"),
    at: round(editedToMaster(project, start), 3),
    sound,
    gain: Number(gain),
  };
  project.audio.sfx.push(entry);
  return { id: entry.id, at: round(start, 2), sound, gain: entry.gain };
}

export function removeSfx(project, id) {
  const list = project.audio.sfx ?? [];
  const index = list.findIndex((entry) => entry.id === id);
  if (index === -1) throw new Error(`No sound ${id}`);
  snapshot(project);
  list.splice(index, 1);
  return { id };
}

export function setFormat(project, { w, h, fps, fit }) {
  const next = { ...project.format };
  if (w != null) {
    const value = Math.round(Number(w));
    if (!Number.isFinite(value) || value < 16) throw new Error(`Bad width: ${w}`);
    next.w = value;
  }
  if (h != null) {
    const value = Math.round(Number(h));
    if (!Number.isFinite(value) || value < 16) throw new Error(`Bad height: ${h}`);
    next.h = value;
  }
  if (fps != null) {
    const value = Number(fps);
    if (!Number.isFinite(value) || value <= 0 || value > 120) throw new Error(`Bad fps: ${fps}`);
    next.fps = value;
  }
  if (fit != null) {
    if (!["cover", "blur", "pad"].includes(fit)) {
      throw new Error(`Unknown fit "${fit}". Use cover, blur or pad.`);
    }
    next.fit = fit;
  }
  snapshot(project);
  project.format = next;
  return { ...next };
}

export function setLoudness(project, { platform, lufs, truePeak }) {
  const preset = LOUDNESS_PRESETS[platform];
  if (!preset && lufs === undefined) {
    throw new Error(`Unknown platform "${platform}". Try: ${Object.keys(LOUDNESS_PRESETS).join(", ")}`);
  }
  snapshot(project);
  project.audio.targetLufs = Number(lufs ?? preset.lufs);
  project.audio.truePeak = Number(truePeak ?? preset.truePeak);
  return { platform: platform ?? "custom", lufs: project.audio.targetLufs, truePeak: project.audio.truePeak };
}

export function setCaptions(project, { enabled, style, fontSize }) {
  snapshot(project);
  if (typeof enabled === "boolean") project.captions.enabled = enabled;
  if (style) project.captions.style = style;
  if (fontSize) project.captions.fontSize = Number(fontSize);
  return { ...project.captions };
}

export function setTheme(project, name) {
  const theme = getTheme(name);
  if (!THEMES[name]) {
    throw new Error(`Unknown theme "${name}". Available: ${themeNames().join(", ")}`);
  }
  snapshot(project);
  project.theme = name;
  return { theme: name, label: theme.label };
}

export function undo(project) {
  const history = project.history ?? [];
  if (!history.length) throw new Error("Nothing to undo");
  const previous = JSON.parse(history.pop().state);
  const keepHistory = history;
  Object.keys(project).forEach((key) => delete project[key]);
  Object.assign(project, previous, { history: keepHistory });
  return { undone: true, remaining: keepHistory.length };
}

// Ops for the agent: returns the effect of adding a cut without saving.
export function previewCut(project, { from, to }) {
  const { start, end } = editedBounds(project, from, to);
  const masterStart = editedToMaster(project, start);
  const masterEnd = editedToMaster(project, end);
  const words = transcriptWords(project);
  const inside = words.filter((w) => w.start >= masterStart && w.end <= masterEnd).map((w) => w.word);
  const before = words.filter((w) => w.end <= masterStart).at(-1)?.word ?? "";
  const after = words.find((w) => w.start >= masterEnd)?.word ?? "";
  const sample = inside.slice(0, 18).join(" ");
  return {
    from: round(start, 2),
    to: round(end, 2),
    removes: round(end - start, 2),
    kind: inside.length ? "speech" : "silence",
    text: inside.length ? `${sample}${inside.length > 18 ? " ..." : ""}` : "(no words in range)",
    context: `${before} [ ... ] ${after}`.trim(),
    wordCount: inside.length,
    newDuration: round(editedDuration(project) - (end - start), 2),
  };
}

export function transcriptWords(project) {
  if (!project._transcript) return [];
  const segments = project._transcript.segments ?? [];
  return segments.flatMap((s) => s.words ?? []);
}

// Loads the transcript into a non-persisted field for previews.
export function withTranscript(project, dir) {
  if (!project.transcript) return project;
  const file = resolveMember(dir, project.transcript);
  if (fs.existsSync(file)) {
    project._transcript = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return project;
}

export function overlaySummary(project) {
  return project.overlays
    .map((o) => ({
      id: o.id,
      kind: o.kind,
      at: round(masterToEdited(project, o.at), 2),
      dur: o.dur,
      label:
        o.kind === "text" || o.kind === "bubble" || o.kind === "toast"
          ? o.text
          : o.kind === "chat"
            ? `${(o.messages ?? []).length} messages`
            : o.kind === "zoom"
              ? `${o.factor}x`
              : path.basename(o.src ?? "", path.extname(o.src ?? "")),
    }))
    .sort((a, b) => a.at - b.at);
}

export function brollSummary(project) {
  return project.broll
    .map((b) => ({
      id: b.id,
      at: round(masterToEdited(project, b.start), 2),
      duration: round(b.end - b.start, 2),
      src: path.basename(b.src),
      cutAway: isCutAway(project, b.start),
    }))
    .sort((a, b) => a.at - b.at);
}

function projectDirOf(project) {
  return project.__dir ?? ".";
}
