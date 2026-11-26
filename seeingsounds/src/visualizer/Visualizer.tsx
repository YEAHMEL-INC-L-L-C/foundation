import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Download, Film, LoaderCircle, Share2, X } from 'lucide-react';
import type { VisualReport } from '../engine/visualizerMath.ts';
import { ensureFont, fontChoice } from '../design/settings.ts';
import type { DesignSettings } from '../design/settings.ts';
import markUrl from './ss-mark.png';
import { drawVisual } from './render.ts';
import { canExport, exportVideo, OUTRO_SECONDS, shareOrDownload } from './exportVideo.ts';
import type { Aspect, Quality } from './exportVideo.ts';

interface Props {
  report: VisualReport;
  audioRef: RefObject<HTMLAudioElement | null>;
  file: File;
  fileName: string;
  sampleRate: number;
  design: DesignSettings;
}

const selectClass =
  'rounded-lg border border-[#2a261f] bg-[#16140f] px-2 py-2 text-sm text-[#f0e4cd] disabled:opacity-50';

function loadMark(): HTMLImageElement {
  const img = new Image();
  img.src = markUrl;
  return img;
}

export default function Visualizer({ report, audioRef, file, fileName, sampleRate, design }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mark = useMemo(loadMark, []);
  const [aspect, setAspect] = useState<Aspect>('landscape');
  const [quality, setQuality] = useState<Quality>('highest');
  const [progress, setProgress] = useState<number | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const canRecord = useMemo(canExport, []);
  const canShare = useMemo(() => typeof navigator !== 'undefined' && typeof navigator.canShare === 'function', []);

  // Live view: redraw every animation frame (60 fps on most screens) at the
  // audio's current time, so the picture follows playback and seeking.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      drawVisual(ctx, w, h, report, audioRef.current?.currentTime ?? 0, { fileName, mark, design });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [report, audioRef, fileName, mark, design]);

  useEffect(() => {
    void ensureFont(fontChoice(design.font));
  }, [design.font]);

  // A new track invalidates any finished or running export.
  useEffect(() => {
    abortRef.current?.abort();
    setVideo(null);
    setMessage(null);
    setProgress(null);
  }, [file]);

  const startExport = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setVideo(null);
    setMessage(null);
    setProgress(0);
    try {
      const started = performance.now();
      const result = await exportVideo({
        file,
        fileName,
        sampleRate,
        design,
        report,
        aspect,
        quality,
        mark,
        onProgress: setProgress,
        signal: controller.signal,
      });
      setVideo(result.file);
      const secs = Math.round((performance.now() - started) / 1000);
      setMessage(
        `Your video is ready: ${(result.file.size / 1024 / 1024).toFixed(1)} MB, ${result.codecs}, ` +
          (result.method === 'frame-by-frame'
            ? `rendered frame by frame in ${secs} s (no dropped frames).`
            : `recorded in real time in ${secs} s (this browser can't render frame by frame, so a slow computer may drop frames).`)
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') setMessage('Export cancelled.');
      else setMessage(err instanceof Error ? err.message : 'Could not export the video.');
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const exporting = progress !== null;
  const minutes = Math.ceil((report.nf / report.fps + OUTRO_SECONDS) / 60);

  return (
    <section>
      <h2 className="font-display-wide mb-2 text-xl">Visualizer</h2>
      <canvas
        ref={canvasRef}
        className="aspect-video w-full rounded-xl border border-[#2a261f] bg-[#0e0d0b]"
        aria-label="Animated visualizer that follows the track"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className={selectClass} value={aspect} disabled={exporting} onChange={(e) => setAspect(e.target.value as Aspect)}>
          <option value="landscape">Landscape 16:9</option>
          <option value="vertical">Vertical 9:16 (Reels, TikTok)</option>
          <option value="square">Square 1:1</option>
        </select>
        <select className={selectClass} value={quality} disabled={exporting} onChange={(e) => setQuality(e.target.value as Quality)}>
          <option value="highest">Highest (1080p, 60 fps)</option>
          <option value="standard">Standard (720p, 30 fps)</option>
        </select>
        {exporting ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="flex items-center gap-2 rounded-lg border border-[#2a261f] px-3 py-2 text-sm hover:bg-[#1e1a12]"
          >
            <X className="h-4 w-4" /> Cancel
          </button>
        ) : (
          <button
            type="button"
            disabled={!canRecord}
            onClick={() => void startExport()}
            className="flex items-center gap-2 rounded-lg bg-[#e8a84c] px-3 py-2 text-sm font-medium text-[#0e0d0b] hover:bg-[#f0b965] disabled:opacity-50"
          >
            <Film className="h-4 w-4" /> Export video
          </button>
        )}
        {video && !exporting && (
          <>
            {canShare && (
              <button
                type="button"
                onClick={() => void shareOrDownload(video)}
                className="flex items-center gap-2 rounded-lg border border-[#2a261f] px-3 py-2 text-sm hover:bg-[#1e1a12]"
              >
                <Share2 className="h-4 w-4" /> Share
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const url = URL.createObjectURL(video);
                const a = document.createElement('a');
                a.href = url;
                a.download = video.name;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
              }}
              className="flex items-center gap-2 rounded-lg border border-[#2a261f] px-3 py-2 text-sm hover:bg-[#1e1a12]"
            >
              <Download className="h-4 w-4" /> Download
            </button>
          </>
        )}
      </div>
      {exporting && (
        <div className="mt-3">
          <div className="h-1.5 rounded bg-[#2a261f]">
            <div className="h-1.5 rounded bg-[#e8a84c]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-[#9c8f78]">
            <LoaderCircle className="h-3 w-3 animate-spin" />
            Rendering your video ({Math.round((progress ?? 0) * 100)}%). Keep this window open. Song plus outro: about {minutes} min of video.
          </div>
        </div>
      )}
      {!canRecord && <div className="mt-2 text-xs text-[#9c8f78]">Video export needs a browser that can encode video, such as Chrome, Edge or Safari.</div>}
      {message && <div className="mt-2 text-sm text-[#9c8f78]">{message}</div>}
      <div className="mt-1 text-xs text-[#9c8f78]">
        Exports end with a {OUTRO_SECONDS}-second "Powered by Seeing Sounds / YeahMel" card. Every frame is rendered at its exact time, so nothing is dropped however long it takes. Audio comes from your original file, in stereo.
      </div>
    </section>
  );
}
