# Changelog

## 0.2.0 - 2026-11-07

- Vertical and short-form project presets: `vertical`, `tiktok`, `shorts`, `reels`, `square`.
- `cover`, `blur` and `pad` fit modes for mismatched source and output aspect ratios.
- Native 9:16 sources fill the frame with no blur padding.
- Rotation-aware probing, so phone clips stored as landscape with a rotation flag render vertically.
- Portrait caption sizing, card scaling and safe bands clear of the TikTok UI.
- Text overlays use explicit ASS anchors: bottom sits at 85% on portrait and 93% on landscape.
- Avatar, chat, toast and card text are larger on portrait.
- `format` command and `cwmeditor_format` MCP tool.
- B-roll and zoom respect the fit mode; zoom no longer re-applies blur to an already composed frame.
- `qc` and `review` accept a path from the current directory or a project-relative path.
- Vertical smoke test coverage.

## 0.1.0 - 2026-11-07

- First public release: timeline as JSON, ffmpeg renderer, 30 MCP tools.
- Cuts, B-roll, captions, five themes, twelve gag types, zoom punches.
- Voice cleanup, music beds, ducking, beat detection, loudness presets, SFX.
- Edit plans with validate, diff and idempotent apply.
- QC and HTML review sheet.
