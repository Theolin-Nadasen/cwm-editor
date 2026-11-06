import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveMember, save } from "./project.mjs";
import { run } from "./util.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function transcribe(dir, project, { model = "base", device = "auto" } = {}) {
  const master = resolveMember(dir, project.master.audio ?? project.master.video);
  const outFile = path.join(dir, "transcript.json");
  const script = path.join(here, "transcribe.py");

  const { stderr } = await run(
    "python",
    [script, master, "--out", outFile, "--model", model, "--device", device],
    { stream: !process.env.CWMEDITOR_QUIET },
  );

  project.transcript = "transcript.json";
  save(dir, project);
  return { transcript: outFile, backend: stderr.trim().split("\n").pop() ?? "" };
}
