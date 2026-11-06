import fs from "node:fs";
import path from "node:path";
import { editedDuration, masterToEdited, resolveMember } from "./project.mjs";
import { addBubble, addSticker, addToast, addZoom } from "./ops.mjs";
import { round } from "./util.mjs";

export const DEFAULT_RULES = {
  density: { minGap: 18, maxPerMinute: 3 },
  rules: [
    {
      match: ["error", "errors", "fail", "fails", "failed", "broken", "crash", "crashed"],
      gag: "sticker:skull",
      dur: 1.3,
      reason: "something broke",
    },
    {
      match: ["wait", "what", "huh", "why"],
      gag: "bubble:wait what",
      dur: 2,
      reason: "confusion beat",
    },
    {
      match: ["finally", "it works", "works now", "working now", "done"],
      gag: "toast:It works first try",
      dur: 3,
      reason: "success beat",
    },
    {
      match: ["again", "nope", "wrong", "nope, try again"],
      gag: "sticker:melting",
      dur: 1.3,
      reason: "retry beat",
    },
    {
      pause: 2,
      gag: "zoom:1.25",
      dur: 0.9,
      reason: "long pause",
    },
  ],
};

function norm(word) {
  return String(word ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9']/g, "")
    .trim();
}

function normPhrase(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function loadRules(dir) {
  const file = path.join(dir, "gags.json");
  if (!fs.existsSync(file)) return DEFAULT_RULES;
  return { ...DEFAULT_RULES, ...JSON.parse(fs.readFileSync(file, "utf8")) };
}

function wordsOf(transcript) {
  return (transcript.segments ?? []).flatMap((segment) =>
    (segment.words ?? []).map((word) => ({
      word: word.word,
      norm: norm(word.word),
      start: word.start,
      end: word.end,
    })),
  );
}

function parseGag(gag) {
  const [kind, ...rest] = String(gag).split(":");
  const value = rest.join(":");
  if (kind === "sticker") return { kind, name: value };
  if (kind === "bubble") return { kind, text: value || "wait what" };
  if (kind === "toast") return { kind, text: value || "It works first try" };
  if (kind === "zoom") return { kind, factor: Number(value) || 1.25 };
  return { kind };
}

// Returns candidate beats before density rules are applied.
function candidates(words, rules) {
  const found = [];
  const sequence = words.map((w) => w.norm);

  for (const rule of rules.rules ?? []) {
    if (rule.match) {
      const targets = rule.match.map(normPhrase).filter(Boolean);
      for (let i = 0; i < words.length; i += 1) {
        for (const target of targets) {
          const parts = target.split(" ").filter(Boolean);
          if (parts.every((part, offset) => sequence[i + offset] === part)) {
            found.push({
              at: words[i].start,
              gag: parseGag(rule.gag),
              dur: rule.dur ?? 1.4,
              reason: rule.reason ?? `"${words[i].word}"`,
              weight: 2,
            });
          }
        }
      }
    }

    if (rule.pause) {
      for (let i = 1; i < words.length; i += 1) {
        const gap = words[i].start - words[i - 1].end;
        if (gap >= rule.pause) {
          found.push({
            at: words[i - 1].end + Math.min(0.6, gap / 3),
            gag: parseGag(rule.gag),
            dur: rule.dur ?? 0.9,
            reason: `${gap.toFixed(1)}s pause`,
            weight: 1,
          });
        }
      }
    }
  }

  return found.sort((a, b) => a.at - b.at);
}

function applyDensity(list, density) {
  const minGap = Number(density?.minGap ?? 18);
  const maxPerMinute = Number(density?.maxPerMinute ?? 3);
  const kept = [];
  let last = -Infinity;
  let windowStart = 0;
  let inWindow = 0;

  for (const item of list) {
    if (item.at - last < minGap) continue;
    if (item.at - windowStart >= 60) {
      windowStart = item.at;
      inWindow = 0;
    }
    if (inWindow >= maxPerMinute) continue;
    kept.push(item);
    last = item.at;
    inWindow += 1;
  }
  return kept;
}

export function scan(dir, project, options = {}) {
  const transcriptFile = project.transcript ? resolveMember(dir, project.transcript) : null;
  if (!transcriptFile || !fs.existsSync(transcriptFile)) {
    throw new Error("No transcript. Run: cwmeditor transcribe <dir>");
  }
  const transcript = JSON.parse(fs.readFileSync(transcriptFile, "utf8"));
  const rules = loadRules(dir);
  const density = {
    ...DEFAULT_RULES.density,
    ...rules.density,
    ...(options.minGap ? { minGap: Number(options.minGap) } : {}),
    ...(options.maxPerMinute ? { maxPerMinute: Number(options.maxPerMinute) } : {}),
  };

  const found = candidates(wordsOf(transcript), rules);
  const kept = applyDensity(found, density);
  const total = editedDuration(project);

  return kept
    .filter((item) => item.at < total - 0.2)
    .map((item, index) => ({
      id: index + 1,
      at: round(masterToEdited(project, item.at), 2),
      kind: item.gag.kind,
      label:
        item.gag.kind === "sticker"
          ? item.gag.name
          : item.gag.kind === "zoom"
            ? `${item.gag.factor}x`
            : item.gag.text,
      dur: item.dur,
      reason: item.reason,
      payload: item.gag,
    }));
}

export function applyGags(project, suggestions, ids = null) {
  const wanted = ids?.length ? new Set(ids) : null;
  const applied = [];
  for (const item of suggestions) {
    if (wanted && !wanted.has(item.id)) continue;
    if (item.kind === "sticker") {
      applied.push({ at: item.at, ...addSticker(project, {
        name: item.payload.name,
        at: item.at,
        dur: item.dur,
        pos: "center",
        scale: 0.2,
      }) });
    } else if (item.kind === "bubble") {
      applied.push({ at: item.at, ...addBubble(project, {
        text: item.payload.text,
        at: item.at,
        dur: item.dur,
        pos: "bottom-right",
      }) });
    } else if (item.kind === "toast") {
      applied.push({ at: item.at, ...addToast(project, {
        text: item.payload.text,
        at: item.at,
        dur: item.dur,
        pos: "top",
        sound: "ding",
      }) });
    } else if (item.kind === "zoom") {
      applied.push({ at: item.at, ...addZoom(project, {
        at: item.at,
        dur: item.dur,
        factor: item.payload.factor,
      }) });
    }
  }
  return applied;
}

export function writeReport(dir, project, suggestions) {
  const out = path.join(dir, "out");
  fs.mkdirSync(out, { recursive: true });
  const json = path.join(out, "gags.json");
  fs.writeFileSync(json, `${JSON.stringify(suggestions, null, 2)}\n`);

  const lines = [
    `# Gag suggestions for ${project.name}`,
    "",
    `${suggestions.length} beats, minimum 18s apart.`,
    "",
    "| # | At | Kind | Item | Why |",
    "|---|---|---|---|---|",
    ...suggestions.map(
      (s) => `| ${s.id} | ${s.at}s | ${s.kind} | ${s.label} | ${s.reason} |`,
    ),
  ];
  const md = path.join(out, "gags.md");
  fs.writeFileSync(md, `${lines.join("\n")}\n`);
  return { json, md };
}
