// Draws one moment of the Seeing Sounds visualizer onto a 2D canvas.
// Used both by the live 60 fps view and by video export, so exports look
// exactly like what plays on screen. Everything here is deterministic: the
// same report and time always draw the same picture.
import type { VisualReport } from '../engine/visualizerMath.ts';

export const BACKGROUND = '#0e0d0b';
const CREAM = '#f0e4cd';
const SPARKLES = 64;
const DRIPS = 7;

export interface FrameState {
  x: number;
  y: number;
  scale: number;
  ring: number;
  sparkle: number;
  glow: number;
  bass: number;
  hit: number;
  color: [number, number, number];
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/** Frame values at time t (seconds), interpolated between the report's frames. */
export function frameAt(report: VisualReport, t: number): FrameState {
  const { frames, signals, nf, fps } = report;
  const pos = Math.max(0, Math.min(nf - 1, t * fps));
  const i = Math.floor(pos);
  const j = Math.min(nf - 1, i + 1);
  const f = pos - i;
  const mix = (arr: number[]) => lerp(arr[i] ?? 0, arr[j] ?? 0, f);
  const ci = frames.color[i] ?? [0, 0, 0];
  const cj = frames.color[j] ?? ci;
  return {
    x: mix(frames.orb_x),
    y: mix(frames.orb_y),
    scale: mix(frames.orb_scale),
    ring: mix(frames.ring),
    sparkle: mix(frames.sparkle),
    glow: mix(frames.glow),
    bass: mix(signals.bass),
    hit: mix(signals.hit),
    color: [lerp(ci[0], cj[0], f), lerp(ci[1], cj[1], f), lerp(ci[2], cj[2], f)],
  };
}

const rgba = ([r, g, b]: [number, number, number], a: number) =>
  `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;

/** Draw the visualizer at time t. Canvas size is w x h in pixels. */
export function drawVisual(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  report: VisualReport,
  t: number,
  title?: string
) {
  const s = frameAt(report, t);
  const m = Math.min(w, h);
  const cx = s.x * w;
  const cy = s.y * h;
  const R = s.scale * 0.22 * m;

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, w, h);

  // Glow behind the orb, brighter with overall energy.
  const glow = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * 3.2);
  glow.addColorStop(0, rgba(s.color, 0.18 + 0.4 * s.glow));
  glow.addColorStop(1, rgba(s.color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Sparkles at fixed positions (a low-discrepancy sequence), twinkling with the highs.
  for (let k = 0; k < SPARKLES; k++) {
    const px = ((k * 0.6180339887 + 0.13) % 1) * w;
    const py = ((k * 0.7548776662 + 0.37) % 1) * h;
    const tw = 0.5 + 0.5 * Math.sin(k * 1.7 + t * 5.0);
    const a = s.sparkle * tw;
    if (a < 0.02) continue;
    ctx.fillStyle = `rgba(240, 228, 205, ${Math.min(1, a)})`;
    ctx.beginPath();
    ctx.arc(px, py, m * (0.002 + 0.004 * a), 0, Math.PI * 2);
    ctx.fill();
  }

  // Vocal ring: a wobbling outline that swells with the vocal band.
  const ringR = R * 1.35;
  ctx.strokeStyle = rgba([252, 4, 113], 0.35 + 0.6 * s.ring);
  ctx.lineWidth = m * (0.003 + 0.01 * s.ring);
  ctx.beginPath();
  for (let k = 0; k <= 120; k++) {
    const th = (k / 120) * Math.PI * 2;
    const r = ringR + s.ring * 0.05 * m * Math.sin(6 * th + t * 3.0) * Math.sin(3 * th - t * 1.3);
    const px = cx + r * Math.cos(th);
    const py = cy + r * Math.sin(th);
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();

  // Drips under the orb, like the logo's lettering; longer with more bass.
  ctx.fillStyle = rgba(s.color, 1);
  for (let k = 0; k < DRIPS; k++) {
    const th = Math.PI / 2 + ((k - (DRIPS - 1) / 2) / DRIPS) * 1.9;
    const len = R * (0.12 + 0.55 * s.bass * (0.45 + 0.55 * Math.abs(Math.sin(k * 2.1 + 0.4))));
    const width = R * 0.12;
    const bx = cx + R * 0.92 * Math.cos(th);
    const by = cy + R * 0.92 * Math.sin(th);
    ctx.beginPath();
    ctx.moveTo(bx - width / 2, by);
    ctx.lineTo(bx - width / 2, by + len);
    ctx.arc(bx, by + len, width / 2, Math.PI, 0, true);
    ctx.lineTo(bx + width / 2, by);
    ctx.closePath();
    ctx.fill();
  }

  // The orb, with a lighter centre.
  const orb = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
  orb.addColorStop(0, rgba([Math.min(255, s.color[0] + 70), Math.min(255, s.color[1] + 70), Math.min(255, s.color[2] + 70)], 1));
  orb.addColorStop(1, rgba(s.color, 1));
  ctx.fillStyle = orb;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // Hits flash a thin cream rim.
  if (s.hit > 0.05) {
    ctx.strokeStyle = `rgba(240, 228, 205, ${Math.min(0.9, s.hit * 0.8)})`;
    ctx.lineWidth = m * 0.006;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.04, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Labels.
  const fs = Math.max(11, m * 0.028);
  ctx.font = `600 ${fs}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(240, 228, 205, 0.55)';
  ctx.textAlign = 'right';
  ctx.fillText('Seeing Sounds', w - fs, h - fs * 0.8);
  if (title) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(240, 228, 205, 0.8)';
    ctx.fillText(title.replace(/\.[^.]+$/, ''), fs, h - fs * 0.8, w * 0.6);
  }
}

/** Outro card. p runs 0..1 over the card's duration. */
export function drawOutro(ctx: CanvasRenderingContext2D, w: number, h: number, p: number, mark: HTMLImageElement | null) {
  const m = Math.min(w, h);
  const fade = Math.min(1, p / 0.25);
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = fade;
  const markSize = m * 0.34;
  const top = h / 2 - markSize * 0.78;
  if (mark && mark.complete && mark.naturalWidth > 0) {
    ctx.drawImage(mark, w / 2 - markSize / 2, top, markSize, markSize);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(240, 228, 205, 0.7)';
  const small = m * 0.034;
  ctx.font = `500 ${small}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText('Powered by', w / 2, top + markSize + m * 0.03);
  ctx.fillStyle = CREAM;
  const big = m * 0.07;
  ctx.font = `800 ${big}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText('Seeing Sounds', w / 2, top + markSize + m * 0.03 + small * 1.4);
  ctx.fillStyle = '#e8a84c';
  ctx.font = `700 ${small * 1.2}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText('YeahMel', w / 2, top + markSize + m * 0.03 + small * 1.4 + big * 1.25);
  ctx.globalAlpha = 1;
}
