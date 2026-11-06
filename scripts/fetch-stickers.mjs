import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "stickers");
const base = "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets";

// name: [Fluent folder, slug]
const SET = {
  skull: ["Skull", "skull"],
  melting: ["Melting face", "melting_face"],
  "exploding-head": ["Exploding head", "exploding_head"],
  clown: ["Clown face", "clown_face"],
  fire: ["Fire", "fire"],
  eyes: ["Eyes", "eyes"],
  monocle: ["Face with monocle", "face_with_monocle"],
  thinking: ["Thinking face", "thinking_face"],
  shrug: ["Person shrugging", "person_shrugging"],
  sob: ["Loudly crying face", "loudly_crying_face"],
  joy: ["Face with tears of joy", "face_with_tears_of_joy"],
  nerd: ["Nerd face", "nerd_face"],
  robot: ["Robot", "robot"],
  check: ["Check mark button", "check_mark_button"],
  cross: ["Cross mark", "cross_mark"],
  warning: ["Warning", "warning"],
  sparkles: ["Sparkles", "sparkles"],
  brain: ["Brain", "brain"],
  money: ["Money bag", "money_bag"],
  bug: ["Bug", "bug"],
  hammer: ["Hammer", "hammer"],
  wrench: ["Wrench", "wrench"],
  hourglass: ["Hourglass not done", "hourglass_not_done"],
  crystal: ["Crystal ball", "crystal_ball"],
  bullseye: ["Bullseye", "bullseye"],
  hundred: ["Hundred points", "hundred_points"],
  facepalm: ["Person facepalming", "person_facepalming"],
  grimace: ["Grimacing face", "grimacing_face"],
  sweat: ["Downcast face with sweat", "downcast_face_with_sweat"],
  upside: ["Upside-down face", "upside_down_face"],
  alien: ["Alien", "alien"],
  ghost: ["Ghost", "ghost"],
  wave: ["Waving hand", "waving_hand"],
  "point-right": ["Backhand index pointing right", "backhand_index_pointing_right"],
  party: ["Party popper", "party_popper"],
  rocket: ["Rocket", "rocket"],
  lock: ["Locked", "locked"],
  key: ["Key", "key"],
  gear: ["Gear", "gear"],
  bomb: ["Bomb", "bomb"],
  coffee: ["Hot beverage", "hot_beverage"],
  yikes: ["Face screaming in fear", "face_screaming_in_fear"],
  neutral: ["Neutral face", "neutral_face"],
  nope: ["Face with symbols on mouth", "face_with_symbols_on_mouth"],
};

fs.mkdirSync(outDir, { recursive: true });
const index = {};

for (const [name, [folder, slug]] of Object.entries(SET)) {
  const baseUrl = `${base}/${encodeURIComponent(folder)}/3D`;
  const urls = [`${baseUrl}/${slug}_3d.png`, `${baseUrl}/${slug}_3d_default.png`];
  const file = path.join(outDir, `${name}.png`);
  let saved = false;
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(file, buffer);
      index[name] = { file: `stickers/${name}.png`, emoji: slug };
      process.stdout.write(`ok ${name}\n`);
      saved = true;
      break;
    } catch {
      // try the next variant
    }
  }
  if (!saved) process.stderr.write(`fail ${name}\n`);
}

fs.writeFileSync(path.join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
fs.writeFileSync(
  path.join(outDir, "LICENSE.txt"),
  [
    "Stickers from Microsoft Fluent Emoji (https://github.com/microsoft/fluentui-emoji).",
    "Licensed under the MIT License. See the upstream repository for the full text.",
    "Fetched by scripts/fetch-stickers.mjs.",
  ].join("\n") + "\n",
);

process.stdout.write(`\n${Object.keys(index).length} stickers in ${outDir}\n`);
