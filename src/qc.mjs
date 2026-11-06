import path from "node:path";
import { editedDuration, resolveMember } from "./project.mjs";
import { fwd, probe, round, run } from "./util.mjs";

const ff = (args) => run("ffmpeg", ["-hide_banner", "-loglevel", "info", "-y", ...args]);

function parseBlack(stderr) {
  const hits = [];
  const re = /black_start:([\d.]+)\s+black_end:([\d.]+)/g;
  let match;
  while ((match = re.exec(stderr))) {
    hits.push({ start: round(Number(match[1]), 2), end: round(Number(match[2]), 2) });
  }
  return hits;
}

function parseSilence(stderr) {
  const hits = [];
  const starts = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  for (let i = 0; i < starts.length; i += 1) {
    hits.push({ start: round(starts[i], 2), end: round(ends[i] ?? starts[i], 2) });
  }
  return hits;
}

function parseLufs(stderr) {
  const matches = [...stderr.matchAll(/I:\s*(-?[\d.]+)\s*LUFS/g)];
  return matches.length ? round(Number(matches[matches.length - 1][1]), 1) : null;
}

export async function qc(dir, project, file) {
  const target = resolveMember(dir, file);
  const { stderr: blackErr } = await ff([
    "-i", fwd(target), "-vf", "blackdetect=d=0.5:pix_th=0.10", "-an", "-f", "null", "-",
  ]);

  const { stderr: silenceErr } = await ff([
    "-i", fwd(target), "-af", "silencedetect=n=-50dB:d=2.5", "-vn", "-f", "null", "-",
  ]);

  const { stderr: loudErr } = await ff([
    "-i", fwd(target), "-filter_complex", "ebur128", "-f", "null", "-",
  ]);

  const info = await probe(target);
  const expected = round(editedDuration(project), 2);
  const report = {
    file: target,
    duration: round(info.duration, 2),
    expected,
    durationOk: Math.abs(info.duration - expected) < 0.6,
    lufs: parseLufs(loudErr),
    blackFrames: parseBlack(blackErr),
    silences: parseSilence(silenceErr).filter((s) => s.end - s.start > 0.4),
    size: `${info.width}x${info.height}`,
    fps: round(info.fps ?? 0, 2),
  };
  report.loudnessOk = report.lufs !== null && Math.abs(report.lufs - (project.audio.targetLufs ?? -14)) < 3;
  report.ok = report.durationOk && report.blackFrames.length === 0;

  return report;
}
