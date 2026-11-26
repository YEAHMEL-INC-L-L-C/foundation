// Exports the visualizer, with the track's audio, as a video file ending on a
// "Powered by Seeing Sounds / YeahMel" outro card.
//
// The normal path renders frame by frame (offlineExport.ts): constant frame
// rate, no dropped frames, as fast as the computer allows. Browsers without
// WebCodecs encoders fall back to recording the canvas in real time with
// MediaRecorder, which can drop frames on a slow computer.
import fixWebmDuration from 'fix-webm-duration';
import type { VisualReport } from '../engine/visualizerMath.ts';
import { decodeAt, EXTENSION, pickOfflinePlan, renderOffline } from './offlineExport.ts';
import { drawOutro, drawVisual } from './render.ts';

export type Aspect = 'landscape' | 'vertical' | 'square';
export type Quality = 'highest' | 'standard';

export const OUTRO_SECONDS = 4;

const SIZES: Record<Quality, Record<Aspect, [number, number]>> = {
  highest: { landscape: [1920, 1080], vertical: [1080, 1920], square: [1080, 1080] },
  standard: { landscape: [1280, 720], vertical: [720, 1280], square: [720, 720] },
};
const FPS: Record<Quality, number> = { highest: 60, standard: 30 };
const VIDEO_BITRATE: Record<Quality, number> = { highest: 16_000_000, standard: 6_000_000 };
// The highest audio bitrate browsers' recorders accept for AAC and Opus.
const AUDIO_BITRATE = 320_000;

// MP4 only when it is H.264 + AAC, which phones and social apps accept.
// Chromium builds without H.264 would otherwise put VP9 inside an .mp4, which
// many players reject, so they get a correctly labelled WebM instead. Older
// Safari reports only the bare 'video/mp4' type, and records H.264 + AAC with it.
const MIME_TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.4d0028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

/** True when some export path exists in this browser. */
export function canExport(): boolean {
  return typeof VideoEncoder !== 'undefined' || pickMimeType() !== null;
}

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export interface ExportOptions {
  file: Blob;
  fileName: string;
  /** The track's own sample rate, kept in the export where the codec allows. */
  sampleRate: number;
  report: VisualReport;
  aspect: Aspect;
  quality: Quality;
  mark: HTMLImageElement | null;
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}

export type ExportMethod = 'frame-by-frame' | 'real-time';

export interface ExportResult {
  file: File;
  method: ExportMethod;
  /** Human-readable codecs, e.g. "H.264 + AAC". */
  codecs: string;
}

const CODEC_NAMES: Record<string, string> = {
  avc: 'H.264',
  vp9: 'VP9',
  av1: 'AV1',
  aac: 'AAC 320 kbps',
  opus: 'Opus 320 kbps',
  'pcm-s24': '24-bit PCM (lossless)',
};

function outputName(fileName: string, ext: string) {
  return `${fileName.replace(/\.[^.]+$/, '') || 'track'} - Seeing Sounds.${ext}`;
}

export async function exportVideo(opts: ExportOptions): Promise<ExportResult> {
  const [w, h] = SIZES[opts.quality][opts.aspect];
  const fps = FPS[opts.quality];
  const bitrate = VIDEO_BITRATE[opts.quality];
  if (opts.mark && !opts.mark.complete) await opts.mark.decode().catch(() => {});

  const original = await decodeAt(opts.file, opts.sampleRate);
  if (opts.signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
  const plan = await pickOfflinePlan(w, h, fps, bitrate, original.numberOfChannels, original.sampleRate);
  if (plan) {
    const audio = plan.sampleRate === original.sampleRate ? original : await decodeAt(opts.file, plan.sampleRate);
    const blob = await renderOffline({
      plan,
      audio,
      report: opts.report,
      fileName: opts.fileName,
      width: w,
      height: h,
      fps,
      videoBitrate: bitrate,
      outroSeconds: OUTRO_SECONDS,
      mark: opts.mark,
      onProgress: opts.onProgress,
      signal: opts.signal,
    });
    return {
      file: new File([blob], outputName(opts.fileName, EXTENSION[plan.container]), { type: blob.type }),
      method: 'frame-by-frame',
      codecs: `${CODEC_NAMES[plan.video] ?? plan.video} + ${CODEC_NAMES[plan.audio] ?? plan.audio}`,
    };
  }
  const file = await recordRealtime(opts);
  return { file, method: 'real-time', codecs: file.type === 'video/mp4' ? 'H.264 + AAC' : 'WebM' };
}

/** Fallback: record the canvas while the audio plays (silently) in real time. */
async function recordRealtime(opts: ExportOptions): Promise<File> {
  const mimeType = pickMimeType();
  if (!mimeType) throw new Error('This browser cannot record video. Try Chrome, Edge or Safari.');

  // Created before any await so the browser counts it as part of the click.
  const audioCtx = new AudioContext({ latencyHint: 'playback' });
  const [w, h] = SIZES[opts.quality][opts.aspect];
  const fps = FPS[opts.quality];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a drawing canvas.');

  let raf = 0;
  let recorder: MediaRecorder | null = null;
  let source: AudioBufferSourceNode | null = null;
  try {
    // Decode the original file: all channels at full resolution.
    const buffer = await audioCtx.decodeAudioData(await opts.file.arrayBuffer());
    if (opts.signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
    await audioCtx.resume();

    const dest = audioCtx.createMediaStreamDestination();
    dest.channelCount = Math.min(2, buffer.numberOfChannels);
    source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(dest);

    drawVisual(ctx, w, h, opts.report, 0, opts.fileName, opts.mark);
    const stream = canvas.captureStream(fps);
    for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);

    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: VIDEO_BITRATE[opts.quality],
      audioBitsPerSecond: AUDIO_BITRATE,
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder!.onstop = () => resolve();
    });

    const duration = buffer.duration;
    const total = duration + OUTRO_SECONDS;
    recorder.start(1000);
    const t0 = audioCtx.currentTime + 0.15;
    source.start(t0);

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Export cancelled.', 'AbortError'));
      opts.signal.addEventListener('abort', onAbort, { once: true });
      const tick = () => {
        const t = audioCtx.currentTime - t0;
        if (t < duration) {
          drawVisual(ctx, w, h, opts.report, Math.max(0, t), opts.fileName, opts.mark);
        } else {
          drawOutro(ctx, w, h, Math.min(1, (t - duration) / OUTRO_SECONDS), opts.mark);
        }
        opts.onProgress(Math.max(0, Math.min(1, t / total)));
        if (t >= total) {
          opts.signal.removeEventListener('abort', onAbort);
          resolve();
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });

    recorder.stop();
    await stopped;
    const type = mimeType.split(';')[0];
    let video = new Blob(chunks, { type });
    if (type === 'video/webm') {
      // Browsers' WebM recordings carry no duration, so players can't show
      // the length or seek. Write it in.
      video = await fixWebmDuration(video, total * 1000, { logger: false });
    }
    return new File([video], outputName(opts.fileName, type === 'video/mp4' ? 'mp4' : 'webm'), { type });
  } finally {
    cancelAnimationFrame(raf);
    try {
      source?.stop();
    } catch {
      // never started
    }
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    void audioCtx.close();
  }
}

/** Opens the share sheet where the device supports sharing files, otherwise downloads. */
export async function shareOrDownload(file: File): Promise<'shared' | 'downloaded'> {
  const data = { files: [file], title: 'Seeing Sounds' };
  if (navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
      // Fall through to a download if sharing failed for another reason.
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}
