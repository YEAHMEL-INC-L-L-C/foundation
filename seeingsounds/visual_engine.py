"""Deterministic visualizer frames for Seeing Sounds.

Turns audio into per-frame band signals (bass, vocals, highs, hits, energy) and
then into color and motion coordinates the browser draws at 60 fps. The same
audio always produces the same frames.

src/engine/visualizerMath.ts implements the same math for the desktop app,
which has no server; tests/test_api.py checks that the two agree.
"""
import json
import math
import sys

import numpy as np

SR = 22050
WIN = 2048
DEFAULT_FPS = 30

# Seeing Sounds logo colors.
PALETTE = {
    "red": (252, 1, 20),
    "green": (4, 160, 83),
    "yellow": (250, 200, 20),
    "teal": (1, 169, 158),
    "pink": (252, 4, 113),
}
GOLDEN_ANGLE = 2.399963229728653


class Spring:
    """Damped spring stepped with three sub-steps per frame."""

    def __init__(self, k=380.0, c=11.0):
        self.k, self.c, self.x, self.v = k, c, 0.0, 0.0

    def step(self, imp, dt):
        sub = dt / 3
        for _ in range(3):
            self.v += (-self.k * self.x - self.c * self.v) * sub
            self.x += self.v * sub
        self.v += imp
        return self.x


def resample_to_22050(mono, src_sr, block=1 << 20):
    """Linear resampling to float32, matching resampleTo22050 in visualizerMath.ts.

    Works in blocks so a long track never needs full-length float64 arrays.
    """
    mono = np.asarray(mono)
    if src_sr == SR:
        return mono.astype(np.float32, copy=False)
    out_len = max(1, int(math.floor(len(mono) * SR / src_sr)))
    out = np.empty(out_len, dtype=np.float32)
    ratio = src_sr / SR
    last = len(mono) - 1
    for start in range(0, out_len, block):
        pos = np.arange(start, min(out_len, start + block)) * ratio
        idx = np.floor(pos).astype(np.int64)
        frac = pos - idx
        s0 = mono[np.minimum(idx, last)].astype(np.float64)
        s1 = mono[np.minimum(idx + 1, last)].astype(np.float64)
        out[start:start + len(pos)] = s0 + (s1 - s0) * frac
    return out


def _norm(x):
    lo, hi = np.percentile(x, 10), np.percentile(x, 97)
    return np.clip((x - lo) / (hi - lo + 1e-9), 0.0, 1.3)


def _smooth(x, a=0.6, r=0.88):
    out = np.zeros(len(x))
    v = 0.0
    for i, t in enumerate(x):
        v = t * a + v * (1 - a) if t > v else v * r + t * (1 - r)
        out[i] = v
    return out


def compute_signals(mono22050, fps=DEFAULT_FPS):
    """Per-frame band signals for the whole track."""
    y = np.asarray(mono22050)
    dur = len(y) / SR
    nf = max(1, int(math.floor(dur * fps)))
    freqs = np.fft.rfftfreq(WIN, d=1.0 / SR)
    hann = np.hanning(WIN)
    bass_m = (freqs >= 30) & (freqs < 150)
    vox_m = (freqs >= 300) & (freqs < 3000)
    high_m = (freqs >= 5000) & (freqs < 12000)
    flux_m = (freqs >= 100) & (freqs < 8000)

    def band_rms(mag, m):
        return float(np.sqrt(np.mean(mag[m] ** 2))) if m.any() else 0.0

    eb, ev, eh, flux, total = (np.zeros(nf) for _ in range(5))
    prev = None
    for i in range(nf):
        c = int(math.floor((i / fps) * SR))
        lo = max(0, c - WIN // 2)
        seg = np.zeros(WIN)
        chunk = y[lo:lo + WIN]
        seg[:len(chunk)] = chunk.astype(np.float64)
        mag = np.abs(np.fft.rfft(seg * hann))
        eb[i], ev[i], eh[i] = band_rms(mag, bass_m), band_rms(mag, vox_m), band_rms(mag, high_m)
        total[i] = eb[i] + ev[i] + eh[i]
        if prev is not None:
            flux[i] = float(np.sum(np.maximum(0.0, mag[flux_m] - prev[flux_m])))
        prev = mag

    nb, nflux = _norm(eb), _norm(flux)
    kick = np.maximum(0.0, np.diff(nb, prepend=nb[0]))
    snare = np.concatenate([[max(0.0, nflux[0])], np.maximum(0.0, np.diff(nflux))])
    return {
        "fps": fps,
        "nf": nf,
        "bass": _smooth(nb, 0.8, 0.82),
        "vox": _smooth(_norm(ev), 0.5, 0.8),
        "high": _smooth(_norm(eh), 0.7, 0.75),
        "hit": _smooth(nflux, 0.9, 0.7),
        "energy": _smooth(_norm(total), 0.4, 0.92),
        "kick": kick,
        "snare": snare,
    }


def _round_half_up(x):
    return int(math.floor(x + 0.5))


def compute_frames(sig):
    """Color and motion coordinates for each frame.

    Coordinates are fractions of the canvas (0..1), so any canvas size works.
    """
    fps, nf = sig["fps"], sig["nf"]
    dt = 1.0 / fps
    kick_spring, shake_x, shake_y = Spring(), Spring(260.0, 9.0), Spring(260.0, 9.0)
    pal = PALETTE
    out = {k: [] for k in ("orb_x", "orb_y", "orb_scale", "ring", "sparkle", "glow", "color")}
    for i in range(nf):
        bass, vox, high = float(sig["bass"][i]), float(sig["vox"][i]), float(sig["high"][i])
        hit, energy = float(sig["hit"][i]), float(sig["energy"][i])
        pulse = kick_spring.step(float(sig["kick"][i]) * 6.0, dt)
        theta = i * GOLDEN_ANGLE
        s = float(sig["snare"][i]) * 4.0
        dx = shake_x.step(s * math.cos(theta), dt)
        dy = shake_y.step(s * math.sin(theta), dt)
        out["orb_x"].append(0.5 + 0.06 * max(-1.0, min(1.0, dx)))
        out["orb_y"].append(0.5 + 0.06 * max(-1.0, min(1.0, dy)))
        out["orb_scale"].append(max(0.3, min(1.6, 0.55 + 0.3 * bass + pulse)))
        out["ring"].append(min(1.0, vox / 1.3))
        out["sparkle"].append(min(1.0, high / 1.3))
        out["glow"].append(min(1.0, energy / 1.3))
        weights = (
            (pal["green"], 0.15),
            (pal["red"], bass),
            (pal["yellow"], hit),
            (pal["pink"], vox),
            (pal["teal"], high),
        )
        wsum = sum(w for _, w in weights)
        out["color"].append([_round_half_up(sum(c[k] * w for c, w in weights) / wsum) for k in range(3)])
    return out


def _r4(values):
    return [round(float(v), 4) for v in values]


def visual_report(mono, src_sr, fps=DEFAULT_FPS):
    """Full /api/visual response for mono audio at any sample rate."""
    sig = compute_signals(resample_to_22050(mono, src_sr), fps)
    frames = compute_frames(sig)
    return {
        "fps": sig["fps"],
        "nf": sig["nf"],
        "palette": {k: list(v) for k, v in PALETTE.items()},
        "signals": {k: _r4(sig[k]) for k in ("bass", "vox", "high", "hit", "energy", "kick", "snare")},
        "frames": {k: (v if k == "color" else _r4(v)) for k, v in frames.items()},
    }


def visual_from_source(source, fps=DEFAULT_FPS):
    """Read a file path or file-like object and build its visual report."""
    from math_engine import read_mono

    mono, sr = read_mono(source)
    return visual_report(mono, sr, fps)


if __name__ == "__main__":
    print(json.dumps(visual_from_source(sys.argv[1])))
