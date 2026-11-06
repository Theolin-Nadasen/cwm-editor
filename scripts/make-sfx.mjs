import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "sfx");
fs.mkdirSync(outDir, { recursive: true });

const sounds = {
  ding: {
    duration: 0.9,
    expr: "0.42*sin(2*PI*1046.5*t)*exp(-5*t)+0.24*sin(2*PI*1568*t)*exp(-7*t)",
  },
  pop: {
    duration: 0.22,
    expr: "0.5*sin(2*PI*(520+2400*t)*t)*exp(-30*t)",
  },
  error: {
    duration: 0.45,
    expr: "0.4*sin(2*PI*150*t)*exp(-7*t)+0.12*sin(2*PI*302*t)*exp(-10*t)",
  },
  click: {
    duration: 0.09,
    expr: "0.5*sin(2*PI*1900*t)*exp(-55*t)+0.2*sin(2*PI*800*t)*exp(-40*t)",
  },
  boom: {
    duration: 0.7,
    expr: "0.7*sin(2*PI*68*t)*exp(-5*t)+0.25*sin(2*PI*130*t)*exp(-9*t)",
  },
  whoosh: {
    duration: 0.45,
    expr: "0.25*sin(2*PI*(180+900*t)*t)*exp(-4*t)",
  },
};

const index = {};
for (const [name, sound] of Object.entries(sounds)) {
  const file = path.join(outDir, `${name}.wav`);
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi",
    "-i", `aevalsrc=${sound.expr}:s=48000:d=${sound.duration}`,
    "-af", "volume=0.9,afade=t=out:st=0:d=0.02:curve=nofade",
    "-c:a", "pcm_s16le",
    file,
  ]);
  index[name] = { file: `sfx/${name}.wav` };
  process.stdout.write(`ok ${name}\n`);
}

fs.writeFileSync(
  path.join(outDir, "index.json"),
  `${JSON.stringify(index, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(outDir, "README.md"),
  [
    "# Sound effects",
    "",
    "Synthesised locally with ffmpeg, so there is no licence to track.",
    "Regenerate with `node scripts/make-sfx.mjs`.",
    "",
    "| Name | Use |",
    "|---|---|",
    "| ding | achievement toast |",
    "| pop | chat bubble |",
    "| success | success beat |",
    "| error | error beat |",
  ].join("\n") + "\n",
);
