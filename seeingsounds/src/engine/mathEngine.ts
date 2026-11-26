import { computeDetailedAnalysis, NOTES } from './detailedAnalysis.ts';
import type { DetailedAnalysis, DetailedSeries } from './detailedAnalysis.ts';
import { createRfftPlan, hanning, rfftFreqs, rfftMagnitude } from './fft.ts';

export { NOTES };

// Kick and bass band used to find the downbeat
const LOW_BAND_HZ = 150.0;

export interface SectionInfo {
  section: number;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
}

export interface MathEngineReport {
  track: {
    file: string;
    sr: number;
    duration_sec: number;
  };
  verified_math: {
    bpm: number;
    onsets: number;
    dominant_pitch: string;
    chroma: Record<string, number>;
    sections: SectionInfo[];
  };
  detailed: DetailedAnalysis;
  integrity: {
    passed: boolean;
    error_ms: number;
    phrase_error_ms: number;
  };
}

export interface MathEngineAnalysis extends MathEngineReport {
  series: {
    times: number[];
    rms: number[];
    centroid: number[];
    onset_times: number[];
  } & DetailedSeries;
}

function roundTo(v: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round((v + Number.EPSILON) * factor) / factor;
}

function populationStd(arr: Float64Array): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  const mean = sum / arr.length;
  let sq = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - mean;
    sq += d * d;
  }
  return Math.sqrt(sq / arr.length);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Mirrors scipy.signal.find_peaks(x, distance=..., prominence=...)
function findPeaks(x: Float64Array, minDistance: number, minProminence: number): number[] {
  const n = x.length;
  if (n < 3) return [];

  const candidates: number[] = [];
  let i = 1;
  while (i < n - 1) {
    if (x[i - 1] < x[i]) {
      let iahead = i + 1;
      while (iahead < n - 1 && x[iahead] === x[i]) {
        iahead++;
      }
      if (x[iahead] < x[i]) {
        // Peak midpoint (same convention as scipy _local_maxima_1d)
        candidates.push(Math.floor((i + iahead - 1) / 2));
        i = iahead;
        continue;
      }
    }
    i++;
  }

  // Topological prominence filtering
  const prominentPeaks: number[] = [];
  for (const p of candidates) {
    const h = x[p];
    let leftMin = h;
    for (let l = p - 1; l >= 0; l--) {
      if (x[l] > h) break;
      if (x[l] < leftMin) leftMin = x[l];
    }
    let rightMin = h;
    for (let r = p + 1; r < n; r++) {
      if (x[r] > h) break;
      if (x[r] < rightMin) rightMin = x[r];
    }
    const prom = h - Math.max(leftMin, rightMin);
    if (prom >= minProminence) {
      prominentPeaks.push(p);
    }
  }

  if (minDistance <= 1 || prominentPeaks.length <= 1) {
    return prominentPeaks;
  }

  // Greedy highest-peak-first distance pruning (matches scipy._select_by_peak_distance)
  const order = [...prominentPeaks].sort((a, b) => x[b] - x[a]);
  const keep = new Map<number, boolean>();
  for (const p of prominentPeaks) keep.set(p, true);

  for (const p of order) {
    if (!keep.get(p)) continue;
    for (const q of prominentPeaks) {
      if (q !== p && keep.get(q) && Math.abs(q - p) < minDistance) {
        keep.set(q, false);
      }
    }
  }

  return prominentPeaks.filter((p) => keep.get(p));
}

export function analyzeAudioSamples(
  mono: Float32Array | Float64Array,
  sr: number,
  fileName: string,
  hopMs = 50
): MathEngineAnalysis {
  if (sr <= 0 || mono.length === 0) {
    throw new Error('Audio stream is empty or has an invalid sample rate.');
  }

  const dur = roundTo(mono.length / sr, 6);
  const hop = Math.max(1, Math.floor(sr * (hopMs / 1000.0)));
  const win = hop * 2;
  const w = hanning(win);
  const plan = createRfftPlan(win);
  const freqs = rfftFreqs(win, 1.0 / sr);

  const maskIndices: number[] = [];
  const pitchClasses: number[] = [];
  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k];
    if (f >= 55.0 && f <= 4186.0) {
      maskIndices.push(k);
      const midi = Math.round(69.0 + 12.0 * Math.log2(f / 440.0));
      pitchClasses.push(((midi % 12) + 12) % 12);
    }
  }

  const times: number[] = [];
  const rv: number[] = [];
  const cv: number[] = [];
  const ch = new Float64Array(12);
  const frameChroma: Float64Array[] = [];
  const lowBand: number[] = [];
  const windowed = new Float64Array(win);

  for (let s = 0; s <= mono.length - win; s += hop) {
    times.push(roundTo(s / sr, 4));
    let sumSq = 0;
    for (let j = 0; j < win; j++) {
      const sample = mono[s + j];
      sumSq += sample * sample;
      windowed[j] = sample * w[j];
    }
    rv.push(Math.sqrt(sumSq / win));

    const mag = rfftMagnitude(windowed, plan);
    let weightedSum = 0;
    let magSum = 0;
    for (let k = 0; k < mag.length; k++) {
      weightedSum += freqs[k] * mag[k];
      magSum += mag[k];
    }
    cv.push(weightedSum / (magSum + 1e-12));

    let low = 0;
    for (let k = 0; k < mag.length && freqs[k] < LOW_BAND_HZ; k++) low += mag[k];
    lowBand.push(low);

    const fc = new Float64Array(12);
    for (let m = 0; m < maskIndices.length; m++) {
      fc[pitchClasses[m]] += mag[maskIndices[m]];
    }
    for (let p = 0; p < 12; p++) ch[p] += fc[p];
    frameChroma.push(fc);
  }

  const maxR = rv.length > 0 ? Math.max(...rv) : 0;
  const maxC = cv.length > 0 ? Math.max(...cv) : 0;
  let maxCh = 0;
  for (let i = 0; i < 12; i++) {
    if (ch[i] > maxCh) maxCh = ch[i];
  }

  const rn = rv.map((v) => roundTo(v / (maxR + 1e-12), 4));
  const cn = cv.map((v) => roundTo(v / (maxC + 1e-12), 4));
  const chn = Array.from(ch, (v) => roundTo(v / (maxCh + 1e-12), 4));

  const ed = new Float64Array(rv.length);
  for (let i = 0; i < rv.length; i++) {
    const diff = i === 0 ? 0 : rv[i] - rv[i - 1];
    ed[i] = Math.max(0.0, diff);
  }

  const minDistance = Math.max(1, Math.floor(0.25 / (hopMs / 1000.0)));
  const minProminence = populationStd(ed) * 0.75;
  const pks = findPeaks(ed, minDistance, minProminence);
  const ons = pks.map((k) => times[k]);

  let bpm = 0.0;
  if (ons.length >= 2) {
    const diffs: number[] = [];
    for (let i = 1; i < ons.length; i++) diffs.push(ons[i] - ons[i - 1]);
    const med = median(diffs);
    if (med > 0) bpm = roundTo(60.0 / med, 2);
  }
  while (bpm > 180.0) bpm = roundTo(bpm / 2.0, 2);
  while (bpm > 0.0 && bpm < 65.0) bpm = roundTo(bpm * 2.0, 2);

  let maxIdx = 0;
  for (let i = 1; i < 12; i++) {
    if (chn[i] > chn[maxIdx]) maxIdx = i;
  }

  const secs: SectionInfo[] = [];
  const sl = dur / 4.0;
  for (let i = 0; i < 4; i++) {
    const ss = roundTo(i * sl, 6);
    const se = roundTo(i === 3 ? dur : (i + 1) * sl, 6);
    secs.push({
      section: i + 1,
      start_sec: ss,
      end_sec: se,
      duration_sec: roundTo(se - ss, 6),
    });
  }

  const totalSecDur = secs.reduce((acc, s) => acc + s.duration_sec, 0);
  const err = roundTo(Math.abs(dur - totalSecDur) * 1000.0, 4);

  const { detailed, series: detailedSeries } = computeDetailedAnalysis({
    dur,
    hopSec: hop / sr,
    times,
    energy: rn,
    brightness: cn,
    onsetTimes: ons,
    frameChroma,
    lowBand,
    chroma: chn,
    bpm,
    sections: secs,
  });
  const totalPhraseDur = detailed.phrases.reduce((acc, p) => acc + p.duration_sec, 0);
  const phraseErr = detailed.phrases.length > 0 ? roundTo(Math.abs(dur - totalPhraseDur) * 1000.0, 4) : 0;

  const chroma: Record<string, number> = {};
  NOTES.forEach((note, idx) => {
    chroma[note] = chn[idx];
  });

  return {
    track: {
      file: fileName,
      sr,
      duration_sec: dur,
    },
    verified_math: {
      bpm,
      onsets: ons.length,
      dominant_pitch: NOTES[maxIdx],
      chroma,
      sections: secs,
    },
    detailed,
    integrity: {
      passed: err <= 1.0 && phraseErr <= 1.0,
      error_ms: err,
      phrase_error_ms: phraseErr,
    },
    series: {
      times,
      rms: rn,
      centroid: cn,
      onset_times: ons,
      ...detailedSeries,
    },
  };
}
