// Chooses where a track is analyzed.
//
// On the web (Cloud Run), the original file is uploaded unchanged (mono or
// stereo, 16/24/32-bit WAV, FLAC, OGG, MP3; any size) and the Python server
// returns the analysis and the visual frames from one request. In the desktop
// and iOS app, or when the server is missing or unreachable, the same engines
// run on the device in a worker.
import type { MathEngineAnalysis } from './mathEngine.ts';
import type { VisualReport } from './visualizerMath.ts';
import type { WorkerRequest, WorkerResponse } from './analysisWorker.ts';
import { encodeMonoWav } from './wavParser.ts';

export type AnalysisSource = 'server' | 'device';

export interface TrackAnalysis {
  analysis: MathEngineAnalysis;
  visual: VisualReport;
  source: AnalysisSource;
}

export const VISUAL_FPS = 30;

/** The server read the upload and said the audio itself is bad. */
class AudioRejected extends Error {}

export function isNativeApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function isWav(file: File): boolean {
  return /\.wav$/i.test(file.name) || file.type === 'audio/wav' || file.type === 'audio/x-wav' || file.type === 'audio/wave';
}

/**
 * WAV bytes for the on-device engines. WAV files pass through untouched
 * (the parser reads mono or stereo, 8/16/24/32-bit and float); other formats
 * are decoded by the browser and mixed to mono for analysis.
 */
async function toAnalysisWav(file: File): Promise<ArrayBuffer> {
  const raw = await file.arrayBuffer();
  if (isWav(file)) return raw;
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(raw);
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }
    return encodeMonoWav(mono, decoded.sampleRate);
  } finally {
    void ctx.close();
  }
}

let worker: Worker | null = null;
let nextId = 0;

type WorkerJob =
  | { kind: 'analyze'; wav: ArrayBuffer; fileName: string; hopMs: number }
  | { kind: 'visual'; wav: ArrayBuffer; fps: number };

function runInWorker(job: WorkerJob): Promise<MathEngineAnalysis | VisualReport> {
  worker ??= new Worker(new URL('./analysisWorker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  const id = ++nextId;
  // Transfer a copy: the caller still needs its buffer for the other job.
  const wav = job.wav.slice(0);
  const request = { ...job, id, wav } as WorkerRequest;
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      worker = null;
      w.terminate();
      reject(new Error(event.message || 'Analysis failed.'));
    };
    const cleanup = () => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage(request, [wav]);
  });
}

type ServerReport = MathEngineAnalysis & { visual: VisualReport };

/**
 * Upload to the server. Resolves null when the server can't do it (not
 * deployed, offline, or an older server), so the caller falls back to the
 * device. Throws AudioRejected when the server says the audio is unreadable.
 */
async function analyzeOnServer(body: Blob | ArrayBuffer, fileName: string, type: string): Promise<ServerReport | null> {
  const q = new URLSearchParams({
    filename: fileName,
    include_series: 'true',
    include_visual: 'true',
    fps: String(VISUAL_FPS),
  });
  let res: Response;
  try {
    res = await fetch(`/api/analyze?${q}`, {
      method: 'POST',
      headers: { 'Content-Type': type || 'application/octet-stream' },
      body,
    });
  } catch {
    return null;
  }
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) return null;
  const json = (await res.json()) as Partial<ServerReport> & { error?: string };
  if (res.status === 400) throw new AudioRejected(json.error || 'Could not read this audio.');
  if (!res.ok || !json.visual) return null; // e.g. the Node dev server, which has no visual engine
  return json as ServerReport;
}

async function analyzeOnDevice(file: File): Promise<TrackAnalysis> {
  const wav = await toAnalysisWav(file);
  const [analysis, visual] = await Promise.all([
    runInWorker({ kind: 'analyze', wav, fileName: file.name, hopMs: 50 }) as Promise<MathEngineAnalysis>,
    runInWorker({ kind: 'visual', wav, fps: VISUAL_FPS }) as Promise<VisualReport>,
  ]);
  return { analysis, visual, source: 'device' };
}

export async function analyzeTrack(file: File): Promise<TrackAnalysis> {
  if (isNativeApp()) return analyzeOnDevice(file);
  let report: ServerReport | null;
  try {
    report = await analyzeOnServer(file, file.name, file.type);
  } catch (err) {
    // The server can't decode some formats the browser can (e.g. M4A/AAC):
    // decode here and upload that instead. A WAV it can't read is truly bad.
    if (!(err instanceof AudioRejected) || isWav(file)) throw err;
    report = await analyzeOnServer(await toAnalysisWav(file), file.name, 'audio/wav');
  }
  if (!report) return analyzeOnDevice(file);
  const { visual, ...analysis } = report;
  return { analysis: analysis as MathEngineAnalysis, visual, source: 'server' };
}
