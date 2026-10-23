import { useRef, useState, type PointerEvent } from 'react';
import { motion } from 'motion/react';
import { useMotionLevel } from '../../../motion/MotionProvider';
import { transitionFor } from '../../../motion/springs';
import { OrbSpot } from '../../../studio/Sheets';
import { Slider } from '../panels';
import { SIcon } from '../ui/StudioIcon';
import { BrushPreview } from './BrushPreview';
import { bezierY } from './dynamics';
import type { Brush, BrushMode, Dyn, GrainKind, RotationMode, ShapeKind } from './types';

type Tab = 'stroke' | 'tip' | 'grain' | 'dynamics' | 'paint';
const TABS: { id: Tab; label: string }[] = [
  { id: 'stroke', label: 'Stroke' },
  { id: 'tip', label: 'Tip' },
  { id: 'grain', label: 'Grain' },
  { id: 'dynamics', label: 'Pressure & tilt' },
  { id: 'paint', label: 'Paint' },
];
const SHAPES: { id: ShapeKind; label: string }[] = [
  { id: 'round', label: 'Round' },
  { id: 'pencil', label: 'Lead' },
  { id: 'charcoal', label: 'Charcoal' },
  { id: 'chisel', label: 'Chisel' },
  { id: 'bristle', label: 'Bristle' },
  { id: 'splatter', label: 'Splatter' },
  { id: 'spray', label: 'Spray dot' },
];
const GRAINS: { id: GrainKind; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'paper', label: 'Paper' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'charcoal', label: 'Charcoal' },
  { id: 'fibre', label: 'Fibre' },
  { id: 'noise', label: 'Noise' },
];
const ROTATIONS: { id: RotationMode; label: string }[] = [
  { id: 'fixed', label: 'Fixed' },
  { id: 'stroke', label: 'Along the stroke' },
  { id: 'azimuth', label: 'Pencil lean' },
  { id: 'random', label: 'Random' },
];
const MODES: { id: BrushMode; label: string }[] = [
  { id: 'paint', label: 'Paint' },
  { id: 'erase', label: 'Erase' },
  { id: 'smudge', label: 'Smudge' },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) => (Math.abs(v) < 0.005 ? 'Off' : `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`);

function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="ldx-field">
      <span className="ldx-slider-label">{label}</span>
      <div className="ldx-chips" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" className="ldx-chip" aria-checked={value === o.id} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The pressure curve: drag the two handles; the line is how hard you press (across) to how much (up). */
function CurveEditor({ curve, onChange }: { curve: Brush['pressureCurve']; onChange: (c: Brush['pressureCurve']) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<0 | 1 | null>(null);
  const S = 140;
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (drag === null) return;
    const r = ref.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    const next = [...curve] as Brush['pressureCurve'];
    next[drag * 2] = x;
    next[drag * 2 + 1] = y;
    onChange(next);
  };
  const pts = Array.from({ length: 33 }, (_, i) => `${(i / 32) * S},${(1 - bezierY(curve, i / 32)) * S}`).join(' ');
  return (
    <div className="ldx-curve-wrap">
      <svg ref={ref} className="ldx-curve" viewBox={`0 0 ${S} ${S}`} width={S} height={S} role="group" aria-label="Pressure curve" onPointerMove={move} onPointerUp={() => setDrag(null)}>
        <rect x={0} y={0} width={S} height={S} className="ldx-curve-bg" />
        <line x1={0} y1={S} x2={S} y2={0} className="ldx-curve-diag" />
        <line x1={0} y1={S} x2={curve[0] * S} y2={(1 - curve[1]) * S} className="ldx-curve-arm" />
        <line x1={S} y1={0} x2={curve[2] * S} y2={(1 - curve[3]) * S} className="ldx-curve-arm" />
        <polyline points={pts} className="ldx-curve-line" />
        {[0, 1].map((k) => (
          <circle
            key={k}
            cx={curve[k * 2] * S}
            cy={(1 - curve[k * 2 + 1]) * S}
            r={16}
            className="ldx-curve-handle"
            role="slider"
            aria-label={k ? 'Firm end of the curve' : 'Light end of the curve'}
            aria-valuetext={`${pct(curve[k * 2])} across, ${pct(curve[k * 2 + 1])} up`}
            tabIndex={-1}
            onPointerDown={(e) => {
              (e.currentTarget.ownerSVGElement ?? e.currentTarget).setPointerCapture?.(e.pointerId);
              setDrag(k as 0 | 1);
            }}
          />
        ))}
      </svg>
      <div className="ldx-curve-presets">
        <span className="ldx-slider-label">Feel</span>
        {(
          [
            ['Even', [0.33, 0.33, 0.67, 0.67]],
            ['Light touch', [0.1, 0.6, 0.4, 1]],
            ['Firm', [0.6, 0, 0.9, 0.4]],
            ['S-curve', [0.4, 0.1, 0.6, 0.9]],
          ] as [string, Brush['pressureCurve']][]
        ).map(([label, c]) => (
          <button key={label} type="button" className="ldx-chip" aria-pressed={c.every((v, i) => Math.abs(v - curve[i]) < 0.01)} onClick={() => onChange(c)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DynRow({ label, d, onChange }: { label: string; d: Dyn; onChange: (d: Dyn) => void }) {
  return (
    <div className="ldx-dyn">
      <h5 className="ldx-dyn-t">{label}</h5>
      <Slider label="Pressure" value={d.pressure} min={-1} max={1} step={0.05} onChange={(v) => onChange({ ...d, pressure: v })} text={signed(d.pressure)} />
      <Slider label="Tilt" value={d.tilt} min={-1} max={1} step={0.05} onChange={(v) => onChange({ ...d, tilt: v })} text={signed(d.tilt)} />
      <Slider label="Speed" value={d.speed} min={-1} max={1} step={0.05} onChange={(v) => onChange({ ...d, speed: v })} text={signed(d.speed)} />
    </div>
  );
}

/**
 * The brush maker: every setting of a brush, with a live stroke at the top that redraws as you change
 * them. Built-in brushes are kept as they are: saving one makes your own copy.
 */
export function BrushMaker({
  brush: start,
  color,
  onSave,
  onUse,
  onExport,
  onClose,
}: {
  brush: Brush;
  color: string;
  onSave: (b: Brush) => void;
  onUse: (b: Brush) => void;
  onExport: (b: Brush) => void;
  onClose: () => void;
}) {
  const level = useMotionLevel();
  const [b, setB] = useState<Brush>(start);
  const [tab, setTab] = useState<Tab>('stroke');
  const set = (patch: Partial<Brush>) => setB((x) => ({ ...x, ...patch }));
  const dyn = (k: keyof Brush['dynamics'], d: Dyn) => setB((x) => ({ ...x, dynamics: { ...x.dynamics, [k]: d } }));
  return (
    <motion.div className="ldx-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: transitionFor(level, 'smooth') }} exit={{ opacity: 0, transition: transitionFor(level, 'smooth') }} onClick={onClose}>
      <motion.div
        className="ldx-options ldx-maker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ldx-maker-t"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        initial={level === 'full' ? { opacity: 0, y: 28, filter: 'blur(14px)' } : { opacity: 0 }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: transitionFor(level, 'bouncy') }}
      >
        <div className="ldx-guesses-head">
          <p className="o5-kicker">Brush maker</p>
          <button type="button" className="ldx-tool ldx-tool-flat" aria-label="Close" onClick={onClose}>
            <SIcon name="close" size={18} />
          </button>
        </div>
        <input className="ldx-input ldx-maker-name" value={b.name} maxLength={40} aria-label="Brush name" onChange={(e) => set({ name: e.target.value })} id="ldx-maker-t" />
        <div className="ldx-maker-preview">
          <BrushPreview brush={b} width={440} height={110} color={b.mode === 'paint' ? color : undefined} className="ldx-maker-canvas" scale={1.4} />
        </div>
        <div className="ldx-tabs ldx-maker-tabs" role="tablist" aria-label="Settings">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" className="ldx-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="ldx-maker-body" role="tabpanel">
          {tab === 'stroke' && (
            <>
              <Slider label="Size" value={Math.log(b.size)} min={Math.log(0.001)} max={Math.log(0.25)} step={0.01} onChange={(v) => set({ size: Math.exp(v) })} text={`${(b.size * 100).toFixed(b.size < 0.01 ? 2 : 1)}%`} />
              <Slider label="Spacing" value={b.spacing} min={0.02} max={1.5} step={0.01} onChange={(v) => set({ spacing: v })} text={pct(b.spacing)} />
              <Slider label="Streamline" value={b.smoothing} onChange={(v) => set({ smoothing: v })} text={pct(b.smoothing)} />
              <Slider label="Taper in" value={b.taper.start} onChange={(v) => set({ taper: { ...b.taper, start: v } })} text={pct(b.taper.start)} />
              <Slider label="Taper out" value={b.taper.end} onChange={(v) => set({ taper: { ...b.taper, end: v } })} text={pct(b.taper.end)} />
              <Slider label="Scatter" value={b.jitter.scatter} min={0} max={2} step={0.02} onChange={(v) => set({ jitter: { ...b.jitter, scatter: v } })} text={pct(b.jitter.scatter)} />
              <Slider label="Count" value={b.count} min={1} max={16} step={1} onChange={(v) => set({ count: v })} text={`${b.count}`} />
            </>
          )}
          {tab === 'tip' && (
            <>
              <Chips label="Shape" value={b.shape} options={SHAPES} onChange={(v) => set({ shape: v })} />
              {b.shape === 'round' && <Slider label="Hardness" value={b.hardness} onChange={(v) => set({ hardness: v })} text={pct(b.hardness)} />}
              <Slider label="Roundness" value={b.roundness} min={0.05} max={1} step={0.01} onChange={(v) => set({ roundness: v })} text={pct(b.roundness)} />
              <Slider label="Angle" value={b.angle} min={-180} max={180} step={1} onChange={(v) => set({ angle: v })} text={`${Math.round(b.angle)}°`} />
              <Chips label="Turns" value={b.rotation} options={ROTATIONS} onChange={(v) => set({ rotation: v })} />
              <Slider label="Size jitter" value={b.jitter.size} onChange={(v) => set({ jitter: { ...b.jitter, size: v } })} text={pct(b.jitter.size)} />
              <Slider label="Opacity jitter" value={b.jitter.opacity} onChange={(v) => set({ jitter: { ...b.jitter, opacity: v } })} text={pct(b.jitter.opacity)} />
              <Slider label="Angle jitter" value={b.jitter.angle} onChange={(v) => set({ jitter: { ...b.jitter, angle: v } })} text={pct(b.jitter.angle)} />
            </>
          )}
          {tab === 'grain' && (
            <>
              <Chips label="Grain" value={b.grain} options={GRAINS} onChange={(v) => set({ grain: v, grainDepth: v !== 'none' && !b.grainDepth ? 0.6 : b.grainDepth })} />
              <Slider label="Depth" value={b.grainDepth} onChange={(v) => set({ grainDepth: v })} text={pct(b.grainDepth)} />
              <Slider label="Scale" value={b.grainScale} min={0.25} max={4} step={0.05} onChange={(v) => set({ grainScale: v })} text={`${b.grainScale.toFixed(2)}×`} />
              <Chips label="Second texture" value={b.dual.shape} options={[{ id: 'none', label: 'None' }, ...SHAPES]} onChange={(v) => set({ dual: { ...b.dual, shape: v, depth: v !== 'none' && !b.dual.depth ? 0.5 : b.dual.depth } })} />
              {b.dual.shape !== 'none' && (
                <>
                  <Slider label="Depth" value={b.dual.depth} onChange={(v) => set({ dual: { ...b.dual, depth: v } })} text={pct(b.dual.depth)} />
                  <Slider label="Scale" value={b.dual.scale} min={0.25} max={4} step={0.05} onChange={(v) => set({ dual: { ...b.dual, scale: v } })} text={`${b.dual.scale.toFixed(2)}×`} />
                </>
              )}
            </>
          )}
          {tab === 'dynamics' && (
            <>
              <CurveEditor curve={b.pressureCurve} onChange={(c) => set({ pressureCurve: c })} />
              <DynRow label="Size follows" d={b.dynamics.size} onChange={(d) => dyn('size', d)} />
              <DynRow label="Opacity follows" d={b.dynamics.opacity} onChange={(d) => dyn('opacity', d)} />
              <DynRow label="Flow follows" d={b.dynamics.flow} onChange={(d) => dyn('flow', d)} />
              <DynRow label="Scatter follows" d={b.dynamics.scatter} onChange={(d) => dyn('scatter', d)} />
              <Slider label="Tilt widens" value={b.tiltSpread} min={0} max={6} step={0.1} onChange={(v) => set({ tiltSpread: v })} text={b.tiltSpread ? `up to ${(1 + b.tiltSpread).toFixed(1)}×` : 'Off'} />
              <Slider label="Tilt flattens" value={b.tiltFlatten} onChange={(v) => set({ tiltFlatten: v })} text={pct(b.tiltFlatten)} />
            </>
          )}
          {tab === 'paint' && (
            <>
              <Chips label="Does" value={b.mode} options={MODES} onChange={(v) => set({ mode: v })} />
              <Slider label="Opacity" value={b.opacity} onChange={(v) => set({ opacity: v })} text={pct(b.opacity)} />
              <Slider label="Flow" value={b.flow} min={0.005} max={1} step={0.005} onChange={(v) => set({ flow: v })} text={pct(b.flow)} />
              {b.mode === 'smudge' && <Slider label="Strength" value={b.smudge} onChange={(v) => set({ smudge: v })} text={pct(b.smudge)} />}
            </>
          )}
        </div>
        <div className="ldx-card-go ldx-maker-go">
          {start.builtin && <p className="ldx-note ldx-maker-note">A built-in brush stays as it is: saving makes your own copy.</p>}
          <span className="ldx-go-wrap">
            <button type="button" className="btn primary ldx-go" disabled={!b.name.trim()} onClick={() => onSave(b)}>
              <SIcon name="save" size={16} /> {start.builtin ? 'Save as my brush' : 'Save'}
            </button>
            <OrbSpot size={44} className="ldx-go-spot" />
          </span>
          <button type="button" className="ldx-link" onClick={() => onUse(b)}>
            Use without saving
          </button>
          <button type="button" className="ldx-link" onClick={() => onExport(b)}>
            <SIcon name="download" size={16} /> Take it away (file)
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
