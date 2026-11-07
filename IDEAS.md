# Ideas parking lot

Visual gags and other concepts we like but are not building yet. Move an item out of here when it gets built.

## On-screen visuals

- **Arrow callout**: animated arrow that draws toward a UI element, then holds
- **Magnifier lens**: circular zoom bubble over a detail, with a rim and slight drop shadow
- **Label tag**: small name tag pinned next to something ("this line", "the fix")
- **XP bar**: fills across the whole video as steps complete, level-up pop at the end
- **Countdown timer**: counts down during a challenge, turns red near zero
- **Poll card**: question with two or three bars that animate to percentages, comment bait
- **Comment card**: a real comment on screen, then the reply
- **Quote card**: a sentence pulled out of the transcript in big type
- **Sub milestone**: confetti burst plus a counter
- **Lower third**: name or tool name that slides in from the bottom
- **Recap card**: three bullets in the final 20 seconds
- **End screen card**: next video teaser with a thumbnail
- **Confetti burst**: particle pop on wins
- **Sound waveform**: bars that pop while a sound plays
- **Code diff card**: red lines out, green lines in

## Audio

- **Voice cleanup chain**: denoise, de-hum, de-ess, compress, EQ, limit
- **Music bed library**: mood tags, BPM, auto-loop to video length, fades
- **Beat sync**: detect BPM and snap cuts, zooms and gags to the beat
- **SFX rotation**: several variants per gag so the same pop does not repeat
- **Transition sound design**: whoosh into scene changes, riser before reveals
- **Platform loudness presets**: YouTube, TikTok, Instagram, podcast targets
- **Audio QC**: clipping, noise floor, DC offset, LUFS, true peak
- **Voice pickups**: patch a bad line with cloned TTS instead of re-recording
- **Room tone**: fill dead air so silence does not sound like a dropout

## Other

- **Caption-safe lower third**: a dedicated slot above the captions for CTAs, so text never lands on the subtitle line
- **Overlay collision solver**: detect two gags in the same band and offset or delay one
- **Transcript word fixer**: `transcript-fix --from thio --to Theo`, applied to words and segment text
- **Auto-format init**: pick vertical or landscape from the probed display aspect when no preset is passed
- **Rotation warning**: flag non-zero rotation metadata at init so a portrait clip is never treated as landscape
- **Screen deskew**: perspective-correct a phone recording of a laptop screen before cropping the keyboard out
- **Auto-emit gags from the scanner**: keycaps on "shortcut", command card on shell commands, stamp on "broken"
- **Cursor logger**: record mouse position so zooms can target the real cursor
- **Batch mode**: run a folder of recordings through one edit profile
- **Preset profiles**: "tutorial", "devlog", "short" bundles of theme + gags + audio
