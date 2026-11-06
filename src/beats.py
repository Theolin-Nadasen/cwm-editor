import argparse
import json

import librosa
import numpy as np


def onset_score(beats, times, envelope):
    if len(beats) == 0:
        return 0.0
    indexes = np.clip(np.searchsorted(times, beats), 0, len(envelope) - 1)
    return float(np.mean(envelope[indexes]))


def low_band_envelope(y, sr):
    spectrum = np.abs(librosa.stft(y, n_fft=2048, hop_length=512))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    band = (freqs >= 40) & (freqs <= 160)
    low = spectrum[band].mean(axis=0)
    low = low / (low.max() + 1e-9)
    times = librosa.frames_to_time(np.arange(len(low)), sr=sr, hop_length=512)
    return low, times


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("src")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    y, sr = librosa.load(args.src, sr=22050, mono=True)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    beats = np.asarray(beats, dtype=float)
    bpm = float(np.atleast_1d(tempo)[0])

    # Beat trackers often lock onto the off-beat. Score the grid against the
    # low-band (kick) envelope and keep the phase with the most energy on the beat.
    envelope, times = low_band_envelope(y, sr)
    interval = float(np.median(np.diff(beats))) if len(beats) > 1 else 60.0 / bpm

    candidates = [0.0]
    for shift in (interval / 2, -interval / 2, interval / 4, -interval / 4, interval):
        candidates.append(shift)

    best_score = -1.0
    best_shift = 0.0
    for shift in candidates:
        score = onset_score(beats + shift, times, envelope)
        if score > best_score + 1e-4:
            best_score = score
            best_shift = shift

    beats = beats + best_shift
    while len(beats) and beats[0] - interval >= 0:
        beats = np.insert(beats, 0, beats[0] - interval)

    payload = {
        "source": args.src,
        "bpm": round(bpm, 2),
        "duration": round(len(y) / sr, 3),
        "interval": round(interval, 4),
        "shift": round(best_shift, 4),
        "beats": [round(float(b), 3) for b in beats if 0 <= b <= len(y) / sr],
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    print(
        f"{payload['bpm']} BPM, {len(payload['beats'])} beats, "
        f"phase shift {payload['shift']:+.3f}s -> {args.out}"
    )


if __name__ == "__main__":
    main()
