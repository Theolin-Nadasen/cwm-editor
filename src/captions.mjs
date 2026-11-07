import path from "node:path";
import { masterToEdited, isCutAway } from "./project.mjs";
import { getTheme } from "./themes.mjs";
import { assTime } from "./util.mjs";

const PUNCT_BREAK = /[.!?]$/;

function cleanWord(text) {
  return String(text ?? "")
    .replace(/\\/g, "")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .trim();
}

function upper(text, enabled) {
  return enabled ? text.toUpperCase() : text;
}

function wordsInEditedTime(project, transcript) {
  const out = [];
  for (const segment of transcript.segments ?? []) {
    for (const word of segment.words ?? []) {
      const text = cleanWord(word.word);
      if (!text) continue;
      const mid = (word.start + word.end) / 2;
      if (isCutAway(project, mid)) continue;
      const start = masterToEdited(project, word.start);
      const end = masterToEdited(project, word.end);
      if (end - start <= 0.01) continue;
      out.push({ text, start, end });
    }
  }
  return out;
}

function groupLines(words, maxChars) {
  const lines = [];
  let current = [];
  let length = 0;

  const flush = () => {
    if (current.length) lines.push(current);
    current = [];
    length = 0;
  };

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const prev = words[i - 1];
    const gap = prev ? word.start - prev.end : 0;
    if (current.length && (length + word.text.length > maxChars || gap > 0.9)) flush();
    current.push(word);
    length += word.text.length + 1;
    if (PUNCT_BREAK.test(word.text)) flush();
  }
  flush();
  return lines;
}

function karaokeLine(line, theme) {
  return line
    .map((word) => {
      const cs = Math.max(1, Math.round((word.end - word.start) * 100));
      const text = upper(word.text, theme.caption.uppercase);
      return `{\\k${cs}}${text} `;
    })
    .join("")
    .trim();
}

export function buildAss(project, transcript, renderSize = null) {
  const size = renderSize ?? { w: project.format.w, h: project.format.h };
  const { w, h } = size;
  const portrait = h > w;
  const theme = getTheme(project.theme);
  const cap = theme.caption;
  const title = theme.title;
  const fontSize =
    project.captions.fontSize ?? Math.round(h / (portrait ? 27 : 18));
  const titleSize = Math.round(fontSize * 1.15);
  const scale = h / 1080;
  const capOutline = Math.max(1, Math.round(cap.outlineWidth * scale));
  const capSpacing = Math.round(cap.spacing * scale * 10) / 10;
  const titleOutline = Math.max(1, Math.round(title.outlineWidth * scale));
  const titleSpacing = Math.round(title.spacing * scale * 10) / 10;
  const marginV = portrait ? Math.round(h * 0.15) : Math.round(h * 0.07);
  const titleMarginV = Math.round(h * 0.05);
  const maxChars = portrait ? 20 : 38;
  const words = transcript && project.captions.enabled ? wordsInEditedTime(project, transcript) : [];
  const lines = groupLines(words, maxChars);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,${cap.font},${fontSize},${cap.primary},${cap.secondary},${cap.outline},${cap.back},${cap.bold ? -1 : 0},0,0,0,100,100,${capSpacing},0,${cap.borderStyle},${capOutline},${cap.shadow},2,60,60,${marginV},1`,
    `Style: Title,${title.font},${titleSize},${title.primary},${title.primary},${title.box},${title.box},${title.bold ? -1 : 0},0,0,0,100,100,${titleSpacing},0,3,${titleOutline},0,2,60,60,${titleMarginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const start = line[0].start;
    let end = line[line.length - 1].end + 0.12;
    const following = lines[i + 1];
    if (following) end = Math.min(end, following[0].start - 0.02);
    if (end - start < 0.08) continue;
    events.push(
      `Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,{\\fad(60,60)}${karaokeLine(line, theme)}`,
    );
  }

  for (const overlay of project.overlays ?? []) {
    if (overlay.kind !== "text") continue;
    const at = masterToEdited(project, overlay.at);
    const anchors = {
      top: { an: 8, x: w / 2, y: h * (portrait ? 0.11 : 0.08) },
      "top-left": { an: 7, x: w * 0.06, y: h * (portrait ? 0.11 : 0.08) },
      "top-right": { an: 9, x: w * 0.94, y: h * (portrait ? 0.11 : 0.08) },
      center: { an: 5, x: w / 2, y: h * 0.5 },
      bottom: { an: 2, x: w / 2, y: h * (portrait ? 0.85 : 0.93) },
      "bottom-left": { an: 1, x: w * 0.06, y: h * (portrait ? 0.85 : 0.93) },
      "bottom-right": { an: 3, x: w * 0.94, y: h * (portrait ? 0.85 : 0.93) },
    };
    const anchor = anchors[overlay.pos] ?? anchors.bottom;
    const text = upper(cleanWord(overlay.text), title.uppercase);
    events.push(
      `Dialogue: 1,${assTime(at)},${assTime(at + overlay.dur)},Title,,0,0,0,,` +
        `{\\an${anchor.an}\\pos(${Math.round(anchor.x)},${Math.round(anchor.y)})\\4a&H66&\\fad(120,120)}${text}`,
    );
  }

  return { ass: [...header, ...events].join("\n"), lines: lines.length, words: words.length, theme: project.theme ?? "neon" };
}

export function assFilename(dir, name = "captions.ass") {
  return path.join(dir, name);
}
