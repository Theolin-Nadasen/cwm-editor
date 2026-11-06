import fs from "node:fs";
import path from "node:path";
import {
  editedDuration,
  editedToMaster,
  masterToEdited,
  nextId,
  projectPaths,
  resolveMember,
  save,
  serializable,
  snapshot,
} from "./project.mjs";
import * as ops from "./ops.mjs";
import { scan } from "./gags.mjs";
import { round } from "./util.mjs";

export const PLAN_FILE = "plan.json";

const GAG_KINDS = new Set([
  "sticker", "bubble", "chat", "toast", "text", "keycap", "command",
  "stamp", "stat", "chapter", "notification", "checklist", "progress", "zoom",
]);

const REQUIRED = {
  cut: ["from", "to"],
  broll: ["from", "to", "src"],
  zoom: ["at"],
  sticker: ["at", "name"],
  bubble: ["at", "text"],
  chat: ["at", "messages"],
  toast: ["at", "text"],
  text: ["at", "text"],
  keycap: ["at", "keys"],
  command: ["at", "command"],
  stamp: ["at", "text"],
  stat: ["at", "value"],
  chapter: ["at", "title"],
  notification: ["at", "title"],
  checklist: ["at", "items"],
  progress: ["at"],
};

const PROFILES = {
  tutorial: { perMinute: 12, minGap: 2 },
  devlog: { perMinute: 15, minGap: 1.5 },
  short: { perMinute: 20, minGap: 1 },
};

export function planPath(dir) {
  return path.join(dir, PLAN_FILE);
}

export function loadPlan(dir) {
  const file = planPath(dir);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function savePlan(dir, plan) {
  fs.writeFileSync(planPath(dir), `${JSON.stringify(plan, null, 2)}\n`);
}

function allOps(plan) {
  return (plan.sections ?? []).flatMap((section) =>
    (section.ops ?? []).map((op) => ({ ...op, section: section.id ?? section.title })),
  );
}

function insideCut(project, time) {
  return project.cuts.some((cut) => time >= cut.start && time < cut.end);
}

export function validatePlan(dir, project, plan) {
  const errors = [];
  const warnings = [];
  const duration = project.master.duration;

  if (!plan || typeof plan !== "object") {
    return { ok: false, errors: ["Plan is empty"], warnings: [], stats: {} };
  }
  if (plan.version !== 1) errors.push("plan.version must be 1");
  if (plan.timebase !== "master") errors.push('plan.timebase must be "master"');

  const sections = plan.sections ?? [];
  if (!sections.length) errors.push("plan has no sections");

  let cursor = -1;
  for (const [index, section] of sections.entries()) {
    const label = section.id ?? `section ${index + 1}`;
    if (typeof section.start !== "number" || typeof section.end !== "number") {
      errors.push(`${label}: start and end are required numbers`);
      continue;
    }
    if (section.end <= section.start) errors.push(`${label}: end must be after start`);
    if (section.start < 0 || section.end > duration + 0.01) {
      errors.push(`${label}: outside master duration (${duration.toFixed(2)}s)`);
    }
    if (section.start < cursor) warnings.push(`${label}: overlaps the previous section`);
    cursor = Math.max(cursor, section.end);

    for (const [opIndex, op] of (section.ops ?? []).entries()) {
      const where = `${label} op ${opIndex + 1} (${op.op ?? "?"})`;
      const required = REQUIRED[op.op];
      if (!required) {
        errors.push(`${where}: unknown op`);
        continue;
      }
      for (const field of required) {
        if (op[field] === undefined) errors.push(`${where}: missing ${field}`);
      }
      if (op.op === "cut" || op.op === "broll") {
        if (typeof op.from === "number" && typeof op.to === "number" && op.to <= op.from) {
          errors.push(`${where}: to must be after from`);
        }
        if (typeof op.from === "number" && op.from < section.start - 2) {
          warnings.push(`${where}: starts before its section`);
        }
        if (op.op === "broll" && op.src) {
          const file = resolveMember(dir, op.src);
          if (!fs.existsSync(file)) errors.push(`${where}: b-roll not found: ${op.src}`);
        }
      } else if (typeof op.at === "number") {
        if (op.at < 0 || op.at > duration) errors.push(`${where}: at is outside the master duration`);
        if (insideCut(project, op.at)) warnings.push(`${where}: lands inside a cut and will be dropped`);
      }
    }
  }

  const audio = plan.audio ?? {};
  if (audio.music && audio.music.src) {
    const file = resolveMember(dir, audio.music.src);
    if (!fs.existsSync(file)) errors.push(`audio.music: not found: ${audio.music.src}`);
  }
  for (const [index, entry] of (audio.sfx ?? []).entries()) {
    if (typeof entry.at !== "number") errors.push(`audio.sfx ${index + 1}: at is required`);
    if (!entry.sound) errors.push(`audio.sfx ${index + 1}: sound is required`);
  }

  // Density is a soft signal, not a gate. Plans can opt out with density: "off".
  const profile = PROFILES[plan.profile ?? "tutorial"] ?? PROFILES.tutorial;
  const gags = plan.density === "off"
    ? []
    : allOps(plan)
        .filter((op) => GAG_KINDS.has(op.op) && !insideCut(project, op.at ?? 0))
        .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  let last = -Infinity;
  for (const gag of gags) {
    if (gag.at - last < profile.minGap) {
      warnings.push(`${gag.op} at ${gag.at}s: closer than ${profile.minGap}s to the previous gag`);
    }
    last = gag.at;
  }
  const minutes = Math.max(1, duration / 60);
  if (gags.length / minutes > profile.perMinute) {
    warnings.push(`${gags.length} gags in ${minutes.toFixed(1)} min exceeds the ${plan.profile ?? "tutorial"} budget of ${profile.perMinute}/min`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      sections: sections.length,
      ops: allOps(plan).length,
      cuts: allOps(plan).filter((op) => op.op === "cut").length,
      gags: gags.length,
      music: audio.music?.src ?? null,
    },
  };
}

function cloneProject(dir, project) {
  const clone = JSON.parse(JSON.stringify(serializable(project)));
  clone.__dir = dir;
  return clone;
}

function tag(project, id, section, opName) {
  const overlay = project.overlays.find((entry) => entry.id === id);
  if (overlay) overlay.plan = { section, op: opName };
}

function durFor(project, op, editedAt) {
  if (op.until === "end") return Math.max(0.3, editedDuration(project) - editedAt);
  return op.dur;
}

export function buildFromPlan(dir, project, plan) {
  const validation = validatePlan(dir, project, plan);
  if (!validation.ok) {
    const error = new Error(`Plan is invalid:\n${validation.errors.join("\n")}`);
    error.validation = validation;
    throw error;
  }

  const working = cloneProject(dir, project);
  // Plans are idempotent: drop anything the previous plan created, keep manual work.
  working.overlays = working.overlays.filter((overlay) => !overlay.plan);
  working.cuts = working.cuts.filter((cut) => cut.source !== "plan");
  const opsList = allOps(plan);
  let cuts = 0;
  let overlays = 0;
  let sfx = 0;

  // Cuts first, so every overlay time maps through the final edit.
  for (const op of opsList) {
    if (op.op !== "cut") continue;
    working.cuts.push({
      id: nextId(working.cuts, "c"),
      start: round(op.from, 3),
      end: round(op.to, 3),
      label: op.reason ?? "plan",
      source: "plan",
    });
    cuts += 1;
  }
  working.cuts.sort((a, b) => a.start - b.start);

  for (const op of opsList) {
    if (op.op === "cut") continue;
    if (op.op === "broll") {
      const from = masterToEdited(working, op.from);
      const to = masterToEdited(working, op.to);
      const result = ops.addBroll(working, { from, to, src: op.src, srcIn: op.srcIn ?? 0 });
      tag(working, result.id, op.section, "broll");
      overlays += 1;
      continue;
    }

    const editedAt = masterToEdited(working, op.at);
    const dur = durFor(working, op, editedAt);
    let result;
    switch (op.op) {
      case "zoom":
        result = ops.addZoom(working, { at: editedAt, dur: dur ?? 0.9, factor: op.factor ?? 1.3, cx: op.cx ?? 0.5, cy: op.cy ?? 0.5 });
        break;
      case "sticker":
        result = ops.addSticker(working, { name: op.name, at: editedAt, dur: dur ?? 1.4, pos: op.pos ?? "center", scale: op.scale ?? 0.2, sound: op.sound ?? "pop" });
        break;
      case "bubble":
        result = ops.addBubble(working, { text: op.text, at: editedAt, dur: dur ?? 2.2, pos: op.pos ?? "bottom-right", label: op.label ?? "chat", sound: op.sound ?? "pop", icon: op.icon ?? "thinking" });
        break;
      case "chat":
        result = ops.addChat(working, { messages: op.messages, at: editedAt, dur: dur ?? 4, pos: op.pos ?? "bottom-right", sound: op.sound ?? "pop" });
        break;
      case "toast":
        result = ops.addToast(working, { text: op.text, at: editedAt, dur: dur ?? 3, pos: op.pos ?? "top", label: op.label ?? "Achievement unlocked", sound: op.sound ?? "ding", icon: op.icon ?? "check" });
        break;
      case "text":
        result = ops.addText(working, { text: op.text, at: editedAt, dur: dur ?? 2, pos: op.pos ?? "bottom" });
        break;
      case "keycap":
        result = ops.addKeycap(working, { keys: op.keys, at: editedAt, dur: dur ?? 1.6 });
        break;
      case "command":
        result = ops.addCommand(working, { command: op.command, at: editedAt, dur: dur ?? 2.6, label: op.label ?? "terminal" });
        break;
      case "stamp":
        result = ops.addStamp(working, { text: op.text, at: editedAt, dur: dur ?? 1.2, color: op.color ?? "#FF2D95", angle: op.angle ?? -8 });
        break;
      case "stat":
        result = ops.addStat(working, { value: op.value, label: op.label ?? "", at: editedAt, dur: dur ?? 1.8, pos: op.pos ?? "center", accent: op.accent ?? "#FF2D95" });
        break;
      case "chapter":
        result = ops.addChapter(working, { part: op.part ?? "PART", title: op.title, at: editedAt, dur: dur ?? 2.4 });
        break;
      case "notification":
        result = ops.addNotification(working, { app: op.app ?? "System", title: op.title, body: op.body ?? "", icon: op.icon ?? "warning", at: editedAt, dur: dur ?? 2.5 });
        break;
      case "checklist": {
        const ticks = (op.ticks ?? []).map((tick) => ({
          at: masterToEdited(working, tick.at),
          count: tick.count,
        }));
        result = ops.addChecklist(working, { title: op.title ?? "SETUP", items: op.items, ticks, at: editedAt, dur: dur ?? 6 });
        break;
      }
      case "progress":
        result = ops.addProgress(working, { label: op.label ?? "working", at: editedAt, dur: dur ?? 3, frames: op.frames ?? 5 });
        break;
      default:
        throw new Error(`Unhandled op ${op.op}`);
    }
    tag(working, result.id, op.section, op.op);
    overlays += 1;
  }

  const audio = plan.audio ?? {};
  if (audio.voice) {
    ops.setVoice(working, { enabled: audio.voice.clean !== false, strength: audio.voice.strength });
  }
  if (audio.music !== undefined) {
    if (audio.music) {
      ops.setMusic(working, {
        src: audio.music.src,
        gain: audio.music.gain ?? -10,
        duck: audio.music.duck !== "off",
        duckProfile: audio.music.duck,
        fit: audio.music.fit ?? "loop",
        fade: audio.music.fade ?? 0.6,
      });
    } else {
      ops.setMusic(working, { src: null });
    }
  }
  if (audio.loudness) ops.setLoudness(working, { platform: audio.loudness });
  for (const entry of audio.sfx ?? []) {
    ops.addSfx(working, { sound: entry.sound, at: masterToEdited(working, entry.at), gain: entry.gain ?? -6 });
    sfx += 1;
  }

  return { working, validation, applied: { cuts, overlays, sfx } };
}

export function applyPlan(dir, project, plan) {
  const { working, validation, applied } = buildFromPlan(dir, project, plan);
  snapshot(project);
  for (const key of Object.keys(project)) delete project[key];
  Object.assign(project, working);
  save(dir, project);
  return { ...applied, warnings: validation.warnings, duration: round(editedDuration(project), 2) };
}

export function planDiff(dir, project, plan) {
  const before = {
    duration: round(editedDuration(project), 2),
    cuts: project.cuts.length,
    overlays: project.overlays.length,
    byKind: countKinds(project.overlays),
    music: project.audio.music ?? null,
    voiceClean: Boolean(project.audio.voiceClean),
    lufs: project.audio.targetLufs,
  };

  const { working, validation, applied } = buildFromPlan(dir, project, plan);
  const after = {
    duration: round(editedDuration(working), 2),
    cuts: working.cuts.length,
    overlays: working.overlays.length,
    byKind: countKinds(working.overlays),
    music: working.audio.music ?? null,
    voiceClean: Boolean(working.audio.voiceClean),
    lufs: working.audio.targetLufs,
  };

  return { before, after, applied, warnings: validation.warnings };
}

function countKinds(overlays) {
  const counts = {};
  for (const overlay of overlays) counts[overlay.kind] = (counts[overlay.kind] ?? 0) + 1;
  return counts;
}

export function suggestPlan(dir, project, { write = false } = {}) {
  const transcriptFile = project.transcript ? resolveMember(dir, project.transcript) : null;
  if (!transcriptFile || !fs.existsSync(transcriptFile)) {
    throw new Error("No transcript. Run: cwmeditor transcribe <dir>");
  }
  const transcript = JSON.parse(fs.readFileSync(transcriptFile, "utf8"));
  const words = (transcript.segments ?? []).flatMap((segment) => segment.words ?? []);
  const duration = project.master.duration;

  const cuts = [];
  const boundaries = [0];
  const first = words[0]?.start ?? 0;
  if (first > 0.8) cuts.push({ op: "cut", from: 0, to: round(first - 0.2, 2), reason: "leading silence" });
  const last = words.at(-1)?.end ?? duration;
  if (duration - last > 1) cuts.push({ op: "cut", from: round(last + 0.3, 2), to: duration, reason: "trailing silence" });

  for (let i = 1; i < words.length; i += 1) {
    const gap = words[i].start - words[i - 1].end;
    if (gap > 2.5) {
      const from = round(words[i - 1].end + 0.3, 2);
      const to = round(words[i].start - 0.3, 2);
      if (to - from > 0.8) cuts.push({ op: "cut", from, to, reason: `${gap.toFixed(1)}s pause` });
      if (words[i].start - boundaries.at(-1) > 25) boundaries.push(round(words[i].start, 2));
    }
  }
  boundaries.push(duration);

  const sections = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    sections.push({
      id: `part-${i + 1}`,
      title: `Part ${i + 1}`,
      start: boundaries[i],
      end: boundaries[i + 1],
      goal: "",
      ops: [],
    });
  }

  const sectionAt = (time) => sections.find((section) => time >= section.start && time < section.end) ?? sections[0];

  for (const cut of cuts) {
    const section = sectionAt(cut.from);
    if (section) section.ops.push(cut);
  }

  for (let i = 1; i < sections.length; i += 1) {
    const section = sections[i];
    section.ops.push({
      op: "chapter",
      at: section.start + 0.2,
      part: `PART ${i + 1}`,
      title: section.title,
      dur: 2.4,
    });
  }

  const gags = scan(dir, project, { minGap: 6, maxPerMinute: 8 });
  for (const gag of gags) {
    const masterAt = editedToMaster(project, gag.at);
    const section = sectionAt(masterAt);
    if (!section) continue;
    const payload = gag.payload;
    let op;
    if (gag.kind === "sticker") op = { op: "sticker", at: masterAt, name: payload.name, dur: gag.dur };
    else if (gag.kind === "bubble") op = { op: "bubble", at: masterAt, text: payload.text, dur: gag.dur };
    else if (gag.kind === "toast") op = { op: "toast", at: masterAt, text: payload.text, dur: gag.dur };
    else if (gag.kind === "zoom") op = { op: "zoom", at: masterAt, dur: gag.dur, factor: payload.factor ?? 1.25 };
    if (op) section.ops.push(op);
  }

  const plan = {
    version: 1,
    name: project.name,
    timebase: "master",
    profile: "tutorial",
    intent: "",
    sections,
    audio: {
      voice: { clean: true, strength: project.audio.voiceStrength ?? "light" },
      music: project.audio.music
        ? {
            src: project.audio.music,
            gain: project.audio.musicGainDb ?? -10,
            duck: project.audio.duckProfile ?? "soft",
            fit: project.audio.musicFit ?? "loop",
            fade: project.audio.musicFade ?? 0.6,
          }
        : null,
      loudness: "youtube",
      sfx: project.audio.sfx ?? [],
    },
  };

  if (write) savePlan(dir, plan);
  return plan;
}

export function planSummary(plan) {
  if (!plan) return null;
  return {
    name: plan.name,
    profile: plan.profile,
    intent: plan.intent,
    sections: (plan.sections ?? []).map((section) => ({
      id: section.id,
      title: section.title,
      start: section.start,
      end: section.end,
      ops: (section.ops ?? []).length,
    })),
    audio: plan.audio,
  };
}
