import { RotateCcw } from 'lucide-react';
import { DEFAULT_DESIGN, DEFAULT_PALETTE, FONTS, PALETTE_LABELS } from './settings.ts';
import type { DesignSettings, PaletteKey } from './settings.ts';

interface Props {
  design: DesignSettings;
  onChange: (next: DesignSettings) => void;
  /** Shown as the title placeholder when no custom title is set. */
  defaultTitle: string;
}

const inputClass =
  'w-full rounded-lg border border-[#2a261f] bg-[#16140f] px-3 py-2 text-sm text-[#f0e4cd] placeholder:text-[#6f6553] focus:border-[#e8a84c] focus:outline-none';

const PALETTE_ORDER: PaletteKey[] = ['red', 'yellow', 'pink', 'teal', 'green'];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-[#b8ab92]">{label}</span>
      {children}
    </label>
  );
}

/** Edit the text, font and colours used by the visualizer and exported videos. */
export default function DesignPanel({ design, onChange, defaultTitle }: Props) {
  const set = (patch: Partial<DesignSettings>) => onChange({ ...design, ...patch });
  const setColor = (key: PaletteKey, value: string) => set({ palette: { ...design.palette, [key]: value } });

  return (
    <section aria-labelledby="design-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="design-heading" className="font-display-wide text-xl">
          Design
        </h2>
        <button
          type="button"
          onClick={() => onChange({ ...DEFAULT_DESIGN, palette: { ...DEFAULT_PALETTE } })}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-[#b8ab92] hover:bg-[#1e1a12] hover:text-[#f0e4cd]"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
        </button>
      </div>
      <p className="mb-4 max-w-prose text-sm text-[#9c8f78]">
        Changes show in the visualizer right away and in every video you export. They are saved on this device.
      </p>

      <div className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
        <div className="space-y-3">
          <Field label="Song title">
            <input
              className={inputClass}
              value={design.title}
              placeholder={defaultTitle}
              maxLength={80}
              onChange={(e) => set({ title: e.target.value })}
            />
          </Field>
          <Field label="Artist">
            <input className={inputClass} value={design.artist} maxLength={60} onChange={(e) => set({ artist: e.target.value })} />
          </Field>
          <Field label="Outro card, first line">
            <input className={inputClass} value={design.outroTop} maxLength={60} onChange={(e) => set({ outroTop: e.target.value })} />
          </Field>
          <Field label="Outro card, headline">
            <input
              className={inputClass}
              value={design.outroBrand}
              maxLength={40}
              onChange={(e) => set({ outroBrand: e.target.value })}
            />
          </Field>
        </div>

        <div className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm text-[#b8ab92]">Font for titles</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {FONTS.map((f) => {
                const selected = design.font === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => set({ font: f.id })}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                      selected ? 'border-[#e8a84c] bg-[#221c12]' : 'border-[#2a261f] bg-[#16140f] hover:border-[#4a4234]'
                    }`}
                  >
                    <span
                      className="block truncate text-2xl leading-tight text-[#f0e4cd]"
                      style={{ fontFamily: f.family, fontWeight: f.weight, fontStretch: f.stretch }}
                    >
                      {design.title.trim() || defaultTitle || 'Seeing Sounds'}
                    </span>
                    <span className="mt-0.5 block text-xs text-[#9c8f78]">{f.label}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm text-[#b8ab92]">Colours, and the sound each one follows</legend>
            <div className="flex flex-wrap gap-3">
              {PALETTE_ORDER.map((key) => (
                <label key={key} className="flex items-center gap-2 rounded-lg border border-[#2a261f] bg-[#16140f] py-1.5 pl-1.5 pr-3">
                  <input
                    type="color"
                    value={design.palette[key]}
                    onChange={(e) => setColor(key, e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded-md border-0 bg-transparent p-0"
                    aria-label={`${PALETTE_LABELS[key]} colour`}
                  />
                  <span className="text-sm">{PALETTE_LABELS[key]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </div>
    </section>
  );
}
