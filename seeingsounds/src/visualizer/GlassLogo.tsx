import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type { VisualReport } from '../engine/visualizerMath.ts';
import type { DesignSettings } from '../design/settings.ts';
import markUrl from './ss-mark.png';
import { drawGlassMark } from './glassLogo.ts';
import { frameAt } from './render.ts';

interface Props {
  /** CSS pixel size of the mark; the canvas adds room below for the reflection. */
  size: number;
  /** When given and the audio is playing, the glass takes its light from the music. */
  report?: VisualReport | null;
  audioRef?: RefObject<HTMLAudioElement | null>;
  design?: DesignSettings;
}

/** The SS mark as animated glass, for the app header. */
export default function GlassLogo({ size, report, audioRef, design }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mark = useMemo(() => {
    const img = new Image();
    img.src = markUrl;
    return img;
  }, []);
  const height = Math.round(size * 1.35);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let raf = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(size * dpr);
      const h = Math.round(height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);
      const audio = audioRef?.current;
      const playing = !!(report && audio && !audio.paused);
      const t = reduceMotion ? 1.5 : performance.now() / 1000;
      const state = playing ? frameAt(report!, audio!.currentTime, design) : null;
      drawGlassMark(ctx, mark, w / 2, (size * dpr) / 2, size * dpr * 0.78, t, {
        tint: state?.color ?? [240, 228, 205],
        energy: state ? state.glow : 0.2,
        reflection: true,
      });
      if (!reduceMotion) raf = requestAnimationFrame(draw);
    };
    if (mark.complete) draw();
    else mark.onload = draw;
    return () => cancelAnimationFrame(raf);
  }, [mark, size, height, report, audioRef, design]);

  return <canvas ref={canvasRef} style={{ width: size, height }} className="-mb-3 shrink-0" aria-hidden="true" />;
}
