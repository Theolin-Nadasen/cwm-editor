#!/usr/bin/env node
/**
 * Minimal MCP server for cwmeditor. Newline-delimited JSON-RPC over stdio.
 * Add to opencode.json:
 *   "cwmeditor": { "type": "local", "command": ["node", "D:/Documents/cwmeditor/mcp/server.mjs"] }
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  editedDuration,
  load,
  projectSummary,
  resolveMember,
  save,
} from "../src/project.mjs";
import * as ops from "../src/ops.mjs";
import { renderProject } from "../src/render.mjs";
import { transcribe } from "../src/transcribe.mjs";
import { qc } from "../src/qc.mjs";
import { buildReview, latestOutput } from "../src/review.mjs";
import { applyGags, scan, writeReport } from "../src/gags.mjs";
import { applyPlan, loadPlan, planDiff, savePlan, suggestPlan, validatePlan } from "../src/plan.mjs";
import { listSfx } from "../src/sfx.mjs";
import { round } from "../src/util.mjs";

const SERVER_INFO = { name: "cwmeditor", version: "0.1.0" };

const dirSchema = {
  type: "object",
  properties: { dir: { type: "string", description: "Project directory" } },
  required: ["dir"],
};

const tools = [
  {
    name: "cwmeditor_status",
    description: "Show the project timeline: duration, cuts, b-roll, overlays, captions, music.",
    inputSchema: dirSchema,
    run: ({ dir }) => {
      const p = open(dir);
      return {
        ...projectSummary(p),
        theme: p.theme ?? "neon",
        broll: ops.brollSummary(p),
        overlays: ops.overlaySummary(p),
        history: (p.history ?? []).length,
      };
    },
  },
  {
    name: "cwmeditor_transcribe",
    description: "Word-level transcription of the master audio. Uses faster-whisper when installed.",
    inputSchema: {
      ...dirSchema,
      properties: { ...dirSchema.properties, model: { type: "string" } },
    },
    run: async ({ dir, model }) => {
      const p = open(dir);
      return transcribe(dir, p, { model: model ?? "base" });
    },
  },
  {
    name: "cwmeditor_cut_preview",
    description: "Dry run a cut: shows how much time it removes and exactly what words disappear.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
      },
      required: ["dir", "from", "to"],
    },
    run: ({ dir, from, to }) => ops.previewCut(open(dir), { from, to }),
  },
  {
    name: "cwmeditor_cut",
    description: "Remove a time range from the master (filler, mistakes, dead air). Times are what you see, in edited time.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        label: { type: "string" },
      },
      required: ["dir", "from", "to"],
    },
    run: ({ dir, from, to, label }) => {
      const p = open(dir);
      const result = ops.addCut(p, { from, to, label: label ?? "cut" });
      save(dir, p);
      return { ...result, duration: round(editedDuration(p), 2) };
    },
  },
  {
    name: "cwmeditor_uncut",
    description: "Undo a specific cut by id.",
    inputSchema: {
      type: "object",
      properties: { dir: { type: "string" }, id: { type: "string" } },
      required: ["dir", "id"],
    },
    run: ({ dir, id }) => {
      const p = open(dir);
      const result = ops.removeCut(p, id);
      save(dir, p);
      return result;
    },
  },
  {
    name: "cwmeditor_broll",
    description: "Put a clip or image over the video for a time range. Voice keeps playing.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        src: { type: "string", description: "Path to clip or image" },
        srcIn: { type: "number", description: "Seconds into the source to start" },
      },
      required: ["dir", "from", "to", "src"],
    },
    run: ({ dir, from, to, src, srcIn }) => {
      const p = open(dir);
      const result = ops.addBroll(p, { from, to, src, srcIn: srcIn ?? 0 });
      save(dir, p);
      return result;
    },
  },
  {
    name: "cwmeditor_meme",
    description: "Place a meme, gif, image or short clip on screen at a moment. Styles: pop, plain.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        at: { type: "string" },
        src: { type: "string" },
        dur: { type: "number" },
        pos: { type: "string", enum: ["center", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"] },
        scale: { type: "number", description: "0.1 to 1.0 of frame width" },
      },
      required: ["dir", "at", "src"],
    },
    run: ({ dir, at, src, dur, pos, scale }) => {
      const p = open(dir);
      const result = ops.addMeme(p, { at, src, dur: dur ?? 1.2, pos, scale: scale ?? 0.4 });
      save(dir, p);
      return result;
    },
  },
  {
    name: "cwmeditor_text",
    description: "Add a text overlay at a moment. Positions: top, center, bottom.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        at: { type: "string" },
        text: { type: "string" },
        dur: { type: "number" },
        pos: { type: "string", enum: ["top", "center", "bottom"] },
      },
      required: ["dir", "at", "text"],
    },
    run: ({ dir, at, text, dur, pos }) => {
      const p = open(dir);
      const result = ops.addText(p, { at, text, dur: dur ?? 2, pos: pos ?? "bottom" });
      save(dir, p);
      return result;
    },
  },
  {
    name: "cwmeditor_music",
    description: "Set the music bed, gain in dB, and whether it ducks under the voice. Omit src to clear.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        src: { type: "string" },
        gain: { type: "number" },
        duck: { type: "boolean" },
      },
      required: ["dir"],
    },
    run: ({ dir, src, gain, duck }) => {
      const p = open(dir);
      const result = ops.setMusic(p, { src: src ?? null, gain: gain ?? -10, duck: duck ?? true });
      save(dir, p);
      return result;
    },
  },
  {
    name: "cwmeditor_captions",
    description: "Turn karaoke captions on or off, or change size/style.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        enabled: { type: "boolean" },
        style: { type: "string" },
        fontSize: { type: "number" },
      },
      required: ["dir"],
    },
    run: ({ dir, enabled, style, fontSize }) => {
      const p = open(dir);
      const result = ops.setCaptions(p, { enabled, style, fontSize });
      save(dir, p);
      return result;
    },
  },
  {
    name: "cwmeditor_theme",
    description: "Switch caption and title theme. Options: neon, clean, punch, terminal, classic.",
    inputSchema: {
      type: "object",
      properties: { dir: { type: "string" }, name: { type: "string" } },
      required: ["dir", "name"],
    },
    run: ({ dir, name }) => {
      const p = open(dir);
      const result = ops.setTheme(p, name);
      save(dir, p);
      return result;
    },
  },
  {
    name: "cwmeditor_sticker",
    description: "Place an emoji sticker at a moment. Names come from cwmeditor_stickers (skull, exploding-head, melting, fire, robot...).",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        at: { type: "string" },
        name: { type: "string" },
        dur: { type: "number" },
        pos: { type: "string", enum: ["center", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"] },
        scale: { type: "number", description: "Fraction of frame width" },
      },
      required: ["dir", "at", "name"],
    },
    run: ({ dir, at, name, dur, pos, scale }) => {
      const p = open(dir);
      const result = ops.addSticker(p, { name, at, dur: dur ?? 1.4, pos: pos ?? "center", scale: scale ?? 0.18 });
      save(dir, p);
      return result;
    },
  },
  {
    name: "cwmeditor_bubble",
    description: "Chat-style popup bubble for a reaction moment.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        at: { type: "string" },
        text: { type: "string" },
        dur: { type: "number" },
        pos: { type: "string" },
      },
      required: ["dir", "at", "text"],
    },
    run: ({ dir, at, text, dur, pos }) => {
      const p = open(dir);
      const result = ops.addBubble(p, { text, at, dur: dur ?? 2.2, pos: pos ?? "bottom-right" });
      save(dir, p);
      return result;
    },
  },
  {
    name: "cwmeditor_chat",
    description: "Stacked chat-thread gag: messages appear one at a time, angled, then vanish together.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        at: { type: "string" },
        messages: { type: "array", items: { type: "string" } },
        dur: { type: "number" },
      },
      required: ["dir", "at", "messages"],
    },
    run: ({ dir, at, messages, dur }) => {
      const p = open(dir);
      const result = ops.addChat(p, { messages, at, dur: dur ?? 4 });
      save(dir, p);
      return result;
    },
  },
  {
    name: "cwmeditor_card",
    description: "Add a generated card: keycap, command, stamp, stat, chapter, notification, checklist or progress.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        kind: { type: "string", enum: ["keycap", "command", "stamp", "stat", "chapter", "notification", "checklist", "progress"] },
        at: { type: "string" },
        dur: { type: "number" },
        spec: { type: "object" },
      },
      required: ["dir", "kind", "at"],
    },
    run: ({ dir, kind, at, dur, spec }) => {
      const p = open(dir);
      const payload = { at, dur, ...(spec ?? {}) };
      const map = {
        keycap: ops.addKeycap,
        command: ops.addCommand,
        stamp: ops.addStamp,
        stat: ops.addStat,
        chapter: ops.addChapter,
        notification: ops.addNotification,
        checklist: ops.addChecklist,
        progress: ops.addProgress,
      };
      if (!map[kind]) throw new Error(`Unknown card kind ${kind}`);
      const result = map[kind](p, payload);
      save(dir, p);
      return result;
    },
  },
  {
    name: "cwmeditor_toast",
    description: "Achievement toast card that drops in from the top.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        at: { type: "string" },
        text: { type: "string" },
        label: { type: "string" },
        dur: { type: "number" },
      },
      required: ["dir", "at", "text"],
    },
    run: ({ dir, at, text, label, dur }) => {
      const p = open(dir);
      const result = ops.addToast(p, { text, at, dur: dur ?? 3, label: label ?? "Achievement unlocked", pos: "top" });
      save(dir, p);
      return result;
    },
  },
  {
    name: "cwmeditor_zoom",
    description: "Punch-in zoom on a moment.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        at: { type: "string" },
        dur: { type: "number" },
        factor: { type: "number" },
        cx: { type: "number" },
        cy: { type: "number" },
      },
      required: ["dir", "at"],
    },
    run: ({ dir, at, dur, factor, cx, cy }) => {
      const p = open(dir);
      const result = ops.addZoom(p, { at, dur: dur ?? 0.9, factor: factor ?? 1.3, cx: cx ?? 0.5, cy: cy ?? 0.5 });
      save(dir, p);
      return result;
    },
  },
  {
    name: "cwmeditor_gag_scan",
    description: "Scan the transcript and suggest gags: stickers on error words, bubbles on confusion, toasts on success, zooms on long pauses. Apply with apply=true or ids.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        apply: { type: "boolean" },
        ids: { type: "array", items: { type: "number" } },
      },
      required: ["dir"],
    },
    run: ({ dir, apply, ids }) => {
      const p = open(dir);
      const suggestions = scan(dir, p, {});
      const report = writeReport(dir, p, suggestions);
      let applied = [];
      if (apply || ids?.length) {
        applied = applyGags(p, suggestions, ids ?? null);
        save(dir, p);
      }
      return { count: suggestions.length, suggestions, applied, report };
    },
  },
  {
    name: "cwmeditor_sound",
    description: "Place a background sound effect at a moment, independent of any gag.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        at: { type: "string" },
        sound: { type: "string", description: "ding, pop, error, click, boom, whoosh" },
        gain: { type: "number", description: "dB, default -6" },
      },
      required: ["dir", "at", "sound"],
    },
    run: ({ dir, at, sound, gain }) => {
      const p = open(dir);
      const result = ops.addSfx(p, { sound, at, gain: gain ?? -6 });
      save(dir, p);
      return result;
    },
  },
  {
    name: "cwmeditor_sounds",
    description: "List available sound effects.",
    inputSchema: { type: "object", properties: {} },
    run: () => listSfx(),
  },
  {
    name: "cwmeditor_plan_get",
    description: "Return the current plan.json, or null.",
    inputSchema: dirSchema,
    run: ({ dir }) => loadPlan(dir),
  },
  {
    name: "cwmeditor_plan_set",
    description: "Validate and save a full edit plan. Ops use master time.",
    inputSchema: {
      type: "object",
      properties: { dir: { type: "string" }, plan: { type: "object" } },
      required: ["dir", "plan"],
    },
    run: ({ dir, plan }) => {
      const p = open(dir);
      const validation = validatePlan(dir, p, plan);
      if (!validation.ok) return { saved: false, ...validation };
      savePlan(dir, plan);
      return { saved: true, ...validation };
    },
  },
  {
    name: "cwmeditor_plan_validate",
    description: "Validate plan.json against the project without saving anything.",
    inputSchema: dirSchema,
    run: ({ dir }) => {
      const p = open(dir);
      const plan = loadPlan(dir);
      if (!plan) throw new Error("No plan.json");
      return validatePlan(dir, p, plan);
    },
  },
  {
    name: "cwmeditor_plan_apply",
    description: "Apply plan.json. dryRun returns the diff without changing the project.",
    inputSchema: {
      type: "object",
      properties: { dir: { type: "string" }, dryRun: { type: "boolean" } },
      required: ["dir"],
    },
    run: ({ dir, dryRun }) => {
      const p = open(dir);
      const plan = loadPlan(dir);
      if (!plan) throw new Error("No plan.json");
      if (dryRun) return planDiff(dir, p, plan);
      return applyPlan(dir, p, plan);
    },
  },
  {
    name: "cwmeditor_plan_suggest",
    description: "Build a draft plan from the transcript: sections, silence cuts, chapters and gags.",
    inputSchema: {
      type: "object",
      properties: { dir: { type: "string" }, write: { type: "boolean" } },
      required: ["dir"],
    },
    run: ({ dir, write }) => {
      const p = open(dir);
      return suggestPlan(dir, p, { write: Boolean(write) });
    },
  },
  {
    name: "cwmeditor_preview",
    description: "Render a fast half-resolution preview. Use this to check an edit before the final render.",
    inputSchema: dirSchema,
    run: ({ dir }) => renderProject(dir, { preview: true }),
  },
  {
    name: "cwmeditor_render",
    description: "Render the final video at project resolution.",
    inputSchema: {
      type: "object",
      properties: { dir: { type: "string" }, outro: { type: "boolean" } },
      required: ["dir"],
    },
    run: ({ dir, outro }) => renderProject(dir, { preview: false, outro: Boolean(outro) }),
  },
  {
    name: "cwmeditor_qc",
    description: "Check a render for black frames, long silences, loudness and duration drift.",
    inputSchema: {
      type: "object",
      properties: { dir: { type: "string" }, file: { type: "string" } },
      required: ["dir"],
    },
    run: ({ dir, file }) => {
      const p = open(dir);
      const target = file ?? latestOutput(dir);
      if (!target) throw new Error("No render found");
      return qc(dir, p, target);
    },
  },
  {
    name: "cwmeditor_review",
    description: "Build a local HTML review sheet: contact sheet, transcript, cuts and overlays.",
    inputSchema: dirSchema,
    run: ({ dir }) => buildReview(dir, open(dir), null),
  },
  {
    name: "cwmeditor_undo",
    description: "Undo the last timeline change.",
    inputSchema: dirSchema,
    run: ({ dir }) => {
      const p = open(dir);
      const result = ops.undo(p);
      save(dir, p);
      return result;
    },
  },
];

function open(dir) {
  if (!dir || !fs.existsSync(dir)) throw new Error(`Project directory not found: ${dir}`);
  const project = load(dir);
  project.__dir = dir;
  ops.withTranscript(project, dir);
  return project;
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function handle(message) {
  const { id, method, params } = message;

  if (method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    });
  }

  if (method === "notifications/initialized" || method === "notifications/cancelled") return;

  if (method === "ping") {
    return send({ jsonrpc: "2.0", id, result: {} });
  }

  if (method === "tools/list") {
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      },
    });
  }

  if (method === "tools/call") {
    const tool = tools.find((t) => t.name === params?.name);
    if (!tool) {
      return send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool ${params?.name}` },
      });
    }
    try {
      const result = await tool.run(params?.arguments ?? {});
      return send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    } catch (error) {
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: error.message }],
        },
      });
    }
  }

  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method ${method}` } });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  handle(message).catch((error) => {
    if (message.id !== undefined) {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: error.message } });
    }
  });
});

process.stderr.write(`cwmeditor MCP server ready (${tools.length} tools)\n`);
