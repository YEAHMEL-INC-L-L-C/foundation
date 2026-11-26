import { createRfftPlan, hanning, rfftFreqs, rfftMagnitude } from './fft.ts';

export interface VisualizerSignals {
  fps: number;
  nf: number;
  bass: Float32Array;
  vox: Float32Array;
  high: Float32Array;
  hit: Float32Array;
  energy: Float32Array;
  kick: Float32Array;
  snare: Float32Array;
}

export class Spring {
  k: number;
  c: number;
  x = 0.0;
  v = 0.0;

  constructor(k = 380.0, c = 11.0) {
    this.k = k;
    this.c = c;
  }

  step(imp: number, dt: number): number {
    const sub = dt / 3;
    for (let s = 0; s < 3; s++) {
      this.v += (-this.k * this.x - this.c * this.v) * sub;
      this.x += this.v * sub;
    }
    this.v += imp;
    return this.x;
  }
}

function percentile(arr: Float64Array, p: number): number {
  if (arr.length === 0) return 0;
  const sorted = Float64Array.from(arr).sort();
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function norm(x: Float64Array): Float64Array {
  const lo = percentile(x, 10);
  const hi = percentile(x, 97);
  const denom = hi - lo + 1e-9;
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = (x[i] - lo) / denom;
    out[i] = v < 0 ? 0 : v > 1.3 ? 1.3 : v;
  }
  return out;
}

function smooth(x: Float64Array, a = 0.6, r = 0.88): Float32Array {
  const out = new Float32Array(x.length);
  let v = 0;
  for (let i = 0; i < x.length; i++) {
    const t = x[i];
    v = t > v ? t * a + v * (1 - a) : v * r + t * (1 - r);
    out[i] = v;
  }
  return out;
}

export function resampleTo22050(mono: Float32Array, srcSr: number): Float32Array {
  const targetSr = 22050;
  if (srcSr === targetSr) return mono;
  const outLen = Math.max(1, Math.floor((mono.length * targetSr) / srcSr));
  const out = new Float32Array(outLen);
  const ratio = srcSr / targetSr;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = mono[idx] ?? 0;
    const s1 = mono[Math.min(idx + 1, mono.length - 1)] ?? s0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

export function computeVisualizerSignals(
  mono22050: Float32Array,
  startSec: number,
  durSec: number,
  fps = 30
): VisualizerSignals {
  const SR = 22050;
  const startIdx = Math.max(0, Math.floor(startSec * SR));
  const endIdx = Math.min(mono22050.length, Math.floor((startSec + durSec) * SR));
  const y = mono22050.subarray(startIdx, endIdx);

  const nf = Math.max(1, Math.floor(durSec * fps));
  const win = 2048;
  const freqs = rfftFreqs(win, 1.0 / SR);
  const hann = hanning(win);
  const plan = createRfftPlan(win);

  const bassMask: number[] = [];
  const voxMask: number[] = [];
  const highMask: number[] = [];
  const fluxMask: number[] = [];

  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k];
    if (f >= 30 && f < 150) bassMask.push(k);
    if (f >= 300 && f < 3000) voxMask.push(k);
    if (f >= 5000 && f < 12000) highMask.push(k);
    if (f >= 100 && f < 8000) fluxMask.push(k);
  }

  const eb = new Float64Array(nf);
  const ev = new Float64Array(nf);
  const eh = new Float64Array(nf);
  const flux = new Float64Array(nf);
  const totalE = new Float64Array(nf);
  const seg = new Float64Array(win);
  let prev: Float64Array | null = null;

  const bandRms = (mag: Float64Array, mask: number[]) => {
    if (mask.length === 0) return 0;
    let sum = 0;
    for (let j = 0; j < mask.length; j++) {
      const m = mag[mask[j]];
      sum += m * m;
    }
    return Math.sqrt(sum / mask.length);
  };

  for (let i = 0; i < nf; i++) {
    const c = Math.floor((i / fps) * SR);
    const lo = Math.max(0, c - win / 2);
    seg.fill(0);
    for (let j = 0; j < win; j++) {
      const idx = lo + j;
      if (idx < y.length) {
        seg[j] = y[idx] * hann[j];
      }
    }
    const mag = rfftMagnitude(seg, plan);
    eb[i] = bandRms(mag, bassMask);
    ev[i] = bandRms(mag, voxMask);
    eh[i] = bandRms(mag, highMask);
    totalE[i] = eb[i] + ev[i] + eh[i];

    if (prev !== null) {
      let fSum = 0;
      for (let j = 0; j < fluxMask.length; j++) {
        const idx = fluxMask[j];
        const d = mag[idx] - prev[idx];
        if (d > 0) fSum += d;
      }
      flux[i] = fSum;
    }
    prev = mag;
  }

  const nb = norm(eb);
  const nflux = norm(flux);

  const bass = smooth(nb, 0.8, 0.82);
  const vox = smooth(norm(ev), 0.5, 0.8);
  const high = smooth(norm(eh), 0.7, 0.75);
  const hit = smooth(nflux, 0.9, 0.7);
  const energy = smooth(norm(totalE), 0.4, 0.92);

  const kick = new Float32Array(nf);
  const snare = new Float32Array(nf);
  for (let i = 0; i < nf; i++) {
    kick[i] = i === 0 ? 0 : Math.max(0, nb[i] - nb[i - 1]);
    snare[i] = i === 0 ? Math.max(0, nflux[0]) : Math.max(0, nflux[i] - nflux[i - 1]);
  }

  return { fps, nf, bass, vox, high, hit, energy, kick, snare };
}

// ---------------------------------------------------------------------------
// Visual frames: deterministic color and motion coordinates per frame.
// Mirrors compute_frames / visual_report in visual_engine.py, which serves
// /api/visual on the web; this copy runs in the desktop and iOS app.
// tests/test_api.py checks that the two agree.

export const PALETTE = {
  red: [252, 1, 20],
  green: [4, 160, 83],
  yellow: [250, 200, 20],
  teal: [1, 169, 158],
  pink: [252, 4, 113],
} as const;

const GOLDEN_ANGLE = 2.399963229728653;

export interface VisualFrames {
  /** Orb centre as fractions of the canvas width and height (0..1). */
  orb_x: number[];
  orb_y: number[];
  /** Orb radius as a fraction of half the canvas's shorter side. */
  orb_scale: number[];
  /** Vocal ring, highs sparkle and overall glow, each 0..1. */
  ring: number[];
  sparkle: number[];
  glow: number[];
  /** Orb color as [r, g, b]. */
  color: [number, number, number][];
}

export interface VisualReport {
  fps: number;
  nf: number;
  palette: Record<keyof typeof PALETTE, number[]>;
  signals: Record<'bass' | 'vox' | 'high' | 'hit' | 'energy' | 'kick' | 'snare', number[]>;
  frames: VisualFrames;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function computeVisualFrames(sig: VisualizerSignals): VisualFrames {
  const dt = 1 / sig.fps;
  const kickSpring = new Spring();
  const shakeX = new Spring(260.0, 9.0);
  const shakeY = new Spring(260.0, 9.0);
  const out: VisualFrames = { orb_x: [], orb_y: [], orb_scale: [], ring: [], sparkle: [], glow: [], color: [] };
  for (let i = 0; i < sig.nf; i++) {
    const bass = sig.bass[i];
    const vox = sig.vox[i];
    const high = sig.high[i];
    const hit = sig.hit[i];
    const energy = sig.energy[i];
    const pulse = kickSpring.step(sig.kick[i] * 6.0, dt);
    const theta = i * GOLDEN_ANGLE;
    const s = sig.snare[i] * 4.0;
    const dx = shakeX.step(s * Math.cos(theta), dt);
    const dy = shakeY.step(s * Math.sin(theta), dt);
    out.orb_x.push(0.5 + 0.06 * clamp(dx, -1, 1));
    out.orb_y.push(0.5 + 0.06 * clamp(dy, -1, 1));
    out.orb_scale.push(clamp(0.55 + 0.3 * bass + pulse, 0.3, 1.6));
    out.ring.push(Math.min(1, vox / 1.3));
    out.sparkle.push(Math.min(1, high / 1.3));
    out.glow.push(Math.min(1, energy / 1.3));
    const weights: [readonly number[], number][] = [
      [PALETTE.green, 0.15],
      [PALETTE.red, bass],
      [PALETTE.yellow, hit],
      [PALETTE.pink, vox],
      [PALETTE.teal, high],
    ];
    let wsum = 0;
    for (const [, w] of weights) wsum += w;
    const rgb = [0, 1, 2].map((k) => {
      let acc = 0;
      for (const [c, w] of weights) acc += c[k] * w;
      return Math.floor(acc / wsum + 0.5);
    }) as [number, number, number];
    out.color.push(rgb);
  }
  return out;
}

/** Same shape as the /api/visual response. */
export function computeVisualReport(mono: Float32Array, sampleRate: number, fps = 30): VisualReport {
  const y = resampleTo22050(mono, sampleRate);
  const sig = computeVisualizerSignals(y, 0, y.length / 22050, fps);
  const frames = computeVisualFrames(sig);
  const sigOut = {} as VisualReport['signals'];
  for (const k of ['bass', 'vox', 'high', 'hit', 'energy', 'kick', 'snare'] as const) sigOut[k] = Array.from(sig[k], r4);
  return {
    fps: sig.fps,
    nf: sig.nf,
    palette: { ...PALETTE } as unknown as VisualReport['palette'],
    signals: sigOut,
    frames: {
      ...frames,
      orb_x: frames.orb_x.map(r4),
      orb_y: frames.orb_y.map(r4),
      orb_scale: frames.orb_scale.map(r4),
      ring: frames.ring.map(r4),
      sparkle: frames.sparkle.map(r4),
      glow: frames.glow.map(r4),
    },
  };
}
