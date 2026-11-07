#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  editedDuration,
  projectPaths,
  projectSummary,
  DEFAULT_FORMAT,
  formatPreset,
  initProject,
  load,
  resolveMember,
  save,
} from "./src/project.mjs";
import * as ops from "./src/ops.mjs";
import { renderProject } from "./src/render.mjs";
import { transcribe } from "./src/transcribe.mjs";
import { qc } from "./src/qc.mjs";
import { buildReview, latestOutput } from "./src/review.mjs";
import { buildThemeStrip } from "./src/themePreview.mjs";
import { applyGags, scan, writeReport } from "./src/gags.mjs";
import { detectBeats, snapOverlays } from "./src/beats.mjs";
import { applyPlan, loadPlan, planDiff, planSummary, savePlan, suggestPlan, validatePlan } from "./src/plan.mjs";
import { listSfx } from "./src/sfx.mjs";
import { THEMES, themeNames } from "./src/themes.mjs";
import { listStickers } from "./src/stickers.mjs";
import { ffmpeg, fmtTime, fwd, parseTime, probe, round, run } from "./src/util.mjs";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return { positional, flags };
}

function open(dir) {
  const project = load(dir);
  project.__dir = dir;
  ops.withTranscript(project, dir);
  return project;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const HELP = `cwmeditor - timeline as data, ffmpeg as the renderer

  cwmeditor init <dir> --source <file> [--name x] [--preset landscape|vertical|tiktok|shorts|reels|square]
                 [--w 1920 --h 1080 --fps 30] [--fit cover|blur|pad] [--reference]
                 [--excerpt 0:00-2:00]   (cuts a fast copy for quick tests)
  cwmeditor format <dir> [--preset vertical] [--w 1080 --h 1920 --fps 30] [--fit blur]
  cwmeditor status <dir>
  cwmeditor themes
  cwmeditor theme <dir> --name neon|clean|punch|terminal|classic
  cwmeditor theme-strip <dir> [--at 6]   (one frame per theme, tiled)
  cwmeditor transcribe <dir> [--model base|small|medium]
  cwmeditor use-transcript <dir> --file transcript.json
  cwmeditor cut <dir> --from 12.3 --to 14.8 [--label filler]
  cwmeditor cut-preview <dir> --from 12.3 --to 14.8
  cwmeditor uncut <dir> --id c1
  cwmeditor broll <dir> --from 4 --to 9 --src clip.mp4 [--src-in 2]
  cwmeditor broll-remove <dir> --id b1
  cwmeditor broll-clear <dir>
  cwmeditor meme <dir> --at 4.2 --src memes/x.gif [--dur 1.2] [--pos center] [--scale 0.4]
  cwmeditor sticker <dir> --at 12 --name skull [--dur 1.4] [--pos center] [--scale 0.16]
  cwmeditor bubble <dir> --at 38 --text "wait what" [--label chat] [--icon thinking] [--sound pop]
  cwmeditor chat <dir> --at 38 --msgs "wait what|no way|he actually did it" [--dur 4]
  cwmeditor keycap <dir> --at 12 --keys "Ctrl|Shift|P"
  cwmeditor command <dir> --at 20 --cmd "npm i opencode"
  cwmeditor stamp <dir> --at 30 --text BROKEN [--color #FF2D95]
  cwmeditor stat <dir> --at 40 --value 42 --label errors
  cwmeditor chapter <dir> --at 50 --part "PART 2" --title "where it breaks"
  cwmeditor notification <dir> --at 60 --title "Low disk space" --body "Free up space"
  cwmeditor checklist <dir> --at 70 --title SETUP --items "install node|clone repo|run it" [--done 1,2] [--ticks "40:2|60:3"] [--until end]
  cwmeditor progress <dir> --at 80 --label installing [--dur 3]

  Add --until end to any timed pop to keep it on screen until the video ends.
  cwmeditor toast <dir> --at 71 --text "It works first try" [--icon check] [--sound ding]
  cwmeditor zoom <dir> --at 95 --dur 0.9 --factor 1.35 [--cx 0.5 --cy 0.5]
  cwmeditor stickers
  cwmeditor gag-scan <dir> [--apply] [--ids 1,3] [--min-gap 18] [--max-per-min 3]
  cwmeditor text <dir> --at 4.2 --text "hello" [--dur 2] [--pos bottom]
  cwmeditor overlay-remove <dir> --id o1
  cwmeditor music <dir> --src bed.mp3 [--gain -10] [--duck soft|hard|off] [--fit loop|trim] [--fade 0.6] | --off
  cwmeditor voice <dir> --on|--off [--strength light|normal|strong]
  cwmeditor loudness <dir> --platform youtube|tiktok|instagram|podcast|cinema
  cwmeditor beats <dir> [--src bed.mp3] [--snap] [--window 0.3]
  cwmeditor sfx <dir> --at 12 --sound whoosh [--gain -6]
  cwmeditor sfx-remove <dir> --id x1
  cwmeditor sounds
  cwmeditor doctor
  cwmeditor plan-suggest <dir> [--write]
  cwmeditor plan-set <dir> --file plan.json
  cwmeditor plan-show <dir>
  cwmeditor plan-validate <dir>
  cwmeditor plan-diff <dir>
  cwmeditor plan-apply <dir> [--dry-run]
  cwmeditor captions <dir> --on|--off [--style karaoke] [--size 60]
  cwmeditor preview <dir>
  cwmeditor render <dir> [--outro]
  cwmeditor qc <dir> [--file out/x.mp4]
  cwmeditor review <dir> [--file out/x.mp4]
  cwmeditor undo <dir>
  cwmeditor ops <dir>
`;

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, dir] = positional;
  if (!command || command === "help" || flags.help) {
    process.stdout.write(HELP);
    return;
  }

  if (command === "themes") {
    print(
      Object.fromEntries(
        Object.entries(THEMES).map(([name, theme]) => [name, theme.label]),
      ),
    );
    return;
  }

  if (command === "stickers") {
    print(listStickers());
    return;
  }

  if (command === "sounds") {
    print(listSfx());
    return;
  }

  if (command === "doctor") {
    const report = { ffmpeg: null, ffprobe: null, filters: [], python: {}, stickers: 0, sounds: 0, beds: [] };
    try {
      const { stdout } = await run("ffmpeg", ["-version"]);
      report.ffmpeg = stdout.split("\n")[0];
    } catch {
      report.ffmpeg = null;
    }
    try {
      const { stdout } = await run("ffprobe", ["-version"]);
      report.ffprobe = stdout.split("\n")[0];
    } catch {
      report.ffprobe = null;
    }
    try {
      const { stdout } = await run("ffmpeg", ["-hide_banner", "-filters"]);
      for (const name of ["subtitles", "afftdn", "sidechaincompress", "loudnorm", "alimiter", "equalizer", "deesser"]) {
        if (new RegExp(`\\s${name}\\s`).test(stdout)) report.filters.push(name);
      }
    } catch {
      report.filters = [];
    }
    for (const [name, moduleName] of [["pillow", "PIL"], ["librosa", "librosa"], ["faster-whisper", "faster_whisper"]]) {
      try {
        await run("python", ["-c", `import ${moduleName}`]);
        report.python[name] = true;
      } catch {
        report.python[name] = false;
      }
    }
    report.stickers = listStickers().length;
    report.sounds = listSfx().length;
    try {
      report.beds = fs.readdirSync(path.join(process.cwd(), "beds")).filter((f) => /\.(wav|mp3|m4a)$/i.test(f));
    } catch {
      report.beds = [];
    }
    print(report);
    return;
  }

  if (!dir) throw new Error("Missing project directory");

  if (command === "init") {
    const source = flags.source;
    if (!source) throw new Error("init needs --source <file>");
    const preset = formatPreset(flags.preset);
    const absolute = path.resolve(source);
    if (!fs.existsSync(absolute)) throw new Error(`Source not found: ${absolute}`);
    const info = await probe(absolute);
    const paths = projectPaths(dir);
    fs.mkdirSync(paths.media, { recursive: true });
    let rel = absolute;
    let duration = info.duration;
    if (!flags.reference) {
      const ext = path.extname(absolute);
      const target = path.join(paths.media, `master${ext}`);
      if (flags.excerpt) {
        const [rawStart, rawEnd] = String(flags.excerpt).split("-");
        const start = parseTime(rawStart);
        const end = rawEnd ? parseTime(rawEnd) : info.duration;
        duration = Math.max(0.1, end - start);
        await ffmpeg([
          "-ss", String(start),
          "-t", String(duration),
          "-i", fwd(absolute),
          "-c", "copy",
          "-avoid_negative_ts", "make_zero",
          fwd(target),
        ]);
      } else if (path.resolve(target) !== absolute) {
        fs.copyFileSync(absolute, target);
      }
      rel = path.relative(paths.root, target).replace(/\\/g, "/");
    }
    const project = initProject({
      name: flags.name ?? path.basename(path.resolve(dir)),
      source: rel,
      format: {
        w: Number(flags.w ?? preset?.w ?? DEFAULT_FORMAT.w),
        h: Number(flags.h ?? preset?.h ?? DEFAULT_FORMAT.h),
        fps: Number(flags.fps ?? DEFAULT_FORMAT.fps),
        fit: flags.fit ?? preset?.fit ?? DEFAULT_FORMAT.fit,
      },
      duration: info.duration,
      hasVideo: info.hasVideo,
    });
    project.master.duration = duration;
    save(dir, project);
    print({ ok: true, dir: paths.root, ...projectSummary(project), source: rel });
    return;
  }

  const project = open(dir);

  if (flags.until === "end" && flags.at !== undefined) {
    flags.dur = Math.max(0.3, editedDuration(project) - parseTime(flags.at));
  }

  switch (command) {
    case "status":
      print({
        ...projectSummary(project),
        theme: project.theme ?? "neon",
        brollSlots: ops.brollSummary(project),
        overlays: ops.overlaySummary(project),
        history: (project.history ?? []).length,
      });
      break;

    case "format": {
      if (!flags.preset && flags.w === undefined && flags.h === undefined && flags.fps === undefined && flags.fit === undefined) {
        print({ ok: true, ...project.format });
        break;
      }
      const preset = formatPreset(flags.preset);
      const result = ops.setFormat(project, {
        w: flags.w ?? preset?.w,
        h: flags.h ?? preset?.h,
        fps: flags.fps,
        fit: flags.fit ?? preset?.fit,
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "theme": {
      const name = flags.name ?? positional[2];
      if (!name) throw new Error(`theme needs a name. Available: ${themeNames().join(", ")}`);
      const result = ops.setTheme(project, name);
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "theme-strip": {
      const at = flags.at ?? 6;
      const result = await buildThemeStrip(dir, project, Number(at));
      print({ ok: true, ...result });
      break;
    }

    case "transcribe": {
      const result = await transcribe(dir, project, { model: flags.model ?? "base" });
      print({ ok: true, ...result });
      break;
    }

    case "use-transcript": {
      if (!flags.file) throw new Error("use-transcript needs --file transcript.json");
      const absolute = path.resolve(flags.file);
      if (!fs.existsSync(absolute)) throw new Error(`Transcript not found: ${absolute}`);
      project.transcript = path.relative(path.resolve(dir), absolute).replace(/\\/g, "/");
      save(dir, project);
      print({ ok: true, transcript: project.transcript });
      break;
    }

    case "cut": {
      const result = ops.addCut(project, {
        from: flags.from,
        to: flags.to,
        label: flags.label ?? "cut",
      });
      save(dir, project);
      print({ ok: true, ...result, duration: round(editedDuration(project), 2) });
      break;
    }

    case "cut-preview":
      print({ ok: true, ...ops.previewCut(project, { from: flags.from, to: flags.to }) });
      break;

    case "uncut": {
      const result = ops.removeCut(project, flags.id);
      save(dir, project);
      print({ ok: true, ...result, duration: round(editedDuration(project), 2) });
      break;
    }

    case "broll": {
      const result = ops.addBroll(project, {
        from: flags.from,
        to: flags.to,
        src: flags.src,
        srcIn: flags["src-in"] ?? 0,
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "broll-remove": {
      const result = ops.removeBroll(project, flags.id);
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "broll-clear": {
      const result = ops.clearBroll(project);
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "meme": {
      const result = ops.addMeme(project, {
        at: flags.at,
        src: flags.src,
        dur: flags.dur ?? 1.2,
        pos: flags.pos ?? "center",
        scale: flags.scale ?? 0.4,
        style: flags.style ?? "pop",
        sound: flags.sound ?? null,
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "sticker": {
      const result = ops.addSticker(project, {
        name: flags.name ?? flags.sticker,
        at: flags.at,
        dur: flags.dur ?? 1.4,
        pos: flags.pos ?? "center",
        scale: flags.scale ?? 0.2,
        sound: flags.sound ?? "pop",
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "bubble": {
      const result = ops.addBubble(project, {
        text: flags.text,
        at: flags.at,
        dur: flags.dur ?? 2.2,
        pos: flags.pos ?? "bottom-right",
        side: flags.side ?? "left",
        label: flags.label ?? "chat",
        sound: flags.sound ?? "pop",
        icon: flags.icon ?? "thinking",
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "toast": {
      const result = ops.addToast(project, {
        text: flags.text,
        at: flags.at,
        dur: flags.dur ?? 3,
        pos: flags.pos ?? "top",
        label: flags.label ?? "Achievement unlocked",
        sound: flags.sound ?? "ding",
        icon: flags.icon ?? "check",
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "chat": {
      const result = ops.addChat(project, {
        messages: flags.msgs ?? flags.text ?? "",
        at: flags.at,
        dur: flags.dur ?? 4,
        pos: flags.pos ?? "bottom-right",
        sound: flags.sound ?? "pop",
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "keycap": {
      const result = ops.addKeycap(project, {
        keys: flags.keys ?? "Ctrl|Shift|P",
        at: flags.at,
        dur: flags.dur ?? 1.6,
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "command": {
      const result = ops.addCommand(project, {
        command: flags.cmd ?? flags.text ?? "",
        at: flags.at,
        dur: flags.dur ?? 2.6,
        label: flags.label ?? "terminal",
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "stamp": {
      const result = ops.addStamp(project, {
        text: flags.text,
        at: flags.at,
        dur: flags.dur ?? 1.2,
        color: flags.color ?? "#FF2D95",
        angle: flags.angle ?? -8,
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "stat": {
      const result = ops.addStat(project, {
        value: flags.value,
        label: flags.label ?? "",
        at: flags.at,
        dur: flags.dur ?? 1.8,
        accent: flags.accent ?? "#FF2D95",
        pos: flags.pos ?? "center",
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "chapter": {
      const result = ops.addChapter(project, {
        part: flags.part ?? "PART 2",
        title: flags.title ?? "",
        at: flags.at,
        dur: flags.dur ?? 2.4,
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "notification": {
      const result = ops.addNotification(project, {
        app: flags.app ?? "System",
        title: flags.title ?? "Low disk space",
        body: flags.body ?? "",
        icon: flags.icon ?? "warning",
        at: flags.at,
        dur: flags.dur ?? 2.5,
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "checklist": {
      const done = String(flags.done ?? "")
        .split(",")
        .map((n) => Number(n.trim()))
        .filter(Boolean);
      const items = String(flags.items ?? "")
        .split("|")
        .map((text, i) => ({ text: text.trim(), done: done.includes(i + 1) }));
      const result = ops.addChecklist(project, {
        title: flags.title ?? "SETUP",
        items,
        ticks: flags.ticks ?? "",
        at: flags.at,
        dur: flags.dur ?? 6,
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "progress": {
      const result = ops.addProgress(project, {
        label: flags.label ?? "installing",
        at: flags.at,
        dur: flags.dur ?? 3,
        frames: flags.frames ?? 5,
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "zoom": {
      const result = ops.addZoom(project, {
        at: flags.at,
        dur: flags.dur ?? 0.9,
        factor: flags.factor ?? 1.35,
        cx: flags.cx ?? 0.5,
        cy: flags.cy ?? 0.5,
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "gag-scan": {
      const suggestions = scan(dir, project, {
        minGap: flags["min-gap"],
        maxPerMinute: flags["max-per-min"],
      });
      const report = writeReport(dir, project, suggestions);
      let applied = [];
      if (flags.apply || flags.ids) {
        const ids = flags.ids
          ? String(flags.ids)
              .split(",")
              .map((n) => Number(n.trim()))
              .filter(Boolean)
          : null;
        applied = applyGags(project, suggestions, ids);
        save(dir, project);
      }
      print({ ok: true, count: suggestions.length, suggestions, applied, report });
      break;
    }

    case "text": {
      const result = ops.addText(project, {
        at: flags.at,
        text: flags.text,
        dur: flags.dur ?? 2,
        pos: flags.pos ?? "bottom",
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "overlay-remove": {
      const result = ops.removeOverlay(project, flags.id);
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "music": {
      const result = ops.setMusic(project, {
        src: flags.off ? null : flags.src,
        gain: flags.gain ?? -10,
        duck: !flags["no-duck"],
        duckProfile: flags.duck ?? (flags["no-duck"] ? "off" : null),
        fit: flags.fit ?? "loop",
        fade: flags.fade ?? 0.6,
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "voice": {
      const result = ops.setVoice(project, {
        enabled: flags.on ? true : flags.off ? false : undefined,
        strength: flags.strength,
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "loudness": {
      const result = ops.setLoudness(project, {
        platform: flags.platform,
        lufs: flags.lufs,
        truePeak: flags.tp,
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "beats": {
      const src = flags.src
        ? path.resolve(flags.src)
        : project.audio.music
          ? resolveMember(dir, project.audio.music)
          : null;
      if (!src) throw new Error("No music set. Pass --src or set music first.");
      const data = await detectBeats(dir, src);
      let snapped = 0;
      if (flags.snap) {
        snapped = snapOverlays(project, data.beats, Number(flags.window ?? 0.3));
        save(dir, project);
      }
      print({ ok: true, bpm: data.bpm, beats: data.beats.length, duration: data.duration, snapped });
      break;
    }

    case "sfx": {
      const result = ops.addSfx(project, {
        sound: flags.sound,
        at: flags.at,
        gain: flags.gain ?? -6,
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "sfx-remove": {
      const result = ops.removeSfx(project, flags.id);
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "plan-suggest": {
      const plan = suggestPlan(dir, project, { write: Boolean(flags.write) });
      print({ ok: true, written: Boolean(flags.write), summary: planSummary(plan) });
      break;
    }

    case "plan-set": {
      if (!flags.file) throw new Error("plan-set needs --file plan.json");
      const incoming = JSON.parse(fs.readFileSync(path.resolve(flags.file), "utf8"));
      const validation = validatePlan(dir, project, incoming);
      if (!validation.ok) {
        print({ ok: false, ...validation });
        process.exit(1);
      }
      savePlan(dir, incoming);
      print({ ok: true, ...validation });
      break;
    }

    case "plan-show": {
      const plan = loadPlan(dir);
      print({ ok: true, plan: planSummary(plan) });
      break;
    }

    case "plan-validate": {
      const plan = loadPlan(dir);
      if (!plan) throw new Error("No plan.json. Run: cwmeditor plan-suggest <dir> --write");
      print({ ok: true, ...validatePlan(dir, project, plan) });
      break;
    }

    case "plan-diff": {
      const plan = loadPlan(dir);
      if (!plan) throw new Error("No plan.json");
      print({ ok: true, ...planDiff(dir, project, plan) });
      break;
    }

    case "plan-apply": {
      const plan = loadPlan(dir);
      if (!plan) throw new Error("No plan.json");
      if (flags["dry-run"]) {
        print({ ok: true, dryRun: true, ...planDiff(dir, project, plan) });
      } else {
        const result = applyPlan(dir, project, plan);
        print({ ok: true, ...result });
      }
      break;
    }

    case "captions": {
      const result = ops.setCaptions(project, {
        enabled: flags.on ? true : flags.off ? false : undefined,
        style: flags.style,
        fontSize: flags.size,
      });
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    case "preview": {
      const result = await renderProject(dir, { preview: true });
      print({ ok: true, ...result });
      break;
    }

    case "render": {
      const result = await renderProject(dir, { preview: false, outro: Boolean(flags.outro) });
      print({ ok: true, ...result });
      break;
    }

    case "qc": {
      const file = flags.file ?? latestOutput(dir);
      if (!file) throw new Error("No render found. Run: cwmeditor render <dir>");
      print({ ok: true, ...(await qc(dir, project, file)) });
      break;
    }

    case "review": {
      const result = await buildReview(dir, project, flags.file ?? null);
      print({ ok: true, ...result });
      break;
    }

    case "ops": {
      print({
        cuts: project.cuts,
        broll: ops.brollSummary(project),
        overlays: ops.overlaySummary(project),
        editedDuration: round(editedDuration(project), 2),
        formatted: fmtTime(editedDuration(project)),
      });
      break;
    }

    case "undo": {
      const result = ops.undo(project);
      save(dir, project);
      print({ ok: true, ...result });
      break;
    }

    default:
      throw new Error(`Unknown command: ${command}\n\n${HELP}`);
  }
}

main().catch((error) => {
  process.stderr.write(`\n${error.message}\n`);
  process.exit(1);
});
