"""Cinematic score for the castle ad, built like the castle: one low note for the
foundation, then a new layer for every part that goes up, full orchestra when
it turns real, and a calm major chord on the cornerstone.

    python scripts/score.py public/audio/score.wav

Every hit is placed on the ad's frames (30 fps, see castle3/TextAd.tsx):
foundation sets 4.03 s, Booking tower 14.67 s, Invoices tower 19.53 s,
Payments tower 23.73 s, QR scan 26.40 s, QR lands 29.07 s, castle turns real
29.9-33 s, light white-out 35.2 s, cornerstone 35.3 s. Synthesized from
scratch, so there's nothing to license.
"""

import sys
import wave

import numpy as np

SR = 44100
LENGTH = 39.2  # the piece is written on this timeline...

# ...then every event is moved onto the ad's current cut: (written time, ad time) in seconds.
WARP = [(0, 0), (4.03, 4.03), (14.67, 14.87), (19.53, 18.87), (23.73, 22.27), (26.40, 24.47), (29.07, 26.67),
        (29.9, 27.53), (33.5, 32.87), (35.2, 34.0), (35.3, 34.13), (39.2, 39.0)]


def W(t: float) -> float:
    return float(np.interp(t, [a for a, _ in WARP], [b for _, b in WARP]))


OUT_LENGTH = W(LENGTH)
N = int(OUT_LENGTH * SR)
BPM = 92
BEAT = 60 / BPM
EIGHTH = BEAT / 2
rng = np.random.default_rng(521)

HIT = {
    "foundation": 4.03,
    "booking": 14.67,
    "invoices": 19.53,
    "payments": 23.73,
    "scan": 26.40,
    "land": 29.07,
    "real": 29.9,
    "riser": 33.5,
    "white": 35.2,
    "stone": 35.3,
}


def hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def t_of(n: int) -> np.ndarray:
    return np.arange(n) / SR


def env_adsr(n: int, a: float, d: float, s: float, r: float, hold: float) -> np.ndarray:
    t = t_of(n)
    e = np.where(t < a, t / max(a, 1e-4), 1.0)
    e = np.where((t >= a) & (t < a + d), 1 - (1 - s) * (t - a) / max(d, 1e-4), e)
    e = np.where((t >= a + d) & (t < hold), s, e)
    e = np.where(t >= hold, s * np.exp(-(t - hold) / max(r, 1e-4)), e)
    return e * np.minimum(1, t / 0.003 + 0.0)


def additive(m: float, dur: float, *, harmonics: int, tilt: float, voices: int, cents: float, a: float, d: float, s: float, r: float,
             vib: float = 0.0, odd: float = 1.0, bright_attack: float = 0.0) -> np.ndarray:
    """A detuned ensemble of band-limited tones (strings, brass, choir sources)."""
    n = int((dur + r * 4) * SR)
    t = t_of(n)
    f0 = hz(m)
    e = env_adsr(n, a, d, s, r, dur)
    out = np.zeros(n)
    vibrato = 1 + vib * np.sin(2 * np.pi * 5.2 * t + rng.uniform(0, 6)) * np.clip(t / 0.4, 0, 1)
    for v in range(voices):
        det = 2 ** ((rng.uniform(-cents, cents)) / 1200)
        f = f0 * det
        phase_t = np.cumsum(vibrato) / SR * f
        for k in range(1, harmonics + 1):
            if f * k > 14000:
                break
            amp = k ** -tilt * (odd if k % 2 == 0 else 1.0)
            if bright_attack:
                # Brass: the upper harmonics bloom with the attack.
                amp = amp * np.exp(-(k - 1) / (1.5 + bright_attack * np.clip(t / (a + 0.05), 0, 1)))
            out += amp * np.sin(2 * np.pi * k * phase_t + rng.uniform(0, 6.28))
    return out * e / (voices * 1.6)


# --- Buses -----------------------------------------------------------------------------
BUS = {name: np.zeros(N) for name in ["low", "strings", "ostinato", "brass", "choir", "shimmer", "drums", "fx", "piano"]}


def put(bus: str, sig: np.ndarray, at: float, gain: float = 1.0, warp: bool = True) -> None:
    i = int((W(at) if warp else at) * SR)
    if i >= N:
        return
    j = min(N, i + sig.size)
    BUS[bus][i:j] += sig[: j - i] * gain


# --- Harmony -----------------------------------------------------------------------------
# D minor, rising to D major at the end. Chord tones as MIDI notes.
CH = {
    "Dm": [50, 53, 57],
    "Bb": [46, 50, 53],
    "F": [53, 57, 60],
    "C": [48, 52, 55],
    "Gm": [55, 58, 62],
    "A": [57, 61, 64],
    "D": [50, 54, 57],
}
BASS = {"Dm": 38, "Bb": 34, "F": 41, "C": 36, "Gm": 43, "A": 33, "D": 38}

# (start, end, chord)
PROG = [
    (4.03, 6.6, "Dm"), (6.6, 9.2, "Bb"),
    (9.2, 11.8, "F"), (11.8, 14.67, "C"),
    (14.67, 17.1, "Dm"), (17.1, 19.53, "Bb"),
    (19.53, 21.5, "Gm"), (21.5, 23.73, "A"),
    (23.73, 26.4, "A"),
    (26.4, 27.7, "Bb"), (27.7, 29.07, "C"),
    (29.07, 30.4, "Dm"), (30.4, 31.7, "Bb"), (31.7, 33.0, "F"), (33.0, 35.2, "C"),
]


def layer_level(points: list[tuple[float, float]]) -> np.ndarray:
    xs, ys = zip(*points)
    return np.interp(t_of(N), [W(x) for x in xs], ys)


# --- 0–4 s: the foundation note, a pad, the pour's shimmer, the boom ----------------------
put("low", additive(26, 4.4, harmonics=10, tilt=1.4, voices=2, cents=4, a=1.2, d=0.5, s=0.9, r=1.0), 0.0, 0.9)
for m in [50, 57, 62]:
    put("choir", additive(m, 4.2, harmonics=18, tilt=1.1, voices=4, cents=9, a=2.2, d=0.4, s=0.85, r=1.2), 0.2, 0.35)
for m, at in [(86, 1.2), (93, 1.6), (89, 2.0), (98, 2.5), (91, 3.0)]:
    n = int(2.2 * SR)
    t = t_of(n)
    tone = np.sin(2 * np.pi * hz(m) * t) * (1 + 0.5 * np.sin(2 * np.pi * 7 * t)) * np.clip(t / 0.3, 0, 1) * np.exp(-t / 1.0)
    put("shimmer", tone, at, 0.18)


def boom(at: float, gain: float, low: float = 32.0) -> None:
    n = int(2.2 * SR)
    t = t_of(n)
    f = low + 50 * np.exp(-t / 0.08)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.7)
    noise = rng.standard_normal(n) * np.exp(-t / 0.05) * 0.25
    put("drums", s + noise, at, gain)


def timpani(at: float, m: float, gain: float) -> None:
    n = int(2.5 * SR)
    t = t_of(n)
    f = hz(m)
    s = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / dcy) for r, a, dcy in [(1, 1.0, 0.9), (1.5, 0.5, 0.5), (1.99, 0.3, 0.4), (2.44, 0.15, 0.3)])
    s = s + rng.standard_normal(n) * np.exp(-t / 0.02) * 0.3
    put("drums", s, at, gain)


def taiko(at: float, gain: float) -> None:
    n = int(1.2 * SR)
    t = t_of(n)
    f = 52 + 90 * np.exp(-t / 0.03)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.35)
    s += np.convolve(rng.standard_normal(n), np.ones(30) / 30, mode="same") * np.exp(-t / 0.03) * 0.6
    put("drums", s, at, gain)


def snare(at: float, gain: float) -> None:
    n = int(0.3 * SR)
    t = t_of(n)
    s = rng.standard_normal(n) * np.exp(-t / 0.07) + np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) * 0.4
    put("drums", s, at, gain)


def cymbal(at: float, gain: float) -> None:
    n = int(3.5 * SR)
    t = t_of(n)
    s = np.diff(rng.standard_normal(n + 1)) * np.exp(-t / 1.3) * np.clip(t / 0.004, 0, 1)
    put("fx", s, at, gain)


boom(HIT["foundation"], 1.0)
timpani(HIT["foundation"], 38, 0.6)

# --- 4–35 s: the build ---------------------------------------------------------------------
for start, end, name in PROG:
    ws, we = W(start), W(end)
    dur = we - ws + 0.4  # overlap into the next chord
    # Low strings and bass: the foundation of the music, from 4 s on.
    put("low", additive(BASS[name] - 12, dur, harmonics=12, tilt=1.3, voices=3, cents=5, a=0.25, d=0.3, s=0.85, r=0.5), ws, 0.75, warp=False)
    put("low", additive(BASS[name], dur, harmonics=14, tilt=1.2, voices=3, cents=7, a=0.3, d=0.3, s=0.8, r=0.5), ws, 0.45, warp=False)
    # Low brass pad.
    for m in CH[name]:
        put("brass", additive(m - 12, dur, harmonics=10, tilt=1.5, voices=3, cents=6, a=0.5, d=0.4, s=0.75, r=0.6), ws, 0.26, warp=False)
    # Upper strings and choir join from the Invoices tower on.
    if start >= 16.0:
        for m in CH[name]:
            put("strings", additive(m + 12, dur, harmonics=14, tilt=1.3, voices=6, cents=9, a=0.6, d=0.3, s=0.9, r=0.7, vib=0.004), ws, 0.22, warp=False)
            put("choir", additive(m, dur, harmonics=12, tilt=1.35, voices=5, cents=10, a=0.7, d=0.3, s=0.9, r=0.8, vib=0.003), ws, 0.2, warp=False)

# String ostinato: eighth notes on the chord, an octave up for the climb.
for start, end, name in PROG:
    k = 0
    t = start
    tones = CH[name]
    pattern = [tones[0], tones[1], tones[2], tones[1] + 12 if False else tones[2] + 0, tones[0] + 12, tones[2], tones[1], tones[2]]
    while t < end - 0.05:
        m = pattern[k % len(pattern)] + (12 if t >= 21.5 else 0)
        accent = 1.0 if k % 2 == 0 else 0.7
        put("ostinato", additive(m - 12, EIGHTH * 0.7, harmonics=10, tilt=1.45, voices=3, cents=8, a=0.02, d=0.1, s=0.5, r=0.12), t, 0.3 * accent)
        k += 1
        t += EIGHTH

# Horn melody (9–16 s), and the main theme on brass at the peak (29–35 s). Original lines.
HORN = [(9.2, 1.3, 62), (10.5, 0.65, 65), (11.15, 0.65, 64), (11.8, 1.95, 60), (13.75, 0.92, 62),
        (14.67, 1.3, 65), (15.97, 0.65, 69), (16.62, 1.3, 67), (17.92, 1.6, 65)]
for at, dur, m in HORN:
    put("brass", additive(m, dur, harmonics=10, tilt=1.4, voices=3, cents=5, a=0.15, d=0.3, s=0.8, r=0.4, vib=0.005), at, 0.4)
THEME = [(29.07, 0.65, 69), (29.72, 0.65, 74), (30.4, 1.3, 72), (31.7, 0.65, 69), (32.35, 0.65, 72),
         (33.0, 1.3, 76), (34.3, 0.9, 74)]
for at, dur, m in THEME:
    put("strings", additive(m, dur + 0.15, harmonics=12, tilt=1.3, voices=6, cents=8, a=0.18, d=0.2, s=0.9, r=0.5, vib=0.006), at, 0.32)
    put("brass", additive(m - 12, dur, harmonics=8, tilt=1.6, voices=3, cents=6, a=0.15, d=0.2, s=0.85, r=0.4), at, 0.22)

# Drums: a soft taiko pulse from 9 s, every beat at the peak.
t = 9.2
while t < 35.1:
    if 25.0 <= t < 26.4:
        t += BEAT
        continue
    if round((t - 9.2) / BEAT) % 2 == 0:
        taiko(t, 0.45 if t < 21.5 else 0.55)
    t += BEAT
# A timpani roll swelling into the scan (21.5–26.4 s), on A.
t = 21.5
while t < HIT["scan"] - 0.05:
    timpani(t, 45, 0.05 + 0.2 * ((t - 21.5) / (HIT["scan"] - 21.5)) ** 2)
    t += 0.11 if t < 24.5 else 0.07

# Tower hits.
for key, g in [("booking", 0.7), ("invoices", 0.8), ("payments", 0.6)]:
    timpani(HIT[key], 38, g)
    boom(HIT[key], 0.45)
# The scan: the biggest hit so far, with a full stab.
boom(HIT["scan"], 0.7)
timpani(HIT["scan"], 45, 0.85)
for m in [45, 57, 61, 64, 69, 73, 76]:
    put("strings", additive(m, 2.2, harmonics=12, tilt=1.3, voices=6, cents=8, a=0.07, d=0.5, s=0.75, r=1.2, vib=0.005), HIT["scan"], 0.2)
for m in [57, 61, 64, 69]:
    put("choir", additive(m, 2.2, harmonics=12, tilt=1.35, voices=5, cents=10, a=0.12, d=0.5, s=0.8, r=1.2), HIT["scan"], 0.16)
for m in [45, 52, 57]:
    put("brass", additive(m, 2.0, harmonics=8, tilt=1.6, voices=3, cents=6, a=0.1, d=0.5, s=0.75, r=1.0), HIT["scan"], 0.28)
# The QR drops into the foundation: a downward whoosh into a boom.
n = int(0.7 * SR)
tw = t_of(n)
whoosh = np.convolve(rng.standard_normal(n), np.ones(40) / 40, mode="same") * np.sin(np.pi * tw / 0.7) ** 2
put("fx", whoosh, HIT["land"] - 0.7, 0.3)
boom(HIT["land"], 0.7, low=30)

# The light: a riser that climbs to the white-out, then a cut.
n = int((W(HIT["white"]) - W(HIT["riser"])) * SR)
tr = t_of(n)
p = tr / tr[-1]
riser_noise = np.diff(rng.standard_normal(n + 1)) * p**2
f = 220 * 2 ** (p * 2.5)
riser_tone = sum(np.sin(2 * np.pi * np.cumsum(f * r) / SR) for r in [1, 1.5, 2, 3]) * p**2 * 0.25
put("fx", riser_noise * 0.6 + riser_tone, W(HIT["riser"]), 0.6, warp=False)

# --- 35.3 s: the cornerstone, D major, calm --------------------------------------------------
for m in [38, 50, 54, 57, 62, 66]:
    put("strings", additive(m, 3.6, harmonics=18, tilt=1.15, voices=5, cents=9, a=0.4, d=0.4, s=0.8, r=1.5, vib=0.003), HIT["stone"], 0.28)
for m in [62, 66, 69]:
    put("choir", additive(m, 3.6, harmonics=16, tilt=1.15, voices=4, cents=10, a=0.6, d=0.4, s=0.8, r=1.6), HIT["stone"] + 0.1, 0.16)


def piano(m: int, dur: float, vel: float) -> np.ndarray:
    f = hz(m)
    n = int((dur + 1.5) * SR)
    t = t_of(n)
    out = np.zeros(n)
    tau0 = float(np.clip(3.6 * (261.6 / f) ** 0.55, 1.2, 9.0))
    for k in range(1, 12):
        amp = k**-1.6 * np.exp(-(k - 1) * 0.3)
        tau = tau0 / (1 + 0.35 * (k - 1))
        out += amp * (0.65 * np.exp(-t / (tau * 0.22)) + 0.35 * np.exp(-t / tau)) * np.sin(2 * np.pi * f * k * np.sqrt(1 + 0.0002 * k * k) * t)
    return out * (1 - np.exp(-t / 0.004)) * vel * 0.25


for i, m in enumerate([74, 78, 81, 86]):
    put("piano", piano(m, 3.0, 0.7), HIT["stone"] + 0.25 + i * 0.42, 1.0)

# A harp sweep up the A major chord, landing on the scan.
SWEEP = [57, 61, 64, 69, 73, 76, 81, 85, 88, 93]
for i, m in enumerate(SWEEP):
    put("piano", piano(m, 1.6, 0.4 + 0.25 * i / len(SWEEP)), W(HIT["scan"]) - 0.36 + i * 0.04, 0.8, warp=False)

# The castle's lights come on (ad time 30.6 s): a soft bell chord in F and a string bloom.
LIGHTS = 918 / 30
for i, m in enumerate([65, 72, 77, 81, 84]):
    put("piano", piano(m, 2.5, 0.55), LIGHTS + i * 0.015, 0.7, warp=False)
for m in [53, 60, 65, 69, 72]:
    put("strings", additive(m, 1.6, harmonics=12, tilt=1.3, voices=6, cents=8, a=0.05, d=0.5, s=0.6, r=1.0, vib=0.004), LIGHTS, 0.12, warp=False)

# --- Mix: each layer comes in as the castle grows ---------------------------------------------
LEVELS = {
    "low": [(0, 1), (25.0, 1), (25.3, 0.6), (26.4, 1), (HIT["white"] - 0.02, 1), (HIT["white"], 0), (LENGTH, 0)],
    "choir": [(0, 1), (4, 0.6), (16, 1), (25.0, 1), (25.3, 0.5), (26.4, 0.9), (29.07, 0.9), (HIT["white"] - 0.02, 1.0), (HIT["white"], 0), (HIT["stone"], 1), (LENGTH, 1)],
    "strings": [(0, 1), (25.0, 1), (25.3, 0.5), (26.4, 1), (29.07, 1.0), (HIT["white"] - 0.02, 1.05), (HIT["white"], 0), (HIT["stone"], 1), (LENGTH, 1)],
    "ostinato": [(0, 0), (4.03, 0.7), (9.2, 0.85), (21.5, 1.0), (25.0, 1), (25.3, 0.2), (26.4, 0.8), (29.07, 0.8), (HIT["white"] - 0.02, 0.9), (HIT["white"], 0), (LENGTH, 0)],
    "brass": [(0, 1), (25.0, 1), (25.3, 0.4), (26.4, 0.8), (29.07, 0.8), (HIT["white"] - 0.02, 0.9), (HIT["white"], 0), (LENGTH, 0)],
    "drums": [(0, 1), (LENGTH, 1)],
    "shimmer": [(0, 1), (LENGTH, 1)],
    "fx": [(0, 1), (HIT["white"] - 0.01, 1), (HIT["white"] + 0.02, 0), (LENGTH, 0)],
    "piano": [(0, 1), (LENGTH, 1)],
}
for name, pts in LEVELS.items():
    BUS[name] *= layer_level(pts)


def shape(x: np.ndarray, peaks: list[tuple[float, float, float]], lowpass: float, highpass: float = 30.0) -> np.ndarray:
    """Frequency-domain tone shaping: a gentle low-pass, high-pass, and formant bumps."""
    size = 1 << int(np.ceil(np.log2(x.size)))
    X = np.fft.rfft(x, size)
    f = np.fft.rfftfreq(size, 1 / SR)
    g = 1 / np.sqrt(1 + (f / lowpass) ** 4) * (1 / np.sqrt(1 + (highpass / np.maximum(f, 1)) ** 4))
    for center, width, boost in peaks:
        g *= 1 + boost * np.exp(-0.5 * ((f - center) / width) ** 2)
    return np.fft.irfft(X * g, size)[: x.size]


mixed = {
    "low": shape(BUS["low"], [], 900, 25) * 1.0,
    "strings": shape(BUS["strings"], [(900, 500, 0.3)], 4200, 120) * 0.9,
    "ostinato": shape(BUS["ostinato"], [(700, 400, 0.2)], 3000, 80) * 0.8,
    "brass": shape(BUS["brass"], [(700, 400, 0.4)], 2200, 70) * 1.0,
    "choir": shape(BUS["choir"], [(780, 160, 1.3), (1150, 200, 0.8)], 3200, 150) * 0.8,
    "shimmer": shape(BUS["shimmer"], [], 9000, 600) * 1.0,
    "drums": shape(BUS["drums"], [], 9000, 25) * 1.0,
    "fx": shape(BUS["fx"], [], 11000, 80) * 0.8,
    "piano": shape(BUS["piano"], [], 7000, 60) * 1.0,
}


def reverb(x: np.ndarray, seconds: float, seed: int) -> np.ndarray:
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = t_of(n)
    ir = r.standard_normal(n) * np.exp(-t / (seconds / 4.5))
    ir = np.concatenate([np.zeros(int(0.03 * SR)), shape(ir, [], 4500, 120)])
    ir /= np.sqrt(np.sum(ir**2))
    size = 1 << int(np.ceil(np.log2(x.size + ir.size)))
    return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: x.size]


dry = sum(mixed.values())
send = (mixed["strings"] + mixed["choir"] + mixed["brass"] * 0.8 + mixed["ostinato"] * 0.5 + mixed["shimmer"] + mixed["piano"]
        + mixed["drums"] * 0.35 + mixed["low"] * 0.2 + mixed["fx"] * 0.4)
left = dry * 0.85 + reverb(send, 3.4, 1) * 0.55
right = dry * 0.85 + reverb(send, 3.4, 2) * 0.55
# Width: strings and choir lean apart a little.
left += (mixed["strings"] - mixed["choir"]) * 0.08
right += (mixed["choir"] - mixed["strings"]) * 0.08
out = np.stack([left, right], axis=1)

# The whole score grows as the castle does: quiet at the foundation, full at the peak.
GROWTH = [(0, 0.5), (4.0, 0.55), (9.2, 0.62), (14.67, 0.7), (19.53, 0.78), (25.0, 0.8), (25.3, 0.66), (26.4, 0.76),
          (29.07, 0.8), (33.5, 0.9), (35.2, 1.0), (35.25, 0.75), (LENGTH, 0.75)]
out *= layer_level(GROWTH)[:, None]

# Glue and level: soft saturation, the cut at the white-out stays clean, -1 dB peak.
out = np.tanh(out / np.max(np.abs(out)) * 0.8) / np.tanh(0.8)
t = t_of(N)
out *= np.clip(t / 0.05, 0, 1)[:, None] * np.clip((OUT_LENGTH - t) / 2.5, 0, 1)[:, None]
out *= 0.89 / np.max(np.abs(out))

pcm = (np.clip(out, -1, 1) * 32767).astype("<i2")
with wave.open(sys.argv[1] if len(sys.argv) > 1 else "score.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", round(OUT_LENGTH, 2), "seconds")
