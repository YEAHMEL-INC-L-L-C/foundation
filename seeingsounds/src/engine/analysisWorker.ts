/// <reference lib="webworker" />
// Runs the math and visual engines off the main thread so long tracks don't
// freeze the UI. Used whenever analysis happens on the device: always in the
// desktop and iOS app, and on the web when the server can't be reached.
import { analyzeAudioSamples } from './mathEngine.ts';
import type { MathEngineAnalysis } from './mathEngine.ts';
import { computeVisualReport } from './visualizerMath.ts';
import type { VisualReport } from './visualizerMath.ts';
import { parseWavBuffer } from './wavParser.ts';

export type WorkerRequest =
  | { id: number; kind: 'analyze'; wav: ArrayBuffer; fileName: string; hopMs: number }
  | { id: number; kind: 'visual'; wav: ArrayBuffer; fps: number };

export type WorkerResponse =
  | { id: number; ok: true; kind: 'analyze'; result: MathEngineAnalysis }
  | { id: number; ok: true; kind: 'visual'; result: VisualReport }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  let response: WorkerResponse;
  try {
    const parsed = parseWavBuffer(req.wav);
    response =
      req.kind === 'analyze'
        ? { id: req.id, ok: true, kind: 'analyze', result: analyzeAudioSamples(parsed.mono, parsed.sampleRate, req.fileName, req.hopMs) }
        : { id: req.id, ok: true, kind: 'visual', result: computeVisualReport(parsed.mono, parsed.sampleRate, req.fps) };
  } catch (err) {
    response = { id: req.id, ok: false, error: err instanceof Error ? err.message : 'Audio analysis failed.' };
  }
  ctx.postMessage(response);
};
