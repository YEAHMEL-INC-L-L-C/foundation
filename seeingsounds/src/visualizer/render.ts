// Draws one moment of the Seeing Sounds visualizer onto a 2D canvas.
// Used both by the live 60 fps view and by video export, so exports look
// exactly like what plays on screen. Everything here is deterministic: the
// same report and time always draw the same picture.
import type { VisualReport } from '../engine/visualizerMath.ts';
import { canvasFont, DEFAULT_DESIGN, fontChoice, paletteRgb } from '../design/settings.ts';
import type { DesignSettings } from '../design/settings.ts';
import { drawGlassMark } from './glassLogo.ts';

export const BACKGROUND = '#0e0d0b';
const CREAM = '#f0e4cd';
const UI_FONT = '"Archivo Variable", ui-sans-serif, system-ui, sans-serif';

export interface DrawOptions {
  /** Song title; the file name is used when the design leaves it empty. */
  fileName?: string;
  mark?: HTMLImageElement | null;
  design?: DesignSettings;
}

type RGB = [number, number, number];
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
  vox: number;
  high: number;
  color: RGB;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/**
 * Frame values at time t (seconds), interpolated between the report's frames.
 * With a design, the colour is re-blended from the band signals using the
 * design's palette (same weights as the engines), so custom colours apply.
 */
export function frameAt(report: VisualReport, t: number, design?: DesignSettings): FrameState {
  const { frames, signals, nf, fps } = report;
  const pos = Math.max(0, Math.min(nf - 1, t * fps));
  const i = Math.floor(pos);
  const j = Math.min(nf - 1, i + 1);
  const f = pos - i;
  const mix = (arr: number[]) => lerp(arr[i] ?? 0, arr[j] ?? 0, f);
  const ci = frames.color[i] ?? [0, 0, 0];
  const cj = frames.color[j] ?? ci;
  const bass = mix(signals.bass);
  const hit = mix(signals.hit);
  const vox = mix(signals.vox);
  const high = mix(signals.high);
  let color: RGB = [lerp(ci[0], cj[0], f), lerp(ci[1], cj[1], f), lerp(ci[2], cj[2], f)];
  if (design) {
    const p = paletteRgb(design);
    const weights: [RGB, number][] = [
      [p.green, 0.15],
      [p.red, bass],
      [p.yellow, hit],
      [p.pink, vox],
      [p.teal, high],
    ];
    const total = weights.reduce((acc, [, wgt]) => acc + wgt, 0);
    color = [0, 1, 2].map((k) => weights.reduce((acc, [c, wgt]) => acc + c[k] * wgt, 0) / total) as RGB;
  }
  return {
    x: mix(frames.orb_x),
    y: mix(frames.orb_y),
    scale: mix(frames.orb_scale),
    ring: mix(frames.ring),
    sparkle: mix(frames.sparkle),
    glow: mix(frames.glow),
    bass,
    hit,
    vox,
    high,
    color,
  };
}

const rgba = ([r, g, b]: RGB, a: number) =>
  `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;

/** Draw the visualizer at time t. Canvas size is w x h in pixels. */
export function drawVisual(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  report: VisualReport,
  t: number,
  opts: DrawOptions = {}
) {
  const design = opts.design ?? DEFAULT_DESIGN;
  const mark = opts.mark ?? null;
  const palette = paletteRgb(design);
  const s = frameAt(report, t, design);
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
  ctx.strokeStyle = rgba(palette.pink, 0.35 + 0.6 * s.ring);
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

  // Labels: the brand mark bottom right, the artist and song bottom left.
  const fs = Math.max(11, m * 0.028);
  ctx.font = `600 ${fs}px ${UI_FONT}`;
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(240, 228, 205, 0.55)';
  ctx.textAlign = 'right';
  ctx.fillText('Seeing Sounds', w - fs, h - fs * 0.8);
  // Glass SS mark beside the wordmark, lit by the music.
  const textW = ctx.measureText('Seeing Sounds').width;
  const markSize = fs * 2.4;
  drawGlassMark(ctx, mark, w - fs - textW - markSize * 0.6, h - fs * 0.8 - fs * 0.55, markSize, t, {
    tint: s.color,
    energy: s.glow,
  });

  const title = (design.title.trim() || (opts.fileName ?? '').replace(/\.[^.]+$/, '')).trim();
  const font = fontChoice(design.font);
  ctx.textAlign = 'left';
  if (title) {
    ctx.font = canvasFont(font, fs * 1.9);
    ctx.fillStyle = CREAM;
    ctx.fillText(title, fs, h - fs * 0.8, w * 0.6);
  }
  if (design.artist.trim()) {
    ctx.font = `600 ${fs}px ${UI_FONT}`;
    ctx.fillStyle = rgba(palette.yellow, 0.9);
    ctx.fillText(design.artist.trim(), fs, h - fs * 0.8 - (title ? fs * 2.3 : 0), w * 0.6);
  }
}

/** Outro card. p runs 0..1 over the card's duration. */
export function drawOutro(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: number,
  mark: HTMLImageElement | null,
  design: DesignSettings = DEFAULT_DESIGN
) {
  const m = Math.min(w, h);
  const fade = Math.min(1, p / 0.25);
  const palette = paletteRgb(design);
  const font = fontChoice(design.font);
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = fade;
  const markSize = m * 0.34;
  const top = h / 2 - markSize * 0.78;
  // Glass mark with a mirror reflection; its light drifts through the palette.
  const cols = [palette.red, palette.pink, palette.teal, palette.yellow, palette.green];
  const f = (p * (cols.length - 1)) % (cols.length - 1);
  const a = cols[Math.floor(f)];
  const b = cols[Math.min(cols.length - 1, Math.floor(f) + 1)];
  const k = f - Math.floor(f);
  const tint: RGB = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  // The sweep starts mid-mark so a short card still shows one full reflection.
  drawGlassMark(ctx, mark, w / 2, top + markSize / 2, markSize, 2.0 + p * 4.5, { tint, energy: 0.55, reflection: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const small = m * 0.034;
  const big = m * 0.075;
  let y = top + markSize * 1.33;
  if (design.outroTop.trim()) {
    ctx.fillStyle = 'rgba(240, 228, 205, 0.7)';
    ctx.font = `500 ${small}px ${UI_FONT}`;
    ctx.fillText(design.outroTop.trim(), w / 2, y, w * 0.9);
    y += small * 1.4;
  }
  if (design.outroBrand.trim()) {
    ctx.fillStyle = CREAM;
    ctx.font = canvasFont(font, big);
    ctx.fillText(design.outroBrand.trim(), w / 2, y, w * 0.9);
    y += big * 1.4;
  }
  if (design.artist.trim()) {
    ctx.fillStyle = rgba(palette.yellow, 1);
    ctx.font = `700 ${small * 1.2}px ${UI_FONT}`;
    ctx.fillText(design.artist.trim(), w / 2, y, w * 0.9);
  }
  ctx.globalAlpha = 1;
}
