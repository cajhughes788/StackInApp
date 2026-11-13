"""Soft solo piano bed for the castle ad: an original piece in C-sharp minor
that turns to E major for the ending. Synthesized from scratch (additive
piano partials, sustain pedal, room reverb), so there's nothing to license.

    python scripts/piano.py public/audio/music.wav

Timed to the 37-second ad at 56 BPM: the melody enters at ~4 s, it swells
around 9, 14 and 19 s, brightens through 27 s, resolves to E major at ~30 s
and fades out on the cornerstone.
"""

import sys
import wave

import numpy as np

SR = 44100
LENGTH = 38.0
BEAT = 60 / 56
BAR = BEAT * 4


def hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


rng = np.random.default_rng(521)


def note(midi: int, dur: float, vel: float) -> np.ndarray:
    """One piano note held for `dur` seconds (pedal), then released."""
    f = hz(midi)
    release = 0.5
    t = np.arange(int((dur + release) * SR)) / SR
    tau0 = float(np.clip(3.6 * (261.6 / f) ** 0.55, 1.2, 9.0))
    inharm = 0.00018 * (f / 261.6) ** 0.5
    out = np.zeros_like(t)
    for n in range(1, 15):
        fn = n * f * np.sqrt(1 + inharm * n * n)
        if fn > 15000:
            break
        # Soft playing: fewer, quieter upper partials (a felt-hammer tone).
        amp = (1 / n**1.6) * np.exp(-(n - 1) * (0.42 - 0.22 * vel))
        tau = tau0 / (1 + 0.35 * (n - 1))
        env = 0.65 * np.exp(-t / (tau * 0.22)) + 0.35 * np.exp(-t / tau)
        # Two slightly detuned strings per partial.
        out += amp * env * (np.sin(2 * np.pi * fn * t) + 0.8 * np.sin(2 * np.pi * fn * 1.00035 * t + 0.7))
    attack = 1 - np.exp(-t / 0.005)
    damp = np.where(t > dur, np.exp(-(t - dur) / 0.16), 1.0)
    out *= attack * damp
    # A whisper of hammer felt.
    thump = rng.standard_normal(int(0.02 * SR)) * np.exp(-np.arange(int(0.02 * SR)) / (0.004 * SR))
    thump = np.convolve(thump, np.ones(12) / 12, mode="same")
    out[: thump.size] += thump * 0.015 * vel
    return out * vel * 0.22


# --- The piece ------------------------------------------------------------------

# Left-hand triplet voicings and bass for each chord.
CHORDS = {
    "C#m": ([56, 61, 64], [37, 49]),
    "A": ([57, 61, 64], [33, 45]),
    "F#m": ([57, 61, 66], [30, 42]),
    "G#sus": ([56, 61, 63], [32, 44]),
    "G#": ([56, 60, 63], [32, 44]),
    "B": ([54, 59, 63], [35, 47]),
    "E/G#": ([56, 59, 64], [32, 44]),
    "E": ([56, 59, 64], [40, 52]),
}

# (bar, beat, beats, chord, loudness)
HARMONY = [
    (0, 0, 4, "C#m", 0.34),
    (1, 0, 4, "A", 0.42),
    (2, 0, 4, "F#m", 0.48),
    (3, 0, 2, "G#sus", 0.52),
    (3, 2, 2, "G#", 0.55),
    (4, 0, 2, "A", 0.6),
    (4, 2, 2, "B", 0.64),
    (5, 0, 2, "E/G#", 0.66),
    (5, 2, 2, "C#m", 0.66),
    (6, 0, 2, "A", 0.7),
    (6, 2, 2, "B", 0.74),
    (7, 0, 4, "E", 0.62),
]

# Right-hand melody: (bar, beat, beats, midi)
MELODY = [
    (1, 0, 2, 76), (1, 2, 1, 73), (1, 3, 1, 76),
    (2, 0, 3, 78), (2, 3, 1, 76),
    (3, 0, 2, 73), (3, 2, 2, 72),
    (4, 0, 1, 73), (4, 1, 1, 76), (4, 2, 2, 78),
    (5, 0, 2, 80), (5, 2, 2, 76),
    (6, 0, 1, 78), (6, 1, 1, 76), (6, 2, 1, 75), (6, 3, 1, 78),
    (7, 0, 4, 80),
]
# A quiet second voice under the resolution.
HARMONY_VOICE = [(7, 0, 4, 76), (7, 0, 4, 71)]

mix = np.zeros((int(LENGTH * SR), 2))


def place(sig: np.ndarray, start: float, midi: int) -> None:
    i = int(start * SR)
    j = min(mix.shape[0], i + sig.size)
    pan = float(np.clip((midi - 60) / 36, -0.6, 0.6))
    mix[i:j, 0] += sig[: j - i] * (1 - pan) * 0.85
    mix[i:j, 1] += sig[: j - i] * (1 + pan) * 0.85


for bar, beat, beats, name, loud in HARMONY:
    start = bar * BAR + beat * BEAT
    end = start + beats * BEAT
    voicing, bass = CHORDS[name]
    for b in bass:
        place(note(b, end - start, loud * 0.9), start + 0.01, b)
    steps = int(round(beats * 3))
    for k in range(steps):
        if bar == 0 and k < 2:
            continue  # let the first bass note breathe
        midi = voicing[k % 3]
        # Natural rubato: each triplet lands a hair early or late.
        t = start + k * BEAT / 3 + rng.normal(0, 0.006)
        accent = 1.0 if k % 3 == 0 else 0.82
        place(note(midi, end - t, loud * 0.62 * accent), t, midi)

for bar, beat, beats, midi in MELODY:
    start = bar * BAR + beat * BEAT + 0.015
    place(note(midi, beats * BEAT + 0.15, 0.72), start, midi)
for bar, beat, beats, midi in HARMONY_VOICE:
    start = bar * BAR + beat * BEAT + 0.03
    place(note(midi, beats * BEAT, 0.45), start, midi)

# The last chord: E major, held into silence.
tail = 8 * BAR
for midi, vel in [(28, 0.45), (40, 0.5), (52, 0.42), (56, 0.36), (59, 0.36), (64, 0.4), (68, 0.44)]:
    place(note(midi, LENGTH - tail, vel), tail + (0.0 if midi < 50 else 0.04 * (midi - 50) / 4), midi)

# --- Room -----------------------------------------------------------------------------

def onepole(x: np.ndarray, cutoff: float) -> np.ndarray:
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(x.shape[0]):  # short IR only
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


ir_len = int(3.2 * SR)
ir_t = np.arange(ir_len) / SR
predelay = int(0.025 * SR)
wet = np.zeros_like(mix)
for ch in range(2):
    noise = rng.standard_normal(ir_len) * np.exp(-ir_t / 0.9)
    noise = onepole(noise, 3200)
    ir = np.concatenate([np.zeros(predelay), noise])
    ir /= np.sqrt(np.sum(ir**2))
    n = 1 << int(np.ceil(np.log2(mix.shape[0] + ir.size)))
    conv = np.fft.irfft(np.fft.rfft(mix[:, ch], n) * np.fft.rfft(ir, n), n)
    wet[:, ch] = conv[: mix.shape[0]]

out = mix * 0.8 + wet * 0.45

# Fade out on the cornerstone; peak at -3 dB.
t = np.arange(out.shape[0]) / SR
out *= np.clip((LENGTH - 0.3 - t) / 3.5, 0, 1)[:, None] ** 1.5
out *= np.clip(t / 0.08, 0, 1)[:, None]
out *= 0.708 / np.max(np.abs(out))

pcm = (np.clip(out, -1, 1) * 32767).astype("<i2")
with wave.open(sys.argv[1] if len(sys.argv) > 1 else "music.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", out.shape[0] / SR, "seconds")
