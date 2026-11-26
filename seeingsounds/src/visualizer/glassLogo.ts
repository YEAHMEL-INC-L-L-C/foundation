// The Seeing Sounds "SS" mark drawn as glass: a glossy top highlight, a
// light reflection that sweeps across the letters, ambient colour from the
// music, depth shading, and a faded mirror reflection underneath.
// Deterministic: the same time and inputs always draw the same picture, so
// exported videos match the live view.

type RGB = [number, number, number];
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface GlassOptions {
  /** Ambient light colour, e.g. the visualizer's current colour. */
  tint?: RGB;
  /** 0..1: how lit up the glass is (overall energy). */
  energy?: number;
  /** Draw the mirror reflection below the mark. */
  reflection?: boolean;
}

const scratch = new Map<string, AnyCanvas>();

function getScratch(key: string, size: number): { c: AnyCanvas; g: Ctx2D } {
  let c = scratch.get(key);
  if (!c || c.width !== size) {
    c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : document.createElement('canvas');
    c.width = size;
    c.height = size;
    scratch.set(key, c);
  }
  const g = c.getContext('2d') as Ctx2D;
  return { c, g };
}

const rgba = ([r, g, b]: RGB, a: number) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;

/** Render the glass mark into a square scratch canvas of `size` pixels. */
function renderGlass(mark: CanvasImageSource, size: number, t: number, tint: RGB, energy: number): AnyCanvas {
  const { c, g } = getScratch('glass', size);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.clearRect(0, 0, size, size);

  // Glass body: slightly translucent, so the background glow shows through.
  g.globalAlpha = 0.9;
  g.drawImage(mark, 0, 0, size, size);
  g.globalAlpha = 1;

  // Everything below paints only where the letters are.
  g.globalCompositeOperation = 'source-atop';

  // Ambient light from the music.
  g.fillStyle = rgba(tint, 0.14 + 0.22 * energy);
  g.fillRect(0, 0, size, size);

  // Depth: darker toward the bottom edge.
  const depth = g.createLinearGradient(0, size * 0.45, 0, size);
  depth.addColorStop(0, 'rgba(0, 0, 0, 0)');
  depth.addColorStop(1, 'rgba(0, 0, 0, 0.32)');
  g.fillStyle = depth;
  g.fillRect(0, 0, size, size);

  // Gloss: the bright upper curve of a glass surface.
  const gloss = g.createLinearGradient(0, 0, 0, size * 0.55);
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
  gloss.addColorStop(0.45, 'rgba(255, 255, 255, 0.18)');
  gloss.addColorStop(0.5, 'rgba(255, 255, 255, 0.04)');
  gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = gloss;
  g.fillRect(0, 0, size, size * 0.55);

  // Specular sweep: a diagonal band of light crossing every ~4.5 s.
  const phase = ((t / 4.5) % 1) * 1.8 - 0.4; // -0.4 .. 1.4, off-mark at both ends
  const x0 = phase * size;
  const sweep = g.createLinearGradient(x0 - size * 0.35, 0, x0 + size * 0.35, size * 0.6);
  sweep.addColorStop(0, 'rgba(255, 255, 255, 0)');
  sweep.addColorStop(0.42, 'rgba(255, 255, 255, 0)');
  sweep.addColorStop(0.5, `rgba(255, 255, 255, ${0.45 + 0.35 * energy})`);
  sweep.addColorStop(0.58, 'rgba(255, 255, 255, 0)');
  sweep.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = sweep;
  g.fillRect(0, 0, size, size);

  // Caustic shimmer: soft light pools drifting inside the glass.
  for (let k = 0; k < 3; k++) {
    const cx = size * (0.3 + 0.4 * (0.5 + 0.5 * Math.sin(t * (0.5 + k * 0.17) + k * 2.1)));
    const cy = size * (0.35 + 0.35 * (0.5 + 0.5 * Math.cos(t * (0.4 + k * 0.13) + k * 1.3)));
    const pool = g.createRadialGradient(cx, cy, 0, cx, cy, size * 0.22);
    pool.addColorStop(0, `rgba(255, 255, 255, ${0.08 + 0.1 * energy})`);
    pool.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = pool;
    g.fillRect(0, 0, size, size);
  }

  g.globalCompositeOperation = 'source-over';
  return c;
}

/**
 * Draw the glass mark centred at (cx, cy), `size` pixels square, at time t.
 * With `reflection`, a faded mirror image is drawn below, extending 30% of size.
 */
export function drawGlassMark(
  ctx: CanvasRenderingContext2D,
  mark: HTMLImageElement | null,
  cx: number,
  cy: number,
  size: number,
  t: number,
  opts: GlassOptions = {}
) {
  if (!mark || !mark.complete || mark.naturalWidth === 0 || size < 2) return;
  const tint = opts.tint ?? [240, 228, 205];
  const energy = Math.max(0, Math.min(1, opts.energy ?? 0.25));
  const px = Math.max(16, Math.round(size));
  const glass = renderGlass(mark, px, t, tint, energy);

  // A gentle float, and a lift with the energy.
  const bob = Math.sin(t * 1.3) * size * 0.012;
  const s = size * (1 + 0.035 * energy);
  const x = cx - s / 2;
  const y = cy - s / 2 + bob;

  // Ambient glow behind the glass.
  ctx.save();
  const glow = ctx.createRadialGradient(cx, cy, s * 0.1, cx, cy, s * 0.75);
  glow.addColorStop(0, rgba(tint, 0.18 + 0.3 * energy));
  glow.addColorStop(1, rgba(tint, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(cx - s, cy - s, s * 2, s * 2);

  ctx.drawImage(glass as CanvasImageSource, x, y, s, s);

  if (opts.reflection) {
    // Mirror image under the mark, fading out like a glossy floor.
    const { c: rc, g: rg } = getScratch('reflection', px);
    rg.globalCompositeOperation = 'source-over';
    rg.clearRect(0, 0, px, px);
    rg.save();
    rg.translate(0, px);
    rg.scale(1, -1);
    rg.drawImage(glass as CanvasImageSource, 0, 0, px, px);
    rg.restore();
    rg.globalCompositeOperation = 'destination-in';
    const fade = rg.createLinearGradient(0, 0, 0, px * 0.3);
    fade.addColorStop(0, 'rgba(0, 0, 0, 0.32)');
    fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    rg.fillStyle = fade;
    rg.fillRect(0, 0, px, px);
    rg.globalCompositeOperation = 'source-over';
    ctx.drawImage(rc as CanvasImageSource, x, y + s - bob * 2 + s * 0.01, s, s);
  }
  ctx.restore();
}
