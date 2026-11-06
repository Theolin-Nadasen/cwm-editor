import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = path.join(root, "tests", "tmp");
const cli = path.join(root, "cwmeditor.mjs");

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const master = path.join(tmp, "master.mp4");
const broll = path.join(tmp, "broll.mp4");
const meme = path.join(tmp, "meme.png");

execFileSync("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=12",
  "-f", "lavfi", "-i", "sine=frequency=440:duration=12",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
  master,
]);

execFileSync("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=6",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
  broll,
]);

execFileSync("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi", "-i", "color=c=0xff2d95:s=300x300:d=1",
  "-frames:v", "1",
  meme,
]);

function cwmeditor(args) {
  const out = execFileSync("node", [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CWMEDITOR_QUIET: "1" },
  });
  return JSON.parse(out);
}

const project = path.join(tmp, "project");

const steps = [];
steps.push(cwmeditor(["init", project, "--source", master, "--name", "smoke"]));
steps.push(cwmeditor(["status", project]));
steps.push(cwmeditor(["cut", project, "--from", "3", "--to", "4", "--label", "filler"]));
steps.push(cwmeditor(["broll", project, "--from", "5", "--to", "7", "--src", broll]));
steps.push(cwmeditor(["meme", project, "--at", "2", "--src", meme, "--dur", "1", "--scale", "0.35"]));
steps.push(cwmeditor(["text", project, "--at", "8", "--text", "hello cwmeditor"]));
steps.push(cwmeditor(["preview", project]));

const output = path.join(project, "out", "smoke-preview.mp4");
if (!fs.existsSync(output)) throw new Error("Preview render missing");

// Caption pass: a fake transcript proves karaoke + cut remapping without needing TTS.
const transcript = path.join(tmp, "transcript.json");
const words = [];
for (let i = 0; i < 22; i += 1) {
  words.push({
    word: ["we", "build", "things", "here", "and", "the", "cut", "removes", "this", "part"][i % 10],
    start: i * 0.5,
    end: i * 0.5 + 0.4,
    probability: 1,
  });
}
fs.writeFileSync(
  transcript,
  JSON.stringify({
    source: "master.mp4",
    duration: 12,
    language: "en",
    text: words.map((w) => w.word).join(" "),
    segments: [{ id: 0, start: 0, end: 11, text: "test", words }],
  }),
);
steps.push(cwmeditor(["use-transcript", project, "--file", transcript]));
steps.push(cwmeditor(["preview", project]));

const ass = fs.readFileSync(path.join(project, "work", "captions.ass"), "utf8");
if (!ass.includes("MarginV, Effect, Text")) throw new Error("ASS event format is malformed");
if (!ass.includes("\\k")) throw new Error("ASS has no karaoke timing");

const qc = cwmeditor(["qc", project, "--file", output]);
const review = cwmeditor(["review", project, "--file", output]);

console.log(JSON.stringify({ steps, qc, review }, null, 2));

if (Math.abs(qc.duration - 11) > 0.6) {
  throw new Error(`Duration drift: expected ~11s, got ${qc.duration}s`);
}
if (qc.blackFrames.length) {
  throw new Error(`Black frames detected: ${JSON.stringify(qc.blackFrames)}`);
}
if (!fs.existsSync(path.join(project, "out", "review.html"))) {
  throw new Error("Review sheet missing");
}

// Fast path: no b-roll, no memes, should collapse to a single ffmpeg pass.
const fastProject = path.join(tmp, "fast");
cwmeditor(["init", fastProject, "--source", master, "--name", "fast"]);
cwmeditor(["use-transcript", fastProject, "--file", transcript]);
cwmeditor(["theme", fastProject, "--name", "clean"]);
const fast = cwmeditor(["preview", fastProject]);
if (!fast.fast) throw new Error("Expected the single-pass fast path");
if (!fs.existsSync(fast.output)) throw new Error("Fast path output missing");

console.log("\nSMOKE OK");
