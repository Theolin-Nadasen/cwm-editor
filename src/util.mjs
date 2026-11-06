import { spawn } from "node:child_process";
import path from "node:path";

export function run(cmd, args, { cwd, stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
      if (stream) process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      if (stream) process.stderr.write(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(cmd)} exited with ${code}\n${stderr.slice(-4000)}`));
    });
  });
}

export function ffmpeg(args, opts) {
  return run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], opts);
}

export function ffprobe(args) {
  return run("ffprobe", ["-v", "error", ...args]);
}

export const fwd = (p) => path.resolve(p).replace(/\\/g, "/");

// Escape a path for use inside an ffmpeg filter argument (e.g. subtitles=...).
export const filterPath = (p) => fwd(p).replace(/:/g, "\\:");

export function parseFps(rate) {
  if (!rate) return null;
  const [a, b] = String(rate).split("/").map(Number);
  return b ? a / b : a;
}

export async function probe(file) {
  const { stdout } = await ffprobe([
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    fwd(file),
  ]);
  const data = JSON.parse(stdout);
  const video = data.streams.find((s) => s.codec_type === "video");
  const audio = data.streams.find((s) => s.codec_type === "audio");
  return {
    duration: Number(data.format?.duration ?? video?.duration ?? 0),
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: parseFps(video?.r_frame_rate),
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    videoCodec: video?.codec_name ?? null,
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Accepts "12.5", "1:02.5" or "0:01:02.50".
export function parseTime(value) {
  if (typeof value === "number") return value;
  const parts = String(value).trim().split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) throw new Error(`Bad time: ${value}`);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function fmtTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${sec.toFixed(2).padStart(5, "0")}`;
}

export function assTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export function round(value, places = 3) {
  const p = 10 ** places;
  return Math.round(value * p) / p;
}

let encoderCache = null;

// Uses the GPU when the build of ffmpeg supports NVENC. Override with CWMEDITOR_ENCODER=x264.
export async function pickEncoder() {
  if (encoderCache) return encoderCache;
  const preferred = (process.env.CWMEDITOR_ENCODER ?? "auto").toLowerCase();
  if (preferred !== "auto") {
    encoderCache = preferred;
    return encoderCache;
  }
  try {
    const { stdout } = await run("ffmpeg", ["-hide_banner", "-encoders"]);
    encoderCache = /h264_nvenc/.test(stdout) ? "nvenc" : "x264";
  } catch {
    encoderCache = "x264";
  }
  return encoderCache;
}

export function videoArgs(encoder, quality) {
  if (encoder === "nvenc") {
    const preset = quality === "preview" ? "p1" : "p5";
    const cq = quality === "preview" ? 30 : 21;
    return [
      "-c:v", "h264_nvenc",
      "-preset", preset,
      "-rc", "vbr",
      "-cq", String(cq),
      "-b:v", "0",
      "-pix_fmt", "yuv420p",
    ];
  }
  const preset = quality === "preview" ? "ultrafast" : "veryfast";
  const crf = quality === "preview" ? 28 : 18;
  return ["-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p"];
}
