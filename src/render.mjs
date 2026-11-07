import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  editedDuration,
  keptRanges,
  load,
  masterToEdited,
  projectPaths,
  resolveMember,
} from "./project.mjs";
import { buildAss } from "./captions.mjs";
import { resolveSfx } from "./sfx.mjs";
import { resolveSticker } from "./stickers.mjs";
import { ffmpeg, filterPath, fwd, pickEncoder, probe, round, run, videoArgs } from "./util.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CARDS_PY = path.join(here, "cards.py");
const IMAGE_RE = /\.(png|jpe?g|webp|bmp)$/i;
const IMAGE_OVERLAYS = new Set([
  "meme", "sticker", "bubble", "toast", "chat",
  "keycap", "command", "stamp", "stat", "chapter", "notification", "checklist", "progress",
]);

const SPEC_FRACTIONS = {
  keycap: 0.34,
  command: 0.42,
  stamp: 0.45,
  stat: 0.4,
  chapter: 0.5,
  notification: 0.38,
  checklist: 0.3,
  progress: 0.5,
};

const SPEC_KINDS = new Set(Object.keys(SPEC_FRACTIONS));

function even(n) {
  return Math.max(2, Math.round(n / 2) * 2);
}

function overlayPosition(pos, size) {
  const { top, bottom, side } = safeBands(size);
  switch (pos) {
    case "top":
      return { x: "(W-w)/2", y: `H*${top}` };
    case "top-left":
      return { x: `W*${side}`, y: `H*${top}` };
    case "top-right":
      return { x: `W-w-W*${side}`, y: `H*${top}` };
    case "bottom":
      return { x: "(W-w)/2", y: `H-h-H*${bottom}` };
    case "bottom-left":
      return { x: `W*${side}`, y: `H-h-H*${bottom}` };
    case "bottom-right":
      return { x: `W-w-W*${side}`, y: `H-h-H*${bottom}` };
    default:
      return { x: "(W-w)/2", y: "(H-h)/2" };
  }
}

// Keeps portable clips clear of the platform UI. Portrait gets a taller bottom
// band for captions, username and the action rail, plus a lower top band.
function safeBands(size) {
  return size.h > size.w
    ? { top: 0.11, bottom: 0.22, side: 0.06 }
    : { top: 0.08, bottom: 0.12, side: 0.06 };
}

function fitChain(input, output, size, fit, tag) {
  const { w, h } = size;
  if (fit === "pad") {
    return (
      `[${input}]scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[${output}]`
    );
  }
  if (fit === "blur") {
    const sigma = Math.max(12, Math.round(h / 27));
    return (
      `[${input}]split=2[${tag}a][${tag}b];` +
      `[${tag}a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},` +
      `gblur=sigma=${sigma},eq=brightness=-0.12:saturation=0.7[${tag}c];` +
      `[${tag}b]scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
      `drawbox=x=0:y=0:w=iw:h=ih:color=black@0.35:t=4[${tag}d];` +
      `[${tag}c][${tag}d]overlay=(W-w)/2:(H-h)/2,setsar=1[${output}]`
    );
  }
  return (
    `[${input}]scale=${w}:${h}:force_original_aspect_ratio=increase,` +
    `crop=${w}:${h},setsar=1[${output}]`
  );
}

// Blur padding only makes sense when the source aspect differs from the output.
// A native vertical clip should fill the frame without a second blurred pass.
function effectiveFit(project, info, size) {
  const fit = project.format.fit ?? "cover";
  if (fit !== "blur" || !info?.width || !info?.height) return fit;
  const source = info.width / info.height;
  const output = size.w / size.h;
  return Math.abs(source - output) < 0.01 ? "cover" : fit;
}

// Portrait frames have far more empty width than a 16:9 frame, so cards need
// to occupy a larger share of it to stay readable on a phone.
function cardWidth(size, fraction, min = 64) {
  const scale = size.h > size.w ? 1.25 : 1;
  return Math.max(min, Math.round((size.w * fraction * scale) / 2) * 2);
}

async function buildBaseVideo(project, masterPath, info, outFile, size, fps, vargs) {
  const ranges = keptRanges(project);
  if (!ranges.length) throw new Error("Nothing left after cuts");

  if (!info.hasVideo) {
    const duration = editedDuration(project);
    await ffmpeg([
      "-f", "lavfi",
      "-i", `color=c=0x0d0d14:s=${size.w}x${size.h}:r=${fps}:d=${round(duration, 3)}`,
      "-an",
      ...vargs,
      fwd(outFile),
    ]);
    return;
  }

  const fit = effectiveFit(project, info, size);
  const filters = [];
  ranges.forEach((r, i) => {
    filters.push(
      `[0:v]trim=start=${r.start}:end=${r.end},setpts=PTS-STARTPTS,fps=${fps}[t${i}]`,
    );
    filters.push(fitChain(`t${i}`, `v${i}`, size, fit, `bf${i}`));
  });
  const labels = ranges.map((_, i) => `[v${i}]`).join("");
  if (ranges.length > 1) {
    filters.push(`${labels}concat=n=${ranges.length}:v=1:a=0[vout]`);
  }

  await ffmpeg([
    "-i", fwd(masterPath),
    "-filter_complex", filters.join(";"),
    "-map", ranges.length === 1 ? "[v0]" : "[vout]",
    "-an",
    ...vargs,
    "-r", String(fps),
    fwd(outFile),
  ]);
}

async function buildVoice(project, masterPath, info, outFile) {
  const ranges = keptRanges(project);
  if (!info.hasAudio) {
    const duration = editedDuration(project);
    await ffmpeg([
      "-f", "lavfi",
      "-i", "anullsrc=r=48000:cl=stereo",
      "-t", String(round(duration, 3)),
      "-c:a", "pcm_s16le",
      fwd(outFile),
    ]);
    return;
  }

  const parts = ranges.map(
    (r, i) => `[0:a]atrim=start=${r.start}:end=${r.end},asetpts=PTS-STARTPTS[a${i}]`,
  );
  const labels = ranges.map((_, i) => `[a${i}]`).join("");
  const graph =
    ranges.length === 1
      ? `${parts[0]}`
      : `${parts.join(";")};${labels}concat=n=${ranges.length}:v=0:a=1[aout]`;

  await ffmpeg([
    "-i", fwd(masterPath),
    "-filter_complex", graph,
    "-map", ranges.length === 1 ? "[a0]" : "[aout]",
    "-vn",
    "-c:a", "pcm_s16le",
    fwd(outFile),
  ]);
}

function editedBroll(project) {
  const total = editedDuration(project);
  const slots = [];
  for (const item of project.broll) {
    const start = Math.max(0, masterToEdited(project, item.start));
    const end = Math.min(total, masterToEdited(project, item.end));
    if (end - start < 0.05) continue;
    slots.push({ ...item, start, end });
  }
  slots.sort((a, b) => a.start - b.start);
  const clean = [];
  let cursor = 0;
  for (const slot of slots) {
    const start = Math.max(slot.start, cursor);
    if (slot.end - start < 0.05) continue;
    clean.push({ ...slot, start });
    cursor = slot.end;
  }
  return clean;
}

async function spliceVideo(project, dir, baseFile, outFile, size, fps, vargs) {
  const total = editedDuration(project);
  const slots = editedBroll(project);
  if (!slots.length) {
    fs.copyFileSync(baseFile, outFile);
    return;
  }

  const work = projectPaths(dir).work;
  const parts = [];
  let cursor = 0;
  let index = 0;

  const renderBase = async (start, end) => {
    const file = path.join(work, `part-${index++}.mp4`);
    await ffmpeg([
      "-ss", String(round(start, 3)),
      "-t", String(round(end - start, 3)),
      "-i", fwd(baseFile),
      "-an",
      ...vargs,
      "-r", String(fps),
      fwd(file),
    ]);
    parts.push(file);
  };

  const renderBroll = async (slot) => {
    const file = path.join(work, `part-${index++}.mp4`);
    const duration = slot.end - slot.start;
    const src = resolveMember(dir, slot.src);
    const input = IMAGE_RE.test(src)
      ? ["-loop", "1", "-t", String(round(duration, 3)), "-i", fwd(src)]
      : ["-ss", String(round(slot.srcIn ?? 0, 3)), "-t", String(round(duration, 3)), "-i", fwd(src)];
    let fit = project.format.fit ?? "cover";
    if (!IMAGE_RE.test(src)) {
      try {
        fit = effectiveFit(project, await probe(src), size);
      } catch {
        // Fall back to the project fit if the b-roll cannot be probed.
      }
    }
    const graph = fitChain("0:v", "bout", size, fit, "br");
    await ffmpeg([
      ...input,
      "-an",
      "-filter_complex", graph,
      "-map", "[bout]",
      ...vargs,
      "-r", String(fps),
      fwd(file),
    ]);
    parts.push(file);
  };

  for (const slot of slots) {
    if (slot.start > cursor) await renderBase(cursor, slot.start);
    await renderBroll(slot);
    cursor = slot.end;
  }
  if (cursor < total) await renderBase(cursor, total);

  const listFile = path.join(work, "concat.txt");
  fs.writeFileSync(listFile, parts.map((p) => `file '${fwd(p)}'`).join("\n"));
  await ffmpeg([
    "-f", "concat", "-safe", "0", "-i", fwd(listFile),
    "-c", "copy",
    fwd(outFile),
  ]);
}

async function makeCard(dir, overlay, size) {
  const out = path.join(projectPaths(dir).work, "cards", `${overlay.id}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const fraction = overlay.kind === "toast" ? 0.52 : 0.4;
  const width = cardWidth(size, fraction);
  const args = [
    CARDS_PY,
    "--kind", overlay.kind,
    "--text", overlay.text,
    "--out", out,
    "--width", String(width),
  ];
  if (overlay.label) args.push("--label", overlay.label);
  const icon = overlay.icon ?? (overlay.kind === "toast" ? "check" : overlay.kind === "bubble" ? "thinking" : null);
  if (icon) {
    try {
      args.push("--icon", resolveSticker(icon));
    } catch {
      // A missing icon should never fail a render.
    }
  }
  if (overlay.kind === "bubble") args.push("--side", overlay.side ?? "left");
  await run("python", args);
  return out;
}

async function applyZooms(project, dir, videoFile, outFile, size, fps, vargs) {
  const total = editedDuration(project);
  const zooms = project.overlays
    .filter((o) => o.kind === "zoom")
    .map((o) => ({
      ...o,
      start: Math.max(0, masterToEdited(project, o.at)),
    }))
    .filter((o) => o.start < total - 0.05)
    .sort((a, b) => a.start - b.start);

  if (!zooms.length) {
    fs.copyFileSync(videoFile, outFile);
    return 0;
  }

  const work = projectPaths(dir).work;
  const parts = [];
  let cursor = 0;
  let index = 0;

  const renderPart = async (start, end, zoom) => {
    const file = path.join(work, `zoom-${index++}.mp4`);
    const filters = [];
    const args = [
      "-ss", String(round(start, 3)),
      "-t", String(round(end - start, 3)),
      "-i", fwd(videoFile),
      "-an",
    ];
    if (zoom) {
      const f = zoom.factor;
      const [cx, cy] = zoom.center ?? [0.5, 0.5];
      filters.push(
        `[0:v]crop=iw/${f}:ih/${f}:(iw-iw/${f})*${cx}:(ih-ih/${f})*${cy},fps=${fps}[zin]`,
      );
    } else {
      filters.push(`[0:v]fps=${fps}[zin]`);
    }
    filters.push(fitChain("zin", "zout", size, "cover", `zf${index}`));
    args.push("-filter_complex", filters.join(";"), "-map", "[zout]");
    args.push(...vargs, "-r", String(fps), fwd(file));
    await ffmpeg(args);
    parts.push(file);
  };

  for (const zoom of zooms) {
    const start = Math.max(cursor, zoom.start);
    const end = Math.min(total, zoom.start + zoom.dur);
    if (end - start < 0.08) continue;
    if (start > cursor) await renderPart(cursor, start, null);
    await renderPart(start, end, zoom);
    cursor = end;
  }
  if (cursor < total) await renderPart(cursor, total, null);

  const listFile = path.join(work, "zoom-concat.txt");
  fs.writeFileSync(listFile, parts.map((p) => `file '${fwd(p)}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", fwd(listFile), "-c", "copy", fwd(outFile)]);
  return zooms.length;
}

async function makeChat(dir, overlay, size) {
  const width = cardWidth(size, 0.3);
  const base = path.join(projectPaths(dir).work, "cards", `${overlay.id}`);
  const folder = path.dirname(base);
  fs.mkdirSync(folder, { recursive: true });
  const fallbackIcons = ["thinking", "eyes", "exploding-head", "clown", "fire"];
  const messages = overlay.messages.map((message, i) => {
    let icon;
    try {
      icon = resolveSticker(message.icon ?? fallbackIcons[i % fallbackIcons.length]);
    } catch {
      icon = undefined;
    }
    return {
      text: message.text ?? String(message),
      name: message.name ?? `viewer${i + 1}`,
      icon,
    };
  });
  const spec = path.join(folder, `${overlay.id}.json`);
  fs.writeFileSync(spec, JSON.stringify({ width, messages }));
  const { stdout } = await run("python", [
    CARDS_PY, "--kind", "chat", "--spec", spec, "--out", base, "--width", String(width),
  ]);
  const line = stdout.trim().split("\n").filter(Boolean).pop();
  return JSON.parse(line);
}

async function renderSpec(dir, kind, spec, width, idSuffix) {
  const base = path.join(projectPaths(dir).work, "cards", idSuffix);
  fs.mkdirSync(path.dirname(base), { recursive: true });
  const specFile = `${base}.json`;
  fs.writeFileSync(specFile, JSON.stringify({ ...spec, width }));
  const outPath = kind === "progress" ? base : `${base}.png`;
  const { stdout } = await run("python", [
    CARDS_PY,
    "--kind", kind,
    "--spec", specFile,
    "--out", outPath,
    "--width", String(width),
  ]);
  const line = stdout.trim().split("\n").filter(Boolean).pop();
  return JSON.parse(line);
}

async function makeSpecCard(dir, overlay, size) {
  const fraction =
    overlay.kind === "stat" && overlay.pos && overlay.pos !== "center"
      ? 0.22
      : SPEC_FRACTIONS[overlay.kind];
  const width = cardWidth(size, fraction);
  const spec = { ...overlay.spec };
  if (spec.icon) {
    try {
      spec.icon = resolveSticker(spec.icon);
    } catch {
      delete spec.icon;
    }
  }
  const data = await renderSpec(dir, overlay.kind, spec, width, overlay.id);
  return { ...data, base: path.join(projectPaths(dir).work, "cards", overlay.id) };
}

async function makeChecklistStages(dir, project, item, size, start, end) {
  const width = cardWidth(size, SPEC_FRACTIONS.checklist);
  const baseItems = item.spec.items ?? [];
  const ticks = (item.spec.ticks ?? [])
    .map((tick) => ({
      at: Math.max(start, Math.min(end, masterToEdited(project, tick.atMaster))),
      count: tick.count,
    }))
    .sort((a, b) => a.at - b.at);

  const stages = [{ at: start, count: 0 }];
  for (const tick of ticks) {
    if (tick.at > stages[stages.length - 1].at + 0.08) stages.push(tick);
  }

  const files = [];
  for (let i = 0; i < stages.length; i += 1) {
    const spec = {
      ...item.spec,
      items: baseItems.map((entry, index) => ({
        ...entry,
        done: Boolean(entry.done) || index < stages[i].count,
      })),
    };
    const data = await renderSpec(dir, "checklist", spec, width, `${item.id}-s${i}`);
    files.push(data.files[0]);
  }

  return stages.map((stage, i) => ({
    file: files[i],
    at: stage.at,
    until: i === stages.length - 1 ? round(end, 3) : round(stages[i + 1].at, 3),
  }));
}

async function scalePng(src, factor, out) {
  await ffmpeg([
    "-i", fwd(src),
    "-vf", `scale=iw*${factor}:-1`,
    "-frames:v", "1",
    "-update", "1",
    "-pix_fmt", "rgba",
    fwd(out),
  ]);
  return out;
}

async function applyOverlays(project, dir, videoFile, outFile, size, fps, vargs, fullSize = size) {
  const total = editedDuration(project);
  const bands = safeBands(size);
  const portrait = size.h > size.w;
  const cardSize = fullSize;
  const cardScale = size.w / cardSize.w;
  const items = project.overlays
    .filter((o) => IMAGE_OVERLAYS.has(o.kind))
    .map((o) => ({ ...o, editedAt: masterToEdited(project, o.at) }))
    .filter((o) => o.editedAt < total - 0.05)
    .sort((a, b) => a.editedAt - b.editedAt);

  if (!items.length) {
    fs.copyFileSync(videoFile, outFile);
    return 0;
  }

  const args = ["-i", fwd(videoFile)];
  const filters = [];
  let current = "0:v";
  let inputIndex = 0;

  const addInput = (file, end) => {
    args.push("-loop", "1", "-t", String(round(end, 3)), "-i", fwd(file));
    inputIndex += 1;
    return inputIndex;
  };

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const duration = Math.min(item.dur, total - item.editedAt);
    const end = item.editedAt + duration;
    const start = round(item.editedAt, 3);

    if (item.kind === "chat") {
      const { files, canvas } = await makeChat(dir, item, cardSize);
      const cw = Math.max(1, Math.round(canvas.w * cardScale));
      const ch = Math.max(1, Math.round(canvas.h * cardScale));
      const x = `W-${cw}-W*${bands.side}`;
      const y = portrait ? "H*0.09" : `H-${ch}-H*${bands.bottom}`;
      for (let j = 0; j < files.length; j += 1) {
        const idx = addInput(files[j], end);
        const at = round(start + j * 0.28, 3);
        const label = `c${i}_${j}`;
        filters.push(
          `[${idx}:v]setpts=PTS-STARTPTS,format=rgba,scale=iw*${cardScale}:-1,` +
            `fade=t=in:st=${at}:d=0.12:alpha=1[${label}]`,
        );
        const next = `v${i}_${j}`;
        filters.push(
          `[${current}][${label}]overlay=x=${x}:y=${y}:` +
            `enable='between(t,${at},${round(end, 3)})':eof_action=pass[${next}]`,
        );
        current = next;
      }
      continue;
    }

    if (SPEC_KINDS.has(item.kind)) {
      let stages = [];

      if (item.kind === "checklist" && (item.spec.ticks ?? []).length) {
        stages = await makeChecklistStages(dir, project, item, cardSize, start, end);
      } else {
        const { files, base } = await makeSpecCard(dir, item, cardSize);
        const pop = ["keycap", "command", "stat", "checklist"].includes(item.kind);

        if (files.length === 1 && (pop || item.kind === "stamp")) {
          const factor = pop ? 0.86 : 1.35;
          const variant = await scalePng(files[0], factor, `${base}-pop.png`);
          stages.push({ file: variant, at: start, until: round(start + 0.1, 3) });
          stages.push({ file: files[0], at: round(start + 0.1, 3), until: round(end, 3) });
        } else {
          const step = (end - start) / files.length;
          files.forEach((file, j) => {
            const at = j === 0 ? start : round(start + j * step, 3);
            const until = j === files.length - 1 ? round(end, 3) : round(start + (j + 1) * step, 3);
            stages.push({ file, at, until });
          });
        }
      }

      for (let j = 0; j < stages.length; j += 1) {
        const stage = stages[j];
        const idx = addInput(stage.file, stage.until);
        const label = `s${i}_${j}`;
        filters.push(
          `[${idx}:v]setpts=PTS-STARTPTS,format=rgba,scale=iw*${cardScale}:-1[${label}]`,
        );

        let pos;
        switch (item.kind) {
          case "keycap":
            pos = { x: "(W-w)/2", y: `H-h-H*${bands.bottom}` };
            break;
          case "command":
            pos = { x: `W*${bands.side}`, y: `H-h-H*${bands.bottom}` };
            break;
          case "stamp":
            pos = { x: "(W-w)/2", y: "(H-h)/2" };
            break;
          case "stat": {
            const map = {
              center: { x: "(W-w)/2", y: "(H-h)/2" },
              "bottom-left": { x: `W*${bands.side}`, y: `H-h-H*${bands.bottom}` },
              "bottom-right": { x: `W-w-W*${bands.side}`, y: `H-h-H*${bands.bottom}` },
              "top-left": { x: `W*${bands.side}`, y: `H*${bands.top}` },
              "top-right": { x: `W-w-W*${bands.side}`, y: `H*${bands.top}` },
            };
            pos = map[item.pos] ?? map.center;
            break;
          }
          case "chapter":
            pos = {
              x: `'if(lt(t,${stage.at}+0.25),-w+(W*${bands.side}+w)*min(1,(t-${stage.at})/0.25),W*${bands.side})'`,
              y: portrait ? "H*0.32" : "H*0.3",
            };
            break;
          case "notification":
            pos = {
              x: `'if(lt(t,${stage.at}+0.3),W-(w+W*${bands.side})*min(1,(t-${stage.at})/0.3),W-w-W*${bands.side})'`,
              y: `H*${bands.top}`,
            };
            break;
          case "checklist":
            pos = { x: `W-w-W*${bands.side}`, y: `H*${portrait ? 0.16 : 0.14}` };
            break;
          case "progress":
            pos = { x: "(W-w)/2", y: `H-h-H*${bands.bottom}` };
            break;
          default:
            pos = { x: "(W-w)/2", y: "(H-h)/2" };
        }

        const next = `v${i}_${j}`;
        filters.push(
          `[${current}][${label}]overlay=x=${pos.x}:y=${pos.y}:` +
            `enable='between(t,${stage.at},${stage.until})':eof_action=pass[${next}]`,
        );
        current = next;
      }
      continue;
    }

    let src;
    if (item.kind === "bubble" || item.kind === "toast") {
      src = await makeCard(dir, item, cardSize);
    } else {
      src = resolveMember(dir, item.src);
    }
    const idx = addInput(src, end);
    const label = `m${i}`;

    let pre;
    if (item.kind === "sticker") {
      const width = Math.max(32, Math.round(size.w * item.scale));
      pre = `[${idx}:v]setpts=PTS-STARTPTS,format=rgba,scale=${width}:-1[${label}]`;
    } else if (item.kind === "bubble" || item.kind === "toast") {
      pre = `[${idx}:v]setpts=PTS-STARTPTS,format=rgba,scale=iw*${cardScale}:-1,fade=t=in:st=0:d=0.12:alpha=1,fade=t=out:st=${round(end - 0.18, 3)}:d=0.18:alpha=1[${label}]`;
    } else {
      pre = `[${idx}:v]setpts=PTS-STARTPTS,format=rgba,scale=iw*${item.scale}:-1,fade=t=in:st=${start}:d=0.12:alpha=1[${label}]`;
    }

    filters.push(pre);

    let pos;
    if (item.kind === "toast") {
      const drop = 0.3;
      const target = `H*${bands.top}`;
      const p = `((t-${start})/${drop})`;
      const y = `if(lt(t,${start}),-h,if(lt(t,${start + drop}),-h+(${target}+h)*(1-pow(1-${p},3)),${target}))`;
      pos = { x: "(W-w)/2", y: `'${y}'` };
    } else if (item.kind === "bubble") {
      pos = portrait
        ? { x: `W-w-W*${bands.side}`, y: "H*0.24" }
        : { x: `W-w-W*${bands.side}`, y: `H-h-H*0.26` };
    } else {
      pos = overlayPosition(item.pos, size);
    }

    const next = `v${i}`;
    filters.push(
      `[${current}][${label}]overlay=x=${pos.x}:y=${pos.y}:` +
        `enable='between(t,${start},${round(end, 3)})':eof_action=pass[${next}]`,
    );
    current = next;
  }

  await ffmpeg([
    ...args,
    "-filter_complex", filters.join(";"),
    "-map", `[${current}]`,
    "-an",
    ...vargs,
    "-r", String(fps),
    fwd(outFile),
  ]);
  return items.length;
}

async function burnCaptions(project, dir, videoFile, outFile, size, vargs) {
  const hasText = (project.overlays ?? []).some((o) => o.kind === "text");
  if (!project.transcript && !hasText) {
    fs.copyFileSync(videoFile, outFile);
    return null;
  }
  let transcript = null;
  if (project.transcript) {
    const transcriptPath = resolveMember(dir, project.transcript);
    if (fs.existsSync(transcriptPath)) {
      transcript = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
    }
  }
  if (!transcript && !hasText) {
    fs.copyFileSync(videoFile, outFile);
    return null;
  }
  const { ass, lines, words, theme } = buildAss(project, transcript, size);
  if (!words && !hasText) {
    fs.copyFileSync(videoFile, outFile);
    return null;
  }
  const assFile = path.join(projectPaths(dir).work, "captions.ass");
  fs.writeFileSync(assFile, ass);
  await ffmpeg([
    "-i", fwd(videoFile),
    "-vf", `subtitles='${filterPath(assFile)}'`,
    "-an",
    ...vargs,
    fwd(outFile),
  ]);
  return { lines, words, theme };
}

async function mixSfx(project, dir, voiceFile, outFile) {
  const defaults = {
    toast: "ding", bubble: "pop", sticker: "pop", chat: "pop",
    keycap: "click", command: "pop", stamp: "boom", stat: "pop",
    chapter: "whoosh", notification: "ding", checklist: "pop", progress: "pop",
  };
  const events = [];
  for (const overlay of project.overlays) {
    const sound = overlay.sound ?? defaults[overlay.kind];
    if (!sound || sound === "none") continue;
    const at = masterToEdited(project, overlay.at);
    if (at < 0 || at > editedDuration(project)) continue;
    if (overlay.kind === "chat") {
      (overlay.messages ?? []).forEach((_, i) => {
        events.push({ sound, atEdited: at + i * 0.28 });
      });
    } else {
      events.push({ sound, atEdited: at });
    }
  }

  for (const entry of project.audio.sfx ?? []) {
    events.push({
      sound: entry.sound,
      atEdited: masterToEdited(project, entry.at),
      gainDb: entry.gain,
    });
  }

  if (!events.length) {
    fs.copyFileSync(voiceFile, outFile);
    return 0;
  }

  const args = ["-i", fwd(voiceFile)];
  const filters = [];
  const labels = ["[0:a]"];

  events.forEach((event, i) => {
    const file = resolveSfx(event.sound);
    if (!file) return;
    args.push("-i", fwd(file));
    const ms = Math.round(event.atEdited * 1000);
    filters.push(`[${i + 1}:a]adelay=${ms}|${ms},volume=${event.gainDb != null ? `${event.gainDb}dB` : 0.8}[s${i}]`);
    labels.push(`[s${i}]`);
  });

  filters.push(`${labels.join("")}amix=inputs=${labels.length}:duration=first:normalize=0[a]`);
  await ffmpeg([
    ...args,
    "-filter_complex", filters.join(";"),
    "-map", "[a]",
    "-c:a", "pcm_s16le",
    fwd(outFile),
  ]);
  return events.length;
}

async function cleanVoice(project, dir, voiceFile, outFile) {
  if (!project.audio.voiceClean) {
    fs.copyFileSync(voiceFile, outFile);
    return false;
  }
  const strength = project.audio.voiceStrength ?? "normal";
  const nr = strength === "light" ? 4 : strength === "strong" ? 12 : 7;
  await ffmpeg([
    "-i", fwd(voiceFile),
    "-af",
    `highpass=f=90,` +
      `afftdn=nr=${nr}:nf=-35,` +
      `deesser=i=0.25,` +
      `acompressor=threshold=0.15:ratio=2.2:attack=8:release=150,` +
      `equalizer=f=3000:t=q:w=1.2:g=1.5,` +
      `volume=2dB,` +
      `alimiter=limit=0.9`,
    "-c:a", "pcm_s16le",
    fwd(outFile),
  ]);
  return true;
}

async function buildFinalAudio(project, dir, voiceFile, outFile, { preview }) {
  const args = ["-i", fwd(voiceFile)];
  const filters = [];
  const voiceLabel = "0:a";

  const duration = round(editedDuration(project), 3);
  const hasMusic = Boolean(project.audio.music);
  if (hasMusic) {
    const music = resolveMember(dir, project.audio.music);
    const fit = project.audio.musicFit ?? "loop";
    if (fit === "loop") {
      args.push("-stream_loop", "-1");
    }
    args.push("-i", fwd(music));

    const fade = Math.min(Number(project.audio.musicFade ?? 0.6), duration / 3);
    const gain = Number(project.audio.musicGainDb ?? -20);
    filters.push(
      `[1:a]atrim=0:${duration},asetpts=PTS-STARTPTS,volume=${gain}dB,` +
        `afade=t=in:st=0:d=${round(fade, 2)},` +
        `afade=t=out:st=${round(duration - fade, 2)}:d=${round(fade, 2)}[music]`,
    );

    const duck = project.audio.duckProfile ?? (project.audio.duck === false ? "off" : "soft");
    if (duck !== "off") {
      const threshold = duck === "hard" ? 0.09 : 0.06;
      const ratio = duck === "hard" ? 6 : 3;
      filters.push(
        `[music][${voiceLabel}]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=15:release=350[ducked]`,
      );
      filters.push(
        `[${voiceLabel}][ducked]amix=inputs=2:duration=first:normalize=0` +
          `,loudnorm=I=${project.audio.targetLufs}:TP=${project.audio.truePeak ?? -1}:LRA=11,alimiter=limit=0.9[a]`,
      );
    } else {
      filters.push(
        `[${voiceLabel}][music]amix=inputs=2:duration=first:normalize=0` +
          `,loudnorm=I=${project.audio.targetLufs}:TP=${project.audio.truePeak ?? -1}:LRA=11,alimiter=limit=0.9[a]`,
      );
    }
  } else {
    filters.push(
      `[${voiceLabel}]loudnorm=I=${project.audio.targetLufs}:TP=${project.audio.truePeak ?? -1}:LRA=11,alimiter=limit=0.9[a]`,
    );
  }

  await ffmpeg([
    ...args,
    "-filter_complex", filters.join(";"),
    "-map", "[a]",
    "-t", String(duration),
    "-c:a", "pcm_s16le",
    fwd(outFile),
  ]);
}

async function muxVideoAudio(videoFile, audioFile, outFile) {
  await ffmpeg([
    "-i", fwd(videoFile),
    "-i", fwd(audioFile),
    "-map", "0:v", "-map", "1:a",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    "-shortest",
    fwd(outFile),
  ]);
}

// One-pass render for the common case: cuts, captions and audio, no B-roll or memes.
async function renderFast({ project, dir, masterPath, info, outFile, size, fps, vargs, preview }) {
  const ranges = keptRanges(project);
  const hasText = (project.overlays ?? []).some((o) => o.kind === "text");

  let assFile = null;
  let assInfo = null;
  if (project.transcript || hasText) {
    let transcript = null;
    if (project.transcript) {
      const file = resolveMember(dir, project.transcript);
      if (fs.existsSync(file)) transcript = JSON.parse(fs.readFileSync(file, "utf8"));
    }
    const { ass, words, lines, theme } = buildAss(project, transcript, size);
    if (words || hasText) {
      assFile = path.join(projectPaths(dir).work, "captions.ass");
      fs.mkdirSync(path.dirname(assFile), { recursive: true });
      fs.writeFileSync(assFile, ass);
      assInfo = { lines, words, theme };
    }
  }

  const filters = [];
  ranges.forEach((r, i) => {
    filters.push(
      `[0:v]trim=start=${r.start}:end=${r.end},setpts=PTS-STARTPTS,fps=${fps}[t${i}]`,
    );
    filters.push(fitChain(`t${i}`, `v${i}`, size, effectiveFit(project, info, size), `ff${i}`));
  });
  let vlabel = ranges.length === 1 ? "v0" : "vcat";
  if (ranges.length > 1) {
    const labels = ranges.map((_, i) => `[v${i}]`).join("");
    filters.push(`${labels}concat=n=${ranges.length}:v=1:a=0[vcat]`);
  }
  if (assFile) {
    filters.push(`[${vlabel}]subtitles='${filterPath(assFile)}'[vout]`);
  } else {
    filters.push(`[${vlabel}]null[vout]`);
  }

  await ffmpeg([
    "-i", fwd(masterPath),
    "-filter_complex", filters.join(";"),
    "-map", "[vout]",
    "-an",
    ...vargs,
    "-r", String(fps),
    fwd(outFile),
  ]);
  return { fast: true, captions: assInfo };
}

export async function renderProject(dir, { preview = false, outro = false } = {}) {
  const project = load(dir);
  const paths = projectPaths(dir);
  fs.mkdirSync(paths.work, { recursive: true });
  fs.mkdirSync(paths.out, { recursive: true });

  const masterPath = resolveMember(dir, project.master.video);
  if (!fs.existsSync(masterPath)) throw new Error(`Master source missing: ${masterPath}`);

  const info = await probe(masterPath);
  if (!project.master.duration) project.master.duration = info.duration;

  const encoder = await pickEncoder();
  const quality = preview ? "preview" : "final";
  const vargs = videoArgs(encoder, quality);
  const factor = preview ? 0.5 : 1;
  const fullSize = { w: even(project.format.w), h: even(project.format.h) };
  const size = {
    w: even(fullSize.w * factor),
    h: even(fullSize.h * factor),
  };
  const fps = project.format.fps;
  const baseName = preview ? `${project.name}-preview` : project.name;
  const finalFile = path.join(paths.out, `${baseName}.mp4`);

  const log = [];
  const step = (label) => {
    log.push(label);
    if (!process.env.CWMEDITOR_QUIET) process.stderr.write(`  ${label}\n`);
  };

  const hasBroll = project.broll.length > 0;
  const hasImageOverlay = project.overlays.some((o) => IMAGE_OVERLAYS.has(o.kind));
  const hasZoom = project.overlays.some((o) => o.kind === "zoom");
  const fastPath = !hasBroll && !hasImageOverlay && !hasZoom && info.hasAudio;

  let overlayCount = 0;
  let captionInfo = null;

  let videoFile = null;

  if (fastPath) {
    videoFile = path.join(paths.work, "fast.mp4");
    step("single pass (cuts + captions)");
    const fastResult = await renderFast({ project, dir, masterPath, outFile: videoFile, size, fps, vargs });
    captionInfo = fastResult.captions;
  } else {
    const baseFile = path.join(paths.work, "base.mp4");
    step(`base video (${encoder})`);
    await buildBaseVideo(project, masterPath, info, baseFile, size, fps, vargs);

    step("b-roll");
    const spliced = path.join(paths.work, "spliced.mp4");
    await spliceVideo(project, dir, baseFile, spliced, size, fps, vargs);

    const zoomed = path.join(paths.work, "zoomed.mp4");
    step("zoom");
    await applyZooms(project, dir, spliced, zoomed, size, fps, vargs);

    step("overlays");
    const overlaid = path.join(paths.work, "overlaid.mp4");
    overlayCount = await applyOverlays(project, dir, zoomed, overlaid, size, fps, vargs, fullSize);

    step("captions");
    const captioned = path.join(paths.work, "captioned.mp4");
    captionInfo = await burnCaptions(project, dir, overlaid, captioned, size, vargs);
    videoFile = captioned;
  }

  const voiceFile = path.join(paths.work, "voice.wav");
  step("voice");
  await buildVoice(project, masterPath, info, voiceFile);

  const cleanFile = path.join(paths.work, "voice-clean.wav");
  step(project.audio.voiceClean ? "voice cleanup" : "voice copy");
  await cleanVoice(project, dir, voiceFile, cleanFile);

  step("sfx");
  const voiced = path.join(paths.work, "voice-sfx.wav");
  await mixSfx(project, dir, cleanFile, voiced);

  step("audio mix");
  const audioFile = path.join(paths.work, "audio.wav");
  await buildFinalAudio(project, dir, voiced, audioFile, { preview });

  step("mux");
  await muxVideoAudio(videoFile, audioFile, finalFile);

  let output = finalFile;
  if (outro && !preview) {
    const appender =
      process.env.ADD_OUTRO_PS1 ??
      "D:\\Documents\\test\\agent area\\heygen\\data\\editing\\add-outro.ps1";
    if (fs.existsSync(appender)) {
      const withOutro = finalFile.replace(/\.mp4$/i, "-outro.mp4");
      const { run } = await import("./util.mjs");
      step("outro");
      await run("pwsh", ["-NoProfile", "-File", appender, "-Input", finalFile, "-Output", withOutro]);
      output = withOutro;
    }
  }

  const result = await probe(output);
  return {
    output,
    preview,
    encoder,
    fast: fastPath,
    duration: round(result.duration, 2),
    editedDuration: round(editedDuration(project), 2),
    size: `${size.w}x${size.h}`,
    theme: project.theme ?? "neon",
    overlays: overlayCount,
    captions: captionInfo,
    steps: log,
  };
}
