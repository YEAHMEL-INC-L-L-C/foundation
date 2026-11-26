export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

// Krumhansl-Kessler key profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export const BEATS_PER_BAR = 4;
export const BARS_PER_PHRASE = 4;
const ON_BEAT_TOLERANCE_SEC = 0.07;
const DENSITY_RADIUS_SEC = 1.0;
const SMOOTH_RADIUS_SEC = 0.5;
const SHAPE_THRESHOLD = 0.1;

export type PhraseShape = 'build' | 'release' | 'arc' | 'steady';

export interface KeyEstimate {
  tonic: string;
  mode: 'major' | 'minor';
  label: string;
  confidence: number;
  runner_up: string;
}

export interface BeatGrid {
  bpm: number;
  beat_sec: number;
  first_beat_sec: number;
  first_downbeat_sec: number;
  beats_per_bar: number;
  beats: number;
  bars: number;
  mean_offset_ms: number;
  on_beat_pct: number;
}

export interface PhraseInfo {
  phrase: number;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  bars: number;
  mean_tension: number;
  peak_tension: number;
  peak_sec: number;
  shape: PhraseShape;
}

export interface SectionDetail {
  section: number;
  energy: number;
  brightness: number;
  tension: number;
  onsets: number;
  onsets_per_sec: number;
  dominant_pitch: string;
}

export interface DetailedAnalysis {
  key: KeyEstimate | null;
  beat_grid: BeatGrid | null;
  phrases: PhraseInfo[];
  sections: SectionDetail[];
  tension: {
    mean: number;
    peak_sec: number;
    low_sec: number;
  };
}

export interface DetailedSeries {
  beat_times: number[];
  downbeat_times: number[];
  tension: number[];
}

export interface DetailedInput {
  dur: number;
  hopSec: number;
  times: number[];
  energy: number[];
  brightness: number[];
  onsetTimes: number[];
  frameChroma: Float64Array[];
  lowBand: number[];
  chroma: number[];
  bpm: number;
  sections: { section: number; start_sec: number; end_sec: number; duration_sec: number }[];
}

function roundTo(v: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round((v + Number.EPSILON) * factor) / factor;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function argmax(values: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

function pearson(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}

function circularDistance(t: number, phase: number, period: number): number {
  const r = (((t - phase) % period) + period) % period;
  return Math.min(r, period - r);
}

export function estimateKey(chroma: number[]): KeyEstimate | null {
  if (!chroma.some((v) => v > 0)) return null;
  const scores: { tonic: number; mode: 'major' | 'minor'; r: number }[] = [];
  for (const [mode, profile] of [['major', MAJOR_PROFILE], ['minor', MINOR_PROFILE]] as const) {
    for (let tonic = 0; tonic < 12; tonic++) {
      const rotated = NOTES.map((_, i) => profile[(i - tonic + 12) % 12]);
      scores.push({ tonic, mode, r: pearson(chroma, rotated) });
    }
  }
  const order = scores.map((_, i) => i).sort((i, j) => scores[j].r - scores[i].r || i - j);
  const best = scores[order[0]];
  const second = scores[order[1]];
  return {
    tonic: NOTES[best.tonic],
    mode: best.mode,
    label: `${NOTES[best.tonic]} ${best.mode}`,
    confidence: roundTo(best.r, 4),
    runner_up: `${NOTES[second.tonic]} ${second.mode}`,
  };
}

// Ignore float noise so TS and Python pick the same phase on near-ties.
const PHASE_TIE_EPS = 1e-9;

function frameIndex(t: number, hopSec: number, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.round(t / hopSec)));
}

function buildBeatGrid(input: DetailedInput) {
  const { bpm, onsetTimes, dur, lowBand, hopSec } = input;
  if (bpm <= 0 || onsetTimes.length < 2 || lowBand.length === 0) return null;

  const beatSec = 60.0 / bpm;
  const steps = Math.max(1, Math.floor(beatSec * 1000));
  let phase = 0;
  let bestCost = Infinity;
  for (let k = 0; k < steps; k++) {
    const p = k / 1000;
    let cost = 0;
    for (const t of onsetTimes) cost += circularDistance(t, p, beatSec);
    if (cost < bestCost - PHASE_TIE_EPS) {
      bestCost = cost;
      phase = p;
    }
  }

  const beatTimes: number[] = [];
  for (let k = 0; ; k++) {
    const t = roundTo(phase + k * beatSec, 4);
    if (t >= dur) break;
    beatTimes.push(t);
  }

  const accentScores: number[] = [];
  for (let o = 0; o < BEATS_PER_BAR; o++) {
    const vals: number[] = [];
    for (let k = o; k < beatTimes.length; k += BEATS_PER_BAR) vals.push(lowBand[frameIndex(beatTimes[k], hopSec, lowBand.length)]);
    accentScores.push(mean(vals));
  }
  const downbeatOffset = argmax(accentScores);
  const downbeatTimes = beatTimes.filter((_, k) => k % BEATS_PER_BAR === downbeatOffset);

  const offsets = onsetTimes.map((t) => circularDistance(t, phase, beatSec));
  const onBeat = offsets.filter((d) => d <= ON_BEAT_TOLERANCE_SEC).length;

  const grid: BeatGrid = {
    bpm,
    beat_sec: roundTo(beatSec, 6),
    first_beat_sec: roundTo(phase, 4),
    first_downbeat_sec: downbeatTimes.length > 0 ? downbeatTimes[0] : roundTo(phase, 4),
    beats_per_bar: BEATS_PER_BAR,
    beats: beatTimes.length,
    bars: downbeatTimes.length,
    mean_offset_ms: roundTo(mean(offsets) * 1000, 2),
    on_beat_pct: roundTo((100 * onBeat) / onsetTimes.length, 1),
  };
  return { grid, beatTimes, downbeatTimes };
}

function tensionCurve(input: DetailedInput): number[] {
  const { times, energy, brightness, onsetTimes, hopSec } = input;
  const n = times.length;
  if (n === 0) return [];

  const density = times.map((t) => onsetTimes.filter((o) => Math.abs(o - t) <= DENSITY_RADIUS_SEC).length);
  const maxDensity = Math.max(...density);
  const raw = times.map(
    (_, i) => 0.5 * energy[i] + 0.3 * brightness[i] + 0.2 * (maxDensity > 0 ? density[i] / maxDensity : 0)
  );

  const radius = Math.max(1, Math.round(SMOOTH_RADIUS_SEC / hopSec));
  const smooth = raw.map((_, i) => mean(raw.slice(Math.max(0, i - radius), Math.min(n, i + radius + 1))));
  const maxSmooth = Math.max(...smooth);
  return smooth.map((v) => roundTo(v / (maxSmooth + 1e-12), 4));
}

function phraseShape(values: number[]): PhraseShape {
  const third = Math.floor(values.length / 3);
  if (third === 0) return 'steady';
  const a = mean(values.slice(0, third));
  const b = mean(values.slice(third, values.length - third));
  const c = mean(values.slice(values.length - third));
  if (c - a >= SHAPE_THRESHOLD) return 'build';
  if (a - c >= SHAPE_THRESHOLD) return 'release';
  if (b - Math.max(a, c) >= SHAPE_THRESHOLD) return 'arc';
  return 'steady';
}

function framesIn(times: number[], start: number, end: number, inclusiveEnd: boolean): number[] {
  const idx: number[] = [];
  times.forEach((t, i) => {
    if (t >= start && (t < end || (inclusiveEnd && t <= end))) idx.push(i);
  });
  return idx;
}

function buildPhrases(input: DetailedInput, downbeatTimes: number[], tension: number[]): PhraseInfo[] {
  const { dur, times } = input;
  if (downbeatTimes.length === 0) return [];

  const starts = [0];
  for (let k = BARS_PER_PHRASE; k < downbeatTimes.length; k += BARS_PER_PHRASE) starts.push(downbeatTimes[k]);

  return starts.map((start, i) => {
    const isLast = i === starts.length - 1;
    const end = isLast ? dur : starts[i + 1];
    const idx = framesIn(times, start, end, isLast);
    const values = idx.map((j) => tension[j]);
    const peakLocal = values.length > 0 ? argmax(values) : 0;
    return {
      phrase: i + 1,
      start_sec: roundTo(start, 6),
      end_sec: roundTo(end, 6),
      duration_sec: roundTo(end - start, 6),
      bars: downbeatTimes.filter((t) => t >= start && t < end).length,
      mean_tension: roundTo(mean(values), 4),
      peak_tension: values.length > 0 ? values[peakLocal] : 0,
      peak_sec: values.length > 0 ? times[idx[peakLocal]] : roundTo(start, 4),
      shape: phraseShape(values),
    };
  });
}

function sectionDetails(input: DetailedInput, tension: number[]): SectionDetail[] {
  const { sections, times, energy, brightness, onsetTimes, frameChroma } = input;
  return sections.map((s, i) => {
    const isLast = i === sections.length - 1;
    const idx = framesIn(times, s.start_sec, s.end_sec, isLast);
    const onsets = onsetTimes.filter((t) => t >= s.start_sec && (t < s.end_sec || (isLast && t <= s.end_sec))).length;
    const ch = new Float64Array(12);
    for (const j of idx) for (let p = 0; p < 12; p++) ch[p] += frameChroma[j][p];
    const hasPitch = ch.some((v) => v > 0);
    return {
      section: s.section,
      energy: roundTo(mean(idx.map((j) => energy[j])), 4),
      brightness: roundTo(mean(idx.map((j) => brightness[j])), 4),
      tension: roundTo(mean(idx.map((j) => tension[j])), 4),
      onsets,
      onsets_per_sec: s.duration_sec > 0 ? roundTo(onsets / s.duration_sec, 3) : 0,
      dominant_pitch: hasPitch ? NOTES[argmax(ch)] : '',
    };
  });
}

export function computeDetailedAnalysis(input: DetailedInput): { detailed: DetailedAnalysis; series: DetailedSeries } {
  const tension = tensionCurve(input);
  const beat = buildBeatGrid(input);
  const phrases = beat ? buildPhrases(input, beat.downbeatTimes, tension) : [];

  let peakSec = 0;
  let lowSec = 0;
  if (tension.length > 0) {
    peakSec = input.times[argmax(tension)];
    lowSec = input.times[argmax(tension.map((v) => -v))];
  }

  return {
    detailed: {
      key: estimateKey(input.chroma),
      beat_grid: beat ? beat.grid : null,
      phrases,
      sections: sectionDetails(input, tension),
      tension: { mean: roundTo(mean(tension), 4), peak_sec: peakSec, low_sec: lowSec },
    },
    series: {
      beat_times: beat ? beat.beatTimes : [],
      downbeat_times: beat ? beat.downbeatTimes : [],
      tension,
    },
  };
}
