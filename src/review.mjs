import fs from "node:fs";
import path from "node:path";
import {
  editedDuration,
  masterToEdited,
  projectPaths,
  resolveMember,
  sortedCuts,
} from "./project.mjs";
import { ffmpeg, fmtTime, fwd, probe, round } from "./util.mjs";

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function contactSheet(video, outFile, duration) {
  const step = Math.max(1, Math.floor(duration / 12));
  await ffmpeg([
    "-i", fwd(video),
    "-vf", `fps=1/${step},scale=320:-2,tile=4x3`,
    "-frames:v", "1",
    "-q:v", "3",
    fwd(outFile),
  ]);
}

export function latestOutput(dir) {
  const { out } = projectPaths(dir);
  if (!fs.existsSync(out)) return null;
  const files = fs
    .readdirSync(out)
    .filter((f) => f.endsWith(".mp4"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(out, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? path.join(out, files[0].f) : null;
}

export async function buildReview(dir, project, videoFile = null) {
  const { out } = projectPaths(dir);
  const video = videoFile ?? latestOutput(dir) ?? resolveMember(dir, project.master.video);
  const info = await probe(video);
  const sheet = path.join(out, "contact.jpg");
  try {
    await contactSheet(video, sheet, info.duration);
  } catch {
    // A contact sheet is nice to have, never fatal.
  }

  let transcript = null;
  if (project.transcript) {
    const file = resolveMember(dir, project.transcript);
    if (fs.existsSync(file)) transcript = JSON.parse(fs.readFileSync(file, "utf8"));
  }

  const lines = [];
  if (transcript) {
    for (const segment of transcript.segments ?? []) {
      const start = masterToEdited(project, segment.start);
      const end = masterToEdited(project, segment.end);
      const text = escapeHtml(segment.text);
      lines.push(
        `<tr><td>${fmtTime(start)}</td><td>${round(end - start, 2)}s</td><td>${text}</td></tr>`,
      );
    }
  }

  const cuts = sortedCuts(project)
    .map(
      (c) =>
        `<tr><td>${c.id}</td><td>${fmtTime(masterToEdited(project, c.start))}</td><td>${round(
          c.end - c.start,
          2,
        )}s</td><td>${escapeHtml(c.label)}</td></tr>`,
    )
    .join("");

  const broll = project.broll
    .map(
      (b) =>
        `<tr><td>${b.id}</td><td>${fmtTime(masterToEdited(project, b.start))}</td><td>${round(
          b.end - b.start,
          2,
        )}s</td><td>${escapeHtml(path.basename(b.src))}</td></tr>`,
    )
    .join("");

  const overlays = project.overlays
    .map(
      (o) =>
        `<tr><td>${o.id}</td><td>${o.kind}</td><td>${fmtTime(masterToEdited(project, o.at))}</td><td>${
          o.dur
        }s</td><td>${escapeHtml(o.kind === "text" ? o.text : path.basename(o.src ?? ""))}</td></tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(project.name)} - cwmeditor review</title>
<style>
  :root { color-scheme: dark; --bg:#0b0b12; --panel:#14141f; --line:#26263a; --text:#e8e8f0; --dim:#9a9ab0; --accent:#35e0ff; --accent2:#ff3ea5; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 "Segoe UI", system-ui, sans-serif; }
  header { padding:24px 28px; border-bottom:1px solid var(--line); display:flex; gap:24px; align-items:baseline; flex-wrap:wrap; }
  h1 { margin:0; font-size:20px; letter-spacing:.4px; }
  .pill { border:1px solid var(--line); border-radius:999px; padding:2px 10px; color:var(--dim); font-size:12px; }
  .wrap { padding:24px 28px; display:grid; gap:24px; grid-template-columns: minmax(0,1.4fr) minmax(0,1fr); }
  @media (max-width:1100px) { .wrap { grid-template-columns: 1fr; } }
  section { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:18px 20px; }
  h2 { margin:0 0 12px; font-size:13px; text-transform:uppercase; letter-spacing:1.4px; color:var(--accent); }
  img { width:100%; border-radius:10px; display:block; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--dim); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.8px; }
  td:nth-child(1) { color:var(--accent2); font-variant-numeric: tabular-nums; white-space:nowrap; }
  .stats { display:flex; gap:18px; flex-wrap:wrap; color:var(--dim); font-size:13px; }
  .stats b { color:var(--text); font-weight:600; }
  .scroll { max-height:520px; overflow:auto; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(project.name)}</h1>
  <span class="pill">${project.format.w}x${project.format.h} @ ${project.format.fps}fps</span>
  <span class="pill">edited ${fmtTime(editedDuration(project))}</span>
  <span class="pill">${path.basename(video)}</span>
</header>
<div class="wrap">
  <div style="display:grid; gap:24px; align-content:start;">
    <section>
      <h2>Contact sheet</h2>
      ${fs.existsSync(sheet) ? `<img src="${escapeHtml(path.basename(sheet))}" alt="contact sheet">` : "<p>No contact sheet.</p>"}
    </section>
    <section class="scroll">
      <h2>Transcript</h2>
      <table><thead><tr><th>Time</th><th>Len</th><th>Text</th></tr></thead><tbody>${lines.join("") || "<tr><td colspan=3>No transcript.</td></tr>"}</tbody></table>
    </section>
  </div>
  <div style="display:grid; gap:24px; align-content:start;">
    <section>
      <h2>Summary</h2>
      <div class="stats">
        <span><b>${project.cuts.length}</b> cuts</span>
        <span><b>${project.broll.length}</b> b-roll</span>
        <span><b>${project.overlays.length}</b> overlays</span>
        <span><b>${project.captions.enabled ? "on" : "off"}</b> captions</span>
        <span><b>${info.duration.toFixed(1)}s</b> render</span>
      </div>
    </section>
    <section>
      <h2>Cuts</h2>
      <table><thead><tr><th>ID</th><th>At</th><th>Len</th><th>Label</th></tr></thead><tbody>${cuts || "<tr><td colspan=4>None.</td></tr>"}</tbody></table>
    </section>
    <section>
      <h2>B-roll</h2>
      <table><thead><tr><th>ID</th><th>At</th><th>Len</th><th>Source</th></tr></thead><tbody>${broll || "<tr><td colspan=4>None.</td></tr>"}</tbody></table>
    </section>
    <section>
      <h2>Overlays</h2>
      <table><thead><tr><th>ID</th><th>Kind</th><th>At</th><th>Len</th><th>Item</th></tr></thead><tbody>${overlays || "<tr><td colspan=5>None.</td></tr>"}</tbody></table>
    </section>
  </div>
</div>
</body>
</html>`;

  const file = path.join(out, "review.html");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(file, html);
  return { file, video };
}
