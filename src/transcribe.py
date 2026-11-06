"""Word-level transcription for cwmeditor.

Prefers faster-whisper (4-8x faster than openai-whisper, same accuracy),
falls back to openai-whisper if it is the only one installed.
"""
import argparse
import json
import sys


def _normalise(word):
    return word.strip()


def with_faster_whisper(path, size, device, language):
    from faster_whisper import WhisperModel

    attempts = []
    if device in ("auto", "cuda"):
        attempts.append(("cuda", "float32"))
    attempts.append(("cpu", "int8"))

    last_error = None
    for dev, compute in attempts:
        try:
            model = WhisperModel(size, device=dev, compute_type=compute)
            segments, info = model.transcribe(
                path,
                word_timestamps=True,
                vad_filter=True,
                language=None if language in (None, "", "auto") else language,
            )
            out = []
            text_parts = []
            for index, seg in enumerate(segments):
                words = [
                    {
                        "word": _normalise(w.word),
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                        "probability": round(getattr(w, "probability", 1.0), 4),
                    }
                    for w in (seg.words or [])
                    if _normalise(w.word)
                ]
                out.append(
                    {
                        "id": index,
                        "start": round(seg.start, 3),
                        "end": round(seg.end, 3),
                        "text": seg.text.strip(),
                        "words": words,
                    }
                )
                text_parts.append(seg.text.strip())
            return out, " ".join(text_parts), info.language, info.duration, f"faster-whisper/{dev}/{compute}"
        except Exception as error:  # noqa: BLE001 - fall through to the next device
            last_error = error
            print(f"faster-whisper {dev}/{compute} failed: {error}", file=sys.stderr)
    raise last_error


def with_openai_whisper(path, size, language):
    import whisper

    model = whisper.load_model(size, device="cpu")
    result = model.transcribe(
        path,
        word_timestamps=True,
        verbose=False,
        language=None if language in (None, "", "auto") else language,
    )
    out = []
    for index, seg in enumerate(result.get("segments", [])):
        words = [
            {
                "word": _normalise(w.get("word", "")),
                "start": round(w.get("start", 0.0), 3),
                "end": round(w.get("end", 0.0), 3),
                "probability": round(w.get("probability", 1.0), 4),
            }
            for w in seg.get("words", [])
            if _normalise(w.get("word", ""))
        ]
        out.append(
            {
                "id": index,
                "start": round(seg.get("start", 0.0), 3),
                "end": round(seg.get("end", 0.0), 3),
                "text": seg.get("text", "").strip(),
                "words": words,
            }
        )
    return out, result.get("text", "").strip(), result.get("language", "en"), None, "openai-whisper/cpu"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--out", required=True)
    parser.add_argument("--model", default="base")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--language", default="en")
    args = parser.parse_args()

    try:
        segments, text, language, duration, backend = with_faster_whisper(
            args.audio, args.model, args.device, args.language
        )
    except ImportError:
        segments, text, language, duration, backend = with_openai_whisper(
            args.audio, args.model, args.language
        )

    if duration is None:
        duration = segments[-1]["end"] if segments else 0.0

    payload = {
        "source": args.audio,
        "duration": duration,
        "language": language,
        "text": text,
        "segments": segments,
        "backend": backend,
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    print(
        f"{backend}: {len(segments)} segments, "
        f"{sum(len(s['words']) for s in segments)} words -> {args.out}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
