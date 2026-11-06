import fs from "node:fs";
import path from "node:path";
import { buildAss } from "./captions.mjs";
import { projectPaths, resolveMember } from "./project.mjs";
import { THEMES, themeNames } from "./themes.mjs";
import { ffmpeg, filterPath, fwd, round } from "./util.mjs";

// Renders one frame per theme, then tiles them into a single strip for comparison.
export async function buildThemeStrip(dir, project, at = 6) {
  const out = path.join(projectPaths(dir).out, "themes");
  fs.mkdirSync(out, { recursive: true });

  let transcript = null;
  if (project.transcript) {
    const file = resolveMember(dir, project.transcript);
    if (fs.existsSync(file)) transcript = JSON.parse(fs.readFileSync(file, "utf8"));
  }

  const video = resolveMember(dir, project.master.video);
  const size = { w: project.format.w, h: project.format.h };
  const names = themeNames();
  const frames = [];

  for (const name of names) {
    const themed = { ...project, theme: name };
    const { ass } = buildAss(themed, transcript, size);
    const assFile = path.join(out, `${name}.ass`);
    fs.writeFileSync(assFile, ass);
    const frame = path.join(out, `${name}.png`);
    await ffmpeg([
      "-copyts",
      "-ss", String(round(at, 3)),
      "-i", fwd(video),
      "-vf", `subtitles='${filterPath(assFile)}',scale=768:-2`,
      "-frames:v", "1",
      "-update", "1",
      fwd(frame),
    ]);
    frames.push(frame);
  }

  const strip = path.join(out, "strip.png");
  const inputs = frames.flatMap((f) => ["-i", fwd(f)]);
  await ffmpeg([
    ...inputs,
    "-filter_complex", `${names.map((_, i) => `[${i}:v]`).join("")}hstack=inputs=${names.length}[v]`,
    "-map", "[v]",
    "-frames:v", "1",
    "-update", "1",
    fwd(strip),
  ]);

  return { strip, frames, themes: Object.fromEntries(names.map((n) => [n, THEMES[n].label])) };
}
