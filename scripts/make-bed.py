import math
import os
import wave

import numpy as np

SR = 44100
BPM = 100
BEAT = 60.0 / BPM
BARS = 4
BEATS = BARS * 4
DURATION = BEATS * BEAT
N = int(SR * DURATION)

mix = np.zeros(N, dtype=np.float64)


def env(t, decay):
    return np.exp(-decay * t)


def add(signal, start):
    i = int(start * SR)
    end = min(N, i + len(signal))
    mix[i:end] += signal[: end - i]


def kick(dur=0.35):
    t = np.arange(int(SR * dur)) / SR
    freq = 55 + 40 * np.exp(-18 * t)
    return 0.75 * np.sin(2 * math.pi * freq * t) * env(t, 9)


def snare(dur=0.22):
    t = np.arange(int(SR * dur)) / SR
    noise = np.random.default_rng(7).normal(0, 1, len(t))
    tone = np.sin(2 * math.pi * 190 * t)
    return (0.22 * noise + 0.12 * tone) * env(t, 22)


def hat(dur=0.07):
    t = np.arange(int(SR * dur)) / SR
    noise = np.random.default_rng(11).normal(0, 1, len(t))
    return 0.12 * noise * env(t, 60)


def bass(freq, dur):
    t = np.arange(int(SR * dur)) / SR
    wave_ = np.sin(2 * math.pi * freq * t) + 0.35 * np.sin(4 * math.pi * freq * t)
    return 0.35 * wave_ * env(t, 5)


def pad(freqs, dur):
    t = np.arange(int(SR * dur)) / SR
    signal = np.zeros(len(t))
    for f in freqs:
        signal += np.sin(2 * math.pi * f * t + 0.4) + 0.2 * np.sin(2 * math.pi * f * 1.005 * t)
    attack = np.minimum(1, t / 0.35)
    release = np.minimum(1, (dur - t) / 0.5)
    return 0.05 * signal * attack * release


notes = [55.0, 55.0, 65.41, 49.0]  # A1 A1 C2 G1
chords = [[220, 261.63, 329.63], [220, 261.63, 329.63], [261.63, 329.63, 392], [196, 246.94, 293.66]]

for bar in range(BARS):
    bar_start = bar * 4 * BEAT
    add(pad(chords[bar], 4 * BEAT), bar_start)
    for beat in range(4):
        t = bar_start + beat * BEAT
        if beat % 2 == 0:
            add(kick(), t)
        else:
            add(snare(), t)
        add(bass(notes[bar], BEAT * 0.9), t)
        add(hat(), t + BEAT * 0.5)

peak = np.max(np.abs(mix))
mix = mix / peak * 0.82
pcm = (mix * 32767).astype("<i2")

out = os.path.join("beds", "neon-100.wav")
os.makedirs("beds", exist_ok=True)
with wave.open(out, "wb") as handle:
    handle.setnchannels(1)
    handle.setsampwidth(2)
    handle.setframerate(SR)
    handle.writeframes(pcm.tobytes())

print(f"{out} {DURATION:.1f}s {BPM} BPM")
