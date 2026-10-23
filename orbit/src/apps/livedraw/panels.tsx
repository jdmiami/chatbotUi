import { useRef, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Icon, type IconName } from '../../ui/Icon';
import { useMotionLevel } from '../../motion/MotionProvider';
import { SPRING, transitionFor } from '../../motion/springs';
import { OrbSpot } from '../../studio/Sheets';
import type { CanvasEngine, CanvasSize, SketchGuess } from '../../services/ai/liveCanvas';
import type { Region, StageTool } from './canvas/Stage';
import type { DrawLayer } from './canvas/doc';
import type { LayerId } from './canvas/raster';
import type { Shot } from './canvas/history';
import { COLORS } from './canvas/sketch';

export const TOOLS: { value: StageTool; label: string; icon: IconName }[] = [
  { value: 'pen', label: 'Pen', icon: 'pencil' },
  { value: 'pencil', label: 'Pencil', icon: 'pencilSoft' },
  { value: 'marker', label: 'Marker', icon: 'marker' },
  { value: 'airbrush', label: 'Airbrush', icon: 'spray' },
  { value: 'eraser', label: 'Eraser', icon: 'eraser' },
  { value: 'fill', label: 'Fill', icon: 'bucket' },
  { value: 'picker', label: 'Pick a colour', icon: 'dropper' },
];

/** Style chips: each adds its words to the prompt. */
export const STYLES: { id: string; label: string; words: string }[] = [
  { id: 'watercolour', label: 'Watercolour', words: 'watercolour painting, soft washes, paper texture' },
  { id: 'oil', label: 'Oil', words: 'oil painting, thick brush strokes, rich colour' },
  { id: 'ink', label: 'Ink', words: 'ink drawing, bold lines, cross-hatching' },
  { id: 'anime', label: 'Anime', words: 'anime style, cel shading, clean line art' },
  { id: 'photo', label: 'Photo', words: 'photograph, realistic, natural light, fine detail' },
  { id: 'clay', label: 'Clay', words: 'claymation, plasticine, soft studio light' },
  { id: 'neon', label: 'Neon', words: 'neon glow, vivid colours, dark background' },
  { id: 'pencil', label: 'Pencil', words: 'pencil drawing, graphite shading' },
];
export const styleWords = (ids: string[]) => STYLES.filter((s) => ids.includes(s.id)).map((s) => s.words);

const LAYER_NAMES: Record<LayerId, string> = { sketch: 'Sketch', colour: 'Colour', picture: 'Picture', reference: 'Reference' };

/** A labelled slider, 44 px tall, with its value in words. */
export function Slider({ label, value, min = 0, max = 1, step = 0.05, onChange, text }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; text: string }) {
  return (
    <label className="ldx-slider">
      <span className="ldx-slider-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={text} />
      <span className="ldx-slider-value">{text}</span>
    </label>
  );
}

export function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section className="ldx-section" aria-labelledby={id ? `${id}-t` : undefined}>
      <h3 className="o5-kicker ldx-kicker" id={id ? `${id}-t` : undefined}>
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ToolsPanel(p: {
  tool: StageTool;
  onTool: (t: StageTool) => void;
  color: string;
  onColor: (c: string) => void;
  sizeScale: number;
  onSize: (v: number) => void;
  painting: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onFit: () => void;
}) {
  return (
    <div className="ldx-tools" role="toolbar" aria-label="Drawing tools">
      <div className="ldx-grid" role="radiogroup" aria-label="Tool">
        {TOOLS.map((t) => (
          <button key={t.value} type="button" role="radio" aria-checked={p.tool === t.value} aria-label={t.label} title={t.label} className="ldx-tool" onClick={() => p.onTool(t.value)}>
            <Icon name={t.icon} size={20} />
          </button>
        ))}
      </div>
      <div className="ldx-grid">
        <button type="button" className="ldx-tool" aria-label="Undo" title="Undo (or tap with two fingers)" disabled={!p.canUndo} onClick={p.onUndo}>
          <Icon name="undo" size={20} />
        </button>
        <button type="button" className="ldx-tool" aria-label="Redo" title="Redo (or tap with three fingers)" disabled={!p.canRedo} onClick={p.onRedo}>
          <Icon name="redo" size={20} />
        </button>
        <button type="button" className="ldx-tool" aria-label="Whole canvas" title="Show the whole canvas" onClick={p.onFit}>
          <Icon name="fit" size={20} />
        </button>
        <button type="button" className="ldx-tool" aria-label="Clear the drawing" title="Clear (Undo brings it back)" onClick={p.onClear}>
          <Icon name="trash" size={20} />
        </button>
      </div>
      <div className="ldx-grid" role="radiogroup" aria-label="Colour">
        {COLORS.map((c) => (
          <button key={c.value} type="button" role="radio" aria-checked={p.color === c.value} aria-label={c.label} title={c.label} className="ldx-swatch" onClick={() => p.onColor(c.value)}>
            <span style={{ background: c.value }} />
          </button>
        ))}
        <label className="ldx-swatch ldx-custom" title="Any colour">
          <span style={{ background: p.color }} />
          <input type="color" value={p.color} onChange={(e) => p.onColor(e.target.value)} aria-label="Any colour" />
        </label>
      </div>
      <Slider label={p.painting ? 'Brush' : 'Size'} value={p.sizeScale} min={0.25} max={4} step={0.05} onChange={p.onSize} text={`${Math.round(p.sizeScale * 100)}%`} />
    </div>
  );
}

export function LayersPanel(p: {
  visible: Record<LayerId, boolean>;
  onVisible: (id: LayerId, on: boolean) => void;
  layer: DrawLayer;
  onLayer: (l: DrawLayer) => void;
  ink: number;
  onInk: (v: number) => void;
  reference: string | null;
  onReference: (file: File | null) => void;
  kept: boolean;
  onLetGo: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="ldx-layers">
      <Slider label="Ink" value={p.ink} min={0} max={100} step={1} onChange={p.onInk} text={`${Math.round(p.ink)}%`} />
      <ul className="ldx-rows" aria-label="Layers">
        {(['sketch', 'colour', 'picture', 'reference'] as LayerId[]).map((id) => (
          <li key={id} className="ldx-row" data-active={id === p.layer || undefined}>
            <button type="button" className="ldx-eye" aria-pressed={p.visible[id]} aria-label={`${p.visible[id] ? 'Hide' : 'Show'} ${LAYER_NAMES[id]}`} onClick={() => p.onVisible(id, !p.visible[id])}>
              <Icon name={p.visible[id] ? 'eye' : 'eyeOff'} size={18} />
            </button>
            <span className="ldx-row-name">{LAYER_NAMES[id]}</span>
            {(id === 'sketch' || id === 'colour') && (
              <button type="button" className="ldx-link" role="radio" aria-checked={p.layer === id} onClick={() => p.onLayer(id)}>
                {p.layer === id ? 'Drawing here' : 'Draw here'}
              </button>
            )}
            {id === 'picture' && p.kept && (
              <button type="button" className="ldx-link" onClick={p.onLetGo}>
                Let go of the kept one
              </button>
            )}
            {id === 'reference' &&
              (p.reference ? (
                <button type="button" className="ldx-link" onClick={() => p.onReference(null)}>
                  Remove
                </button>
              ) : (
                <button type="button" className="ldx-link" onClick={() => file.current?.click()}>
                  Add a picture to trace
                </button>
              ))}
          </li>
        ))}
      </ul>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        aria-label="Picture to trace"
        onChange={(e) => {
          p.onReference(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function LookPanel(p: {
  styles: string[];
  onStyles: (ids: string[]) => void;
  follow: number;
  onFollow: (v: number) => void;
  strength: number;
  onStrength: (v: number) => void;
  seedLocked: boolean;
  onLock: (v: boolean) => void;
  onShuffle: () => void;
}) {
  const words = (v: number, a: string, b: string, c: string) => (v < 0.34 ? a : v < 0.67 ? b : c);
  return (
    <div className="ldx-look">
      <div className="ldx-chips" role="group" aria-label="Styles">
        {STYLES.map((s) => {
          const on = p.styles.includes(s.id);
          return (
            <button key={s.id} type="button" className="ldx-chip" aria-pressed={on} onClick={() => p.onStyles(on ? p.styles.filter((x) => x !== s.id) : [...p.styles, s.id])}>
              {s.label}
            </button>
          );
        })}
      </div>
      <Slider label="Follow" value={p.follow} onChange={p.onFollow} text={words(p.follow, 'Loosely', 'Somewhat', 'Closely')} />
      <Slider label="Change" value={p.strength} onChange={p.onStrength} text={words(p.strength, 'A little', 'Some', 'A lot')} />
      <div className="ldx-actions">
        <button type="button" className="ldx-link" aria-pressed={p.seedLocked} onClick={() => p.onLock(!p.seedLocked)}>
          <Icon name="lock" size={16} /> {p.seedLocked ? 'Look locked' : 'Lock this look'}
        </button>
        <button type="button" className="ldx-link" disabled={p.seedLocked} onClick={p.onShuffle}>
          <Icon name="shuffle" size={16} /> Shuffle
        </button>
      </div>
    </div>
  );
}

export function ProPanel(p: {
  regions: Region[];
  lasso: boolean;
  onLasso: (on: boolean) => void;
  onRegionWords: (id: number, words: string) => void;
  onRegionRemove: (id: number) => void;
  poseOn: boolean;
  onPoseOn: (on: boolean) => void;
  poseShown: boolean;
  onPoseShown: (on: boolean) => void;
  onPoseReset: () => void;
  styleRefAllowed: boolean;
  styleRef: { image: string; weight: number } | null;
  onStyleRef: (file: File | null) => void;
  onStyleWeight: (w: number) => void;
  reading: boolean;
  onRead: () => void;
  canRead: boolean;
  onFinish: () => void;
  canFinish: boolean;
  finishing: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="ldx-pro">
      <Section title="Regions" id="ldx-regions">
        <p className="ldx-note">Circle part of the canvas and give it its own words.</p>
        <button type="button" className="ldx-link" aria-pressed={p.lasso} onClick={() => p.onLasso(!p.lasso)}>
          <Icon name="lasso" size={16} /> {p.lasso ? 'Circle it on the canvas…' : 'Draw a region'}
        </button>
        {p.regions.length > 0 && (
          <ol className="ldx-regions">
            {p.regions.map((r, i) => (
              <li key={r.id}>
                <span className="ldx-region-n">{i + 1}</span>
                <input className="ldx-input" value={r.prompt} onChange={(e) => p.onRegionWords(r.id, e.target.value)} placeholder="What is here? e.g. a red kite" aria-label={`Words for region ${i + 1}`} maxLength={200} data-region={r.id} enterKeyHint="done" />
                <button type="button" className="ldx-tool ldx-tool-flat" aria-label={`Remove region ${i + 1}`} onClick={() => p.onRegionRemove(r.id)}>
                  <Icon name="close" size={16} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </Section>
      <Section title="Pose" id="ldx-pose">
        <p className="ldx-note">A figure to drag into place: people in the picture stand like it.</p>
        <div className="ldx-actions">
          <button type="button" className="ldx-link" aria-pressed={p.poseOn} onClick={() => p.onPoseOn(!p.poseOn)}>
            <Icon name="person" size={16} /> {p.poseOn ? 'Using a pose' : 'Use a pose'}
          </button>
          {p.poseOn && (
            <>
              <button type="button" className="ldx-link" aria-pressed={p.poseShown} onClick={() => p.onPoseShown(!p.poseShown)}>
                {p.poseShown ? 'Hide the figure' : 'Show the figure'}
              </button>
              <button type="button" className="ldx-link" onClick={p.onPoseReset}>
                Stand it up again
              </button>
            </>
          )}
        </div>
      </Section>
      {p.styleRefAllowed && (
        <Section title="Style reference" id="ldx-ref">
          <p className="ldx-note">A picture whose look the drawing takes on.</p>
          {p.styleRef ? (
            <div className="ldx-ref">
              <img src={p.styleRef.image} alt="Style reference" />
              <div className="ldx-ref-side">
                <Slider label="Weight" value={p.styleRef.weight} onChange={p.onStyleWeight} text={`${Math.round(p.styleRef.weight * 100)}%`} />
                <button type="button" className="ldx-link" onClick={() => p.onStyleRef(null)}>
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="ldx-link" onClick={() => file.current?.click()}>
              <Icon name="image" size={16} /> Pick a picture
            </button>
          )}
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            aria-label="Style reference picture"
            onChange={(e) => {
              p.onStyleRef(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
        </Section>
      )}
      <Section title="Sketch reader" id="ldx-reader">
        <p className="ldx-note">The orb looks at your sketch and guesses what it is.</p>
        <button type="button" className="ldx-link" disabled={!p.canRead || p.reading} onClick={p.onRead}>
          <Icon name="search" size={16} /> {p.reading ? 'Looking…' : 'What is it?'}
        </button>
      </Section>
      <Section title="Finish" id="ldx-finish">
        <p className="ldx-note">A full-quality picture of it, kept in your gallery.</p>
        <button type="button" className="btn primary ldx-go" disabled={!p.canFinish || p.finishing} onClick={p.onFinish}>
          <Icon name="sparkle" size={18} /> {p.finishing ? 'Finishing…' : 'Finish'}
        </button>
      </Section>
    </div>
  );
}

export function HistoryPanel(p: {
  items: readonly Shot[];
  index: number;
  onRestore: (i: number) => void;
  onPng: () => void;
  onPsd: () => void;
  onTimelapse: () => void;
  busy: string | null;
}) {
  return (
    <div className="ldx-history">
      {p.items.length ? (
        <>
          <ol className="ldx-strip" aria-label="Pictures so far">
            {p.items.map((s, i) => (
              <li key={s.id}>
                <button type="button" className="ldx-thumb" aria-current={i === p.index || undefined} aria-label={`Picture ${i + 1}${s.mark === 'keep' ? ', kept' : ''}`} onClick={() => p.onRestore(i)}>
                  <img src={s.image} alt="" loading="lazy" />
                </button>
              </li>
            ))}
          </ol>
          {p.items.length > 1 && <Slider label="Scrub" value={p.index} min={0} max={p.items.length - 1} step={1} onChange={p.onRestore} text={`${p.index + 1} of ${p.items.length}`} />}
        </>
      ) : (
        <p className="ldx-note">Every picture the drawing machine sends back lands here. Scrub back to bring one back.</p>
      )}
      <div className="ldx-actions">
        <button type="button" className="ldx-link" disabled={Boolean(p.busy)} onClick={p.onPng}>
          <Icon name="download" size={16} /> {p.busy === 'png' ? 'Saving…' : 'Save PNG'}
        </button>
        <button type="button" className="ldx-link" disabled={Boolean(p.busy)} onClick={p.onPsd}>
          <Icon name="layers" size={16} /> {p.busy === 'psd' ? 'Saving…' : 'Save layers (PSD)'}
        </button>
        <button type="button" className="ldx-link" disabled={Boolean(p.busy) || p.items.length < 2} onClick={p.onTimelapse}>
          <Icon name="film" size={16} /> {p.busy === 'timelapse' ? 'Recording…' : 'Time-lapse'}
        </button>
      </div>
    </div>
  );
}

/** The sketch reader's guesses: words to pick, the orb on the first. */
export function Guesses({ guesses, onPick, onDismiss }: { guesses: SketchGuess[]; onPick: (g: SketchGuess) => void; onDismiss: () => void }) {
  const level = useMotionLevel();
  const full = level === 'full';
  return (
    <motion.div className="ldx-guesses" role="group" aria-labelledby="ldx-guess-t" initial={full ? { opacity: 0, y: -18, filter: 'blur(10px)' } : { opacity: 0 }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: transitionFor(level, 'bouncy') }}>
      <div className="ldx-guesses-head">
        <p className="o5-kicker" id="ldx-guess-t">
          Is it…
        </p>
        <button type="button" className="ldx-tool ldx-tool-flat" aria-label="Not these" onClick={onDismiss}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <ul className="ldx-guess-list" aria-label="Guesses">
        {guesses.map((g, i) => (
          <motion.li key={g.label + i} initial={full ? { opacity: 0, y: 26, filter: 'blur(10px)' } : { opacity: 0 }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: full ? { ...SPRING.bouncy, delay: 0.08 + i * 0.055 } : transitionFor(level) }}>
            <button type="button" className="ldx-guess" data-rec={i === 0 || undefined} onClick={() => onPick(g)}>
              {i === 0 && <span className="ldx-rec">The orb’s guess</span>}
              <span className="ldx-guess-label">{g.label}</span>
              {g.prompt && g.prompt !== g.label && <span className="ldx-guess-hint">{g.prompt}</span>}
              {i === 0 && <OrbSpot size={40} className="ldx-guess-spot" />}
            </button>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  );
}

export function SizePicker({ value, onChange }: { value: CanvasSize; onChange: (s: CanvasSize) => void }) {
  return (
    <div className="ldx-chips" role="radiogroup" aria-label="Working size">
      {([512, 768, 1024] as CanvasSize[]).map((s) => (
        <button key={s} type="button" role="radio" className="ldx-chip" aria-checked={value === s} onClick={() => onChange(s)}>
          {s} × {s}
        </button>
      ))}
    </div>
  );
}

export function EnginePicker({ value, onChange }: { value: CanvasEngine; onChange: (e: CanvasEngine) => void }) {
  return (
    <div className="ldx-chips" role="radiogroup" aria-label="Engine">
      {(
        [
          ['fast', 'Fast', 'For you only'],
          ['licensed', 'Licensed', 'Fine for anything you sell'],
        ] as const
      ).map(([v, label, hint]) => (
        <button key={v} type="button" role="radio" className="ldx-chip" aria-checked={value === v} title={hint} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
