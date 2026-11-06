import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]]);
    return pairs;
  }, []),
);

const music = args.music ?? "beds/neon-100.wav";
const out = args.out ?? "projects/audio-lab/out/demos/05-beat-only.mp4";
const duration = Number(args.duration ?? 12);
const beatsFile = args.beats ?? "projects/audio-lab/beats.json";

let interval = 0.6;
let first = 0;
if (fs.existsSync(beatsFile)) {
  const data = JSON.parse(fs.readFileSync(beatsFile, "utf8"));
  const diffs = data.beats.slice(1).map((b, i) => b - data.beats[i]).filter((d) => d > 0.1 && d < 2);
  diffs.sort((a, b) => a - b);
  if (diffs.length) interval = diffs[Math.floor(diffs.length / 2)];
  first = data.beats[0] ?? 0;
}
const bpm = Math.round(60 / interval);

const assTime = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};

const magenta = "&H00952DFF";
const cyan = "&H00FFE035";
const dim = "&H00505050";

const events = [];
events.push(
  `Dialogue: 0,0:00:00.00,${assTime(duration)},Base,,0,0,0,,{\\an8\\pos(960,70)\\fs30\\c${cyan}\\bord0}${bpm} BPM  ·  BEAT GRID`,
);
for (let i = 0; i < 4; i += 1) {
  events.push(
    `Dialogue: 0,0:00:00.00,${assTime(duration)},Base,,0,0,0,,{\\an5\\pos(${870 + i * 60},980)\\fs72\\c${dim}\\bord0}●`,
  );
}

let beatIndex = 0;
const beatTimes = [];
for (let t = first; t < duration; t += interval) beatTimes.push(t);

for (let i = 0; i < beatTimes.length; i += 1) {
  const t = beatTimes[i];
  const until = beatTimes[i + 1] ?? duration;
  const n = (i % 4) + 1;
  const bar = Math.floor(i / 4) + 1;
  const x = 870 + ((i % 4) * 60);
  const pulseEnd = Math.min(until, t + 0.18);

  // Pulse behind the number, only at the hit.
  events.push(
    `Dialogue: 0,${assTime(t)},${assTime(pulseEnd)},Pulse,,0,0,0,,{\\an5\\pos(960,540)\\fs760\\c${magenta}\\bord0\\alpha&H82&}●`,
  );
  // Big beat number stays for the whole beat.
  events.push(
    `Dialogue: 1,${assTime(t)},${assTime(until)},Big,,0,0,0,,{\\an5\\pos(960,540)\\fs330\\c${magenta}\\bord0}${n}`,
  );
  // Active dot stays for the whole beat.
  events.push(
    `Dialogue: 2,${assTime(t)},${assTime(until)},Base,,0,0,0,,{\\an5\\pos(${x},980)\\fs96\\c${cyan}\\bord0}●`,
  );
  // Bar counter stays for the whole beat.
  events.push(
    `Dialogue: 3,${assTime(t)},${assTime(until)},Base,,0,0,0,,{\\an8\\pos(960,125)\\fs26\\c&H00FFFFFF&\\bord0}BAR ${bar}`,
  );

  beatIndex += 1;
}

const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Base,Arial,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,5,40,40,40,1
Style: Big,Arial Black,200,&H00952DFF,&H00952DFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,40,40,40,1
Style: Pulse,Arial,700,&H00952DFF,&H00952DFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,40,40,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;

const assFile = path.join(path.dirname(out), "beat-grid.ass");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(assFile, ass);

const click = `aevalsrc=if(lt(mod(t\\,${interval})\\,0.025)\\,0.35*sin(2*PI*1900*t)*exp(-180*mod(t\\,${interval}))\\,0):s=48000:d=${duration}`;

execFileSync(
  "ffmpeg",
  [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `color=c=0x0b0b12:s=1920x1080:r=30:d=${duration}`,
    "-stream_loop", "-1", "-i", music,
    "-f", "lavfi", "-i", click,
    "-filter_complex",
    `[1:a]atrim=0:${duration},volume=0.8[music];[2:a]volume=0.9[click];[music][click]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1:LRA=11[a]`,
    "-map", "0:v", "-map", "[a]",
    "-vf", `subtitles='${assFile.replace(/\\/g, "/").replace(/:/g, "\\:")}'`,
    "-t", String(duration),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    out,
  ],
  { stdio: "inherit" },
);

console.log(`${out}  ${bpm} BPM  interval ${interval.toFixed(3)}s  ${beatIndex} beats`);
