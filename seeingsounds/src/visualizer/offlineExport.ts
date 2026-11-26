// Frame-by-frame video export.
//
// Each frame is drawn at its exact timestamp (frame n at n / fps seconds),
// encoded with the browser's WebCodecs encoders, and muxed with the track's
// audio. Nothing is tied to a playback clock, so a slow computer only makes
// the export take longer: no frames are dropped and the file has a constant
// frame rate. The visuals come from the same drawVisual() as the live view.
import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  Quality as EncodeQuality,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
} from 'mediabunny';
import type { AudioCodec, VideoCodec } from 'mediabunny';
import type { VisualReport } from '../engine/visualizerMath.ts';
import { drawOutro, drawVisual } from './render.ts';

export interface OfflinePlan {
  container: 'mp4' | 'mov' | 'webm';
  video: VideoCodec;
  audio: AudioCodec;
  /** Sample rate the audio is encoded at. */
  sampleRate: number;
}

const AUDIO_BITRATE = 320_000;

/**
 * Best format this browser can encode, in order of preference:
 * 1. MP4, H.264 + AAC 320 kbps: what phones and social apps expect.
 * 2. MOV, H.264 + 24-bit PCM: lossless audio, for browsers without an AAC encoder.
 * 3. WebM, VP9 or AV1 + Opus 320 kbps.
 * Returns null when none is available (the caller then records in real time).
 */
export async function pickOfflinePlan(
  width: number,
  height: number,
  fps: number,
  videoBitrate: number,
  channels: number,
  sourceRate: number
): Promise<OfflinePlan | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  const video = async (codec: VideoCodec) =>
    canEncodeVideo(codec, { width, height, frameRate: fps, quality: new EncodeQuality({ bitrate: videoBitrate }) });
  const audio = async (codec: AudioCodec, sampleRate: number) =>
    canEncodeAudio(codec, {
      numberOfChannels: channels,
      sampleRate,
      quality: new EncodeQuality({ bitrate: AUDIO_BITRATE }),
    });

  if (await video('avc')) {
    for (const rate of [sourceRate, 48000, 44100]) {
      if (await audio('aac', rate)) return { container: 'mp4', video: 'avc', audio: 'aac', sampleRate: rate };
    }
    if (await audio('pcm-s24', sourceRate)) return { container: 'mov', video: 'avc', audio: 'pcm-s24', sampleRate: sourceRate };
  }
  for (const codec of ['vp9', 'av1'] as const) {
    if ((await video(codec)) && (await audio('opus', 48000))) {
      return { container: 'webm', video: codec, audio: 'opus', sampleRate: 48000 };
    }
  }
  return null;
}

/** Decode the file's audio at a given sample rate, keeping every channel. */
export async function decodeAt(file: Blob, sampleRate: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 1, sampleRate);
  return ctx.decodeAudioData(await file.arrayBuffer());
}

export interface OfflineRenderOptions {
  plan: OfflinePlan;
  audio: AudioBuffer;
  report: VisualReport;
  fileName: string;
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  outroSeconds: number;
  mark: HTMLImageElement | null;
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}

const MIME: Record<OfflinePlan['container'], string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

export async function renderOffline(opts: OfflineRenderOptions): Promise<Blob> {
  const { plan, audio, width: w, height: h, fps } = opts;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create a drawing canvas.');

  const format =
    plan.container === 'mp4'
      ? new Mp4OutputFormat({ fastStart: 'in-memory' })
      : plan.container === 'mov'
        ? new MovOutputFormat({ fastStart: 'in-memory' })
        : new WebMOutputFormat();
  const target = new BufferTarget();
  const output = new Output({ format, target });
  const videoSource = new CanvasSource(canvas, {
    codec: plan.video,
    quality: new EncodeQuality({ bitrate: opts.videoBitrate }),
    keyFrameInterval: 1,
  });
  const audioSource = new AudioBufferSource({
    codec: plan.audio,
    quality: new EncodeQuality({ bitrate: AUDIO_BITRATE }),
  });
  output.addVideoTrack(videoSource, { frameRate: fps });
  output.addAudioTrack(audioSource);

  const abort = () => new DOMException('Export cancelled.', 'AbortError');
  try {
    await output.start();

    // Audio: the whole track, then silence under the outro card.
    await audioSource.add(audio);
    const silence = new AudioBuffer({
      length: Math.round(opts.outroSeconds * audio.sampleRate),
      numberOfChannels: audio.numberOfChannels,
      sampleRate: audio.sampleRate,
    });
    await audioSource.add(silence);
    audioSource.close();

    // Video: every frame at its exact timestamp.
    const songFrames = Math.round(audio.duration * fps);
    const total = songFrames + Math.round(opts.outroSeconds * fps);
    const dt = 1 / fps;
    for (let i = 0; i < total; i++) {
      if (opts.signal.aborted) throw abort();
      const t = i / fps;
      if (i < songFrames) drawVisual(ctx, w, h, opts.report, t, opts.fileName, opts.mark);
      else drawOutro(ctx, w, h, (i - songFrames) / (total - songFrames - 1 || 1), opts.mark);
      await videoSource.add(t, dt);
      if (i % 15 === 0) {
        opts.onProgress(i / total);
        // Let the page repaint the progress bar.
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    videoSource.close();
    await output.finalize();
    opts.onProgress(1);
  } catch (err) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {});
    throw err;
  }
  if (!target.buffer) throw new Error('The video encoder produced no data.');
  return new Blob([target.buffer], { type: MIME[plan.container] });
}

export const EXTENSION: Record<OfflinePlan['container'], string> = { mp4: 'mp4', mov: 'mov', webm: 'webm' };
