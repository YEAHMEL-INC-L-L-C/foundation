// The artist's design choices for the visualizer and exported videos: the
// text on screen, the font, and the five colours the visuals are built from.
// Saved in this browser (or desktop app) so they persist between sessions.
import '@fontsource/rubik-wet-paint';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/bungee';
import '@fontsource/permanent-marker';
import '@fontsource/dm-serif-display';

export type FontId = 'wet-paint' | 'archivo-wide' | 'bungee' | 'marker' | 'serif';
export type PaletteKey = 'red' | 'green' | 'yellow' | 'teal' | 'pink';

export interface FontChoice {
  id: FontId;
  label: string;
  /** CSS font-family list. */
  family: string;
  /** Weight for headline text (title, brand line). */
  weight: number;
  /** Font stretch for headline text, for fonts with a width axis. */
  stretch?: string;
  /** Size multiplier so different fonts look similarly sized. */
  scale: number;
}

export const FONTS: FontChoice[] = [
  { id: 'wet-paint', label: 'Wet Paint (drips)', family: '"Rubik Wet Paint", system-ui', weight: 400, scale: 1.05 },
  { id: 'archivo-wide', label: 'Archivo Expanded', family: '"Archivo Variable", system-ui', weight: 800, stretch: '125%', scale: 0.95 },
  { id: 'bungee', label: 'Bungee (signage)', family: '"Bungee", system-ui', weight: 400, scale: 0.9 },
  { id: 'marker', label: 'Permanent Marker', family: '"Permanent Marker", system-ui', weight: 400, scale: 1.05 },
  { id: 'serif', label: 'DM Serif Display', family: '"DM Serif Display", Georgia, serif', weight: 400, scale: 1.1 },
];

export interface DesignSettings {
  /** Title shown on the video; empty means "use the file name". */
  title: string;
  artist: string;
  outroTop: string;
  outroBrand: string;
  font: FontId;
  palette: Record<PaletteKey, string>;
}

export const DEFAULT_PALETTE: Record<PaletteKey, string> = {
  red: '#fc0114',
  green: '#04a053',
  yellow: '#fac814',
  teal: '#01a99e',
  pink: '#fc0471',
};

export const DEFAULT_DESIGN: DesignSettings = {
  title: '',
  artist: 'YeahMel',
  outroTop: 'Powered by',
  outroBrand: 'Seeing Sounds',
  font: 'wet-paint',
  palette: { ...DEFAULT_PALETTE },
};

export const PALETTE_LABELS: Record<PaletteKey, string> = {
  red: 'Bass',
  yellow: 'Hits',
  pink: 'Vocals',
  teal: 'Highs',
  green: 'Base',
};

const STORAGE_KEY = 'seeing-sounds.design.v1';

export function loadDesign(): DesignSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DESIGN, palette: { ...DEFAULT_PALETTE } };
    const saved = JSON.parse(raw) as Partial<DesignSettings>;
    return {
      ...DEFAULT_DESIGN,
      ...saved,
      font: FONTS.some((f) => f.id === saved.font) ? (saved.font as FontId) : DEFAULT_DESIGN.font,
      palette: { ...DEFAULT_PALETTE, ...(saved.palette ?? {}) },
    };
  } catch {
    return { ...DEFAULT_DESIGN, palette: { ...DEFAULT_PALETTE } };
  }
}

export function saveDesign(design: DesignSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
  } catch {
    // Private windows can block storage; the design still applies this session.
  }
}

export function fontChoice(id: FontId): FontChoice {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

/** Canvas font string for a choice at a pixel size. */
export function canvasFont(choice: FontChoice, px: number, weight = choice.weight): string {
  const stretch = choice.stretch ? `${choice.stretch === '125%' ? 'expanded' : 'normal'} ` : '';
  return `${stretch}${weight} ${Math.round(px * choice.scale)}px ${choice.family}`;
}

/** Make sure a font's files are loaded before drawing it on a canvas. */
export async function ensureFont(choice: FontChoice): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await document.fonts.load(canvasFont(choice, 48));
  } catch {
    // Falls back to the system font if loading fails.
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function paletteRgb(design: DesignSettings): Record<PaletteKey, [number, number, number]> {
  return {
    red: hexToRgb(design.palette.red),
    green: hexToRgb(design.palette.green),
    yellow: hexToRgb(design.palette.yellow),
    teal: hexToRgb(design.palette.teal),
    pink: hexToRgb(design.palette.pink),
  };
}
