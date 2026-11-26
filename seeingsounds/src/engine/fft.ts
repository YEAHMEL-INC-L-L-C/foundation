export function hanning(n: number): Float64Array {
  const w = new Float64Array(n);
  if (n <= 1) {
    if (n === 1) w[0] = 1;
    return w;
  }
  const denom = n - 1;
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / denom);
  }
  return w;
}

export function rfftFreqs(n: number, d: number): Float64Array {
  const bins = Math.floor(n / 2) + 1;
  const freqs = new Float64Array(bins);
  const scale = 1.0 / (n * d);
  for (let i = 0; i < bins; i++) {
    freqs[i] = i * scale;
  }
  return freqs;
}

function nextPow2(v: number): number {
  let p = 1;
  while (p < v) p <<= 1;
  return p;
}

function fftInPlace(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextRe;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

export interface RfftPlan {
  n: number;
  bins: number;
  isPow2: boolean;
  m: number;
  chirpRe?: Float64Array;
  chirpIm?: Float64Array;
  bFftRe?: Float64Array;
  bFftIm?: Float64Array;
  workRe: Float64Array;
  workIm: Float64Array;
}

export function createRfftPlan(n: number): RfftPlan {
  const bins = Math.floor(n / 2) + 1;
  const isPow2 = (n & (n - 1)) === 0;
  if (isPow2) {
    return {
      n,
      bins,
      isPow2: true,
      m: n,
      workRe: new Float64Array(n),
      workIm: new Float64Array(n),
    };
  }

  // Bluestein's algorithm for arbitrary window size N
  const m = nextPow2(2 * n - 1);
  const chirpRe = new Float64Array(n);
  const chirpIm = new Float64Array(n);
  const bFftRe = new Float64Array(m);
  const bFftIm = new Float64Array(m);

  for (let k = 0; k < n; k++) {
    const kk = (k * k) % (2 * n);
    const angle = (Math.PI * kk) / n;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    chirpRe[k] = c;
    chirpIm[k] = -s;
    bFftRe[k] = c;
    bFftIm[k] = s;
    if (k > 0) {
      bFftRe[m - k] = c;
      bFftIm[m - k] = s;
    }
  }

  fftInPlace(bFftRe, bFftIm, false);

  return {
    n,
    bins,
    isPow2: false,
    m,
    chirpRe,
    chirpIm,
    bFftRe,
    bFftIm,
    workRe: new Float64Array(m),
    workIm: new Float64Array(m),
  };
}

export function rfftMagnitude(input: Float64Array, plan: RfftPlan): Float64Array {
  const { n, bins, isPow2, m, workRe, workIm } = plan;
  const out = new Float64Array(bins);

  if (isPow2) {
    workRe.set(input);
    workIm.fill(0);
    fftInPlace(workRe, workIm, false);
    for (let k = 0; k < bins; k++) {
      out[k] = Math.hypot(workRe[k], workIm[k]);
    }
    return out;
  }

  const chirpRe = plan.chirpRe!;
  const chirpIm = plan.chirpIm!;
  const bFftRe = plan.bFftRe!;
  const bFftIm = plan.bFftIm!;

  workRe.fill(0);
  workIm.fill(0);
  for (let k = 0; k < n; k++) {
    workRe[k] = input[k] * chirpRe[k];
    workIm[k] = input[k] * chirpIm[k];
  }

  fftInPlace(workRe, workIm, false);

  for (let k = 0; k < m; k++) {
    const ar = workRe[k];
    const ai = workIm[k];
    const br = bFftRe[k];
    const bi = bFftIm[k];
    workRe[k] = ar * br - ai * bi;
    workIm[k] = ar * bi + ai * br;
  }

  fftInPlace(workRe, workIm, true);

  for (let k = 0; k < bins; k++) {
    const cr = workRe[k];
    const ci = workIm[k];
    const xr = cr * chirpRe[k] - ci * chirpIm[k];
    const xi = cr * chirpIm[k] + ci * chirpRe[k];
    out[k] = Math.hypot(xr, xi);
  }

  return out;
}
