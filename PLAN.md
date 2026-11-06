# CwmEditor plan

Timeline as data, ffmpeg as the renderer, agent on top. Built because the existing pipeline composes templates but cannot make editorial decisions, and because a paid NLE with MCP is a licence for one feature.

## Decisions

- **Local only.** No cloud, no credit meter, no accounts.
- **Master time vs edited time.** Everything the user says is edited time; storage is master time so cuts never shift overlays.
- **ffmpeg is the renderer.** Faster and more predictable than a full Remotion pass for cut-driven video. Remotion stays in `Video Maker` for the template videos.
- **Ops are undoable.** Each change snapshots the project, capped at 25 steps.
- **Dry run first.** `cut-preview` reports removed words and new duration before anything is written.
- **Fast preview path.** Half resolution, ultrafast preset. The agent must be able to render and look in seconds.

## Done (milestone 1 + 2)

- Project model with cuts, B-roll, overlays, music, captions
- Base video and voice rebuilt from kept ranges
- B-roll splicing with cover-fit and source in-points
- Meme and text overlays, ASS karaoke captions
- Music bed with sidechain ducking and loudnorm
- Preview and final renders, brand outro support
- QC: black frames, silences, LUFS, duration drift
- Static HTML review sheet with contact sheet and transcript
- Five caption themes with instant switching and a theme strip preview
- Gag layer: emoji stickers, chat bubbles, achievement toasts, punctuation zooms
- Pop library: keycaps, command chips, stamps, stats, chapter cards, OS notifications, checklists, progress bars
- Audio: voice cleanup chain, music beds with loop/fade/duck profiles, beat detection and snapping, platform loudness presets
- `gag-scan` transcript scanner with density rules and per-project overrides
- Single-pass render when there is no B-roll or memes, plus NVENC
- Excerpt init for fast iteration
- CLI and MCP server
- Smoke test that builds a synthetic project end to end

## Next

1. **Filler detection.** Find "um", "uh", false starts from the transcript and propose cuts as a batch, so `cut-preview` becomes `filler-scan`.
2. **Silence collapse.** Detect gaps over N seconds and offer cuts, with a minimum-pause setting so pacing stays human.
3. **Meme suggestions.** Score transcript moments for punchlines and propose meme placements from a tagged local library.
4. **B-roll matching.** Keyword to clip matching against the theme pools and a Pexels/Pixabay index.
5. **Batch mode.** Run a folder of recordings through the same edit profile.
6. **Transitions.** Crossfades and whooshes between B-roll slots, kept optional and fast.
7. **Migrate one real video** from the old pipeline and compare render time and quality.

## Open questions

- Does he want filler removal to auto-propose or only respond on request?
- Meme library ownership: build a local pack from generated reactions, or start from royalty-free clips?
- Should `caption` support two-line blocks for 9:16, or one line only?
- Do we need a proxy workflow for 4K screen recordings, or is 1080p enough?
