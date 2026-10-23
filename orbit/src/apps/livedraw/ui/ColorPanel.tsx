import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { SIcon } from './StudioIcon';
import { HARMONIES, PALETTES, harmony, hexToHsv, hsvToHex, isHex, normHex, type HSV, type Harmony } from './color';

const RING = 22;

/**
 * Colour: a wheel (hue round the ring, saturation and brightness in the square inside), the hex code,
 * the colours that go with it (harmonies), the last colours used, and palettes, your own included.
 */
export function ColorPanel({
  color,
  onColor,
  recent,
  mine,
  onMine,
}: {
  color: string;
  onColor: (hex: string) => void;
  recent: string[];
  mine: string[];
  onMine: (list: string[]) => void;
}) {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(color));
  const [mode, setMode] = useState<Harmony>('complementary');
  const [palette, setPalette] = useState<string>('basics');
  const [editMine, setEditMine] = useState(false);
  const [hex, setHex] = useState(color);
  const wheel = useRef<HTMLDivElement>(null);
  const dragging = useRef<'ring' | 'square' | null>(null);

  // A colour picked elsewhere (a swatch, the eyedropper) moves the wheel; the hue survives grey.
  useEffect(() => {
    setHex(color);
    if (normHex(hsvToHex(hsv)) !== normHex(color)) {
      const next = hexToHsv(color);
      setHsv((h) => (next.s === 0 || next.v === 0 ? { ...next, h: h.h } : next));
    }
  }, [color]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (next: HSV) => {
    setHsv(next);
    onColor(hsvToHex(next));
  };

  const at = (e: PointerEvent<HTMLDivElement>, start = false) => {
    const el = wheel.current!;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const R = r.width / 2;
    const d = Math.hypot(dx, dy);
    if (start) dragging.current = d > R - RING - 6 ? 'ring' : 'square';
    if (dragging.current === 'ring') {
      const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
      set({ ...hsv, h });
    } else {
      const half = (R - RING - 4) / Math.SQRT2;
      const s = Math.min(1, Math.max(0, (dx + half) / (2 * half)));
      const v = Math.min(1, Math.max(0, 1 - (dy + half) / (2 * half)));
      set({ ...hsv, s, v });
    }
  };

  const pal = palette === 'mine' ? mine : (PALETTES.find((p) => p.id === palette)?.colors ?? []);
  const hueRad = ((hsv.h - 90) * Math.PI) / 180;
  return (
    <div className="ldx-colour">
      <div className="ldx-colour-top">
        <div
          ref={wheel}
          className="ldx-wheel"
          role="group"
          aria-label="Colour wheel"
          style={{ ['--hue' as string]: `hsl(${hsv.h} 100% 50%)` }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            at(e, true);
          }}
          onPointerMove={(e) => e.buttons && dragging.current && at(e)}
          onPointerUp={() => (dragging.current = null)}
        >
          <div className="ldx-wheel-square" />
          <span className="ldx-wheel-hue" style={{ left: `calc(50% + ${Math.cos(hueRad)} * (50% - ${RING / 2}px))`, top: `calc(50% + ${Math.sin(hueRad)} * (50% - ${RING / 2}px))` }} />
          <span className="ldx-wheel-sv" style={{ left: `calc(50% + (${hsv.s} - 0.5) * 2 * var(--half))`, top: `calc(50% + (0.5 - ${hsv.v}) * 2 * var(--half))`, background: color }} />
        </div>
        <div className="ldx-colour-side">
          <span className="ldx-colour-now" style={{ background: color }} aria-hidden />
          <label className="ldx-hex">
            <span className="ldx-slider-label">Hex</span>
            <input
              className="ldx-input"
              value={hex}
              maxLength={7}
              spellCheck={false}
              aria-label="Colour code"
              onChange={(e) => {
                setHex(e.target.value);
                if (isHex(e.target.value)) onColor(normHex(e.target.value));
              }}
            />
          </label>
          <label className="ldx-hue-slider">
            <span className="ldx-slider-label">Hue</span>
            <input type="range" min={0} max={359} value={Math.round(hsv.h)} aria-label="Hue" onChange={(e) => set({ ...hsv, h: Number(e.target.value) })} />
          </label>
        </div>
      </div>

      <div className="ldx-chips" role="radiogroup" aria-label="Harmony">
        {HARMONIES.map((h) => (
          <button key={h.id} type="button" role="radio" className="ldx-chip" aria-checked={mode === h.id} onClick={() => setMode(h.id)}>
            {h.label}
          </button>
        ))}
      </div>
      <Swatches label="Colours that go with it" colors={harmony(color, mode)} current={color} onPick={onColor} />

      {recent.length > 0 && (
        <>
          <h4 className="ldx-sub">Recent</h4>
          <Swatches label="Recent colours" colors={recent} current={color} onPick={onColor} />
        </>
      )}

      <h4 className="ldx-sub">Palettes</h4>
      <div className="ldx-chips" role="radiogroup" aria-label="Palette">
        {[...PALETTES.map((p) => ({ id: p.id, name: p.name })), { id: 'mine', name: 'Mine' }].map((p) => (
          <button key={p.id} type="button" role="radio" className="ldx-chip" aria-checked={palette === p.id} onClick={() => setPalette(p.id)}>
            {p.name}
          </button>
        ))}
      </div>
      <div className="ldx-grid ldx-swatches" role="group" aria-label={`${palette === 'mine' ? 'My' : (PALETTES.find((p) => p.id === palette)?.name ?? '')} palette`}>
        {pal.map((c, i) => (
          <button
            key={c + i}
            type="button"
            className="ldx-swatch"
            data-remove={(palette === 'mine' && editMine) || undefined}
            aria-label={palette === 'mine' && editMine ? `Remove ${c}` : c}
            aria-pressed={normHex(c) === normHex(color)}
            onClick={() => (palette === 'mine' && editMine ? onMine(mine.filter((_, k) => k !== i)) : onColor(c))}
          >
            <span style={{ background: c }} />
          </button>
        ))}
        {palette === 'mine' && (
          <button type="button" className="ldx-tool ldx-tool-flat" aria-label="Add this colour to my palette" title="Add this colour" onClick={() => onMine([...mine.filter((c) => c !== normHex(color)), normHex(color)].slice(-40))}>
            <SIcon name="plus" size={20} />
          </button>
        )}
      </div>
      {palette === 'mine' && mine.length > 0 && (
        <button type="button" className="ldx-link" aria-pressed={editMine} onClick={() => setEditMine(!editMine)}>
          {editMine ? 'Done' : 'Remove colours'}
        </button>
      )}
      {palette === 'mine' && !mine.length && <p className="ldx-note">Your palette is empty: pick a colour, then tap + to keep it here.</p>}
    </div>
  );
}

function Swatches({ label, colors, current, onPick }: { label: string; colors: string[]; current: string; onPick: (c: string) => void }) {
  return (
    <div className="ldx-grid ldx-swatches" role="group" aria-label={label}>
      {colors.map((c, i) => (
        <button key={c + i} type="button" className="ldx-swatch" aria-label={c} aria-pressed={normHex(c) === normHex(current)} onClick={() => onPick(c)}>
          <span style={{ background: c }} />
        </button>
      ))}
    </div>
  );
}
