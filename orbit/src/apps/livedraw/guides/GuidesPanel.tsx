import { Slider } from '../panels';
import { Toggle } from '../ui/controls';
import { SIcon } from '../ui/StudioIcon';
import type { Guides } from '../canvas/Stage';
import { DEFAULT_VPS, vpsFor, type PerspKind } from './perspective';
import type { SymKind } from './symmetry';

const PERSP: { id: PerspKind; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'one', label: '1 point' },
  { id: 'two', label: '2 point' },
  { id: 'three', label: '3 point' },
];
const SYM: { id: SymKind; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'vertical', label: 'Left and right' },
  { id: 'horizontal', label: 'Top and bottom' },
  { id: 'quadrant', label: 'Four ways' },
  { id: 'radial', label: 'Radial' },
];

/** Guides and steady lines: perspective, symmetry, the pulled string and shape snapping. */
export function GuidesPanel({ guides, onGuides }: { guides: Guides; onGuides: (g: Guides) => void }) {
  const p = guides.perspective;
  const s = guides.symmetry;
  const any = p.kind !== 'off' || s.kind !== 'off';
  return (
    <div className="ldx-guides">
      <section className="ldx-section" aria-labelledby="ldx-persp-t">
        <h4 className="ldx-sub" id="ldx-persp-t">
          <SIcon name="perspective" size={16} /> Perspective
        </h4>
        <div className="ldx-chips" role="radiogroup" aria-label="Perspective">
          {PERSP.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              className="ldx-chip"
              aria-checked={p.kind === o.id}
              onClick={() => onGuides({ ...guides, perspective: { ...p, kind: o.id, vps: vpsFor(o.id, p.vps) }, edit: o.id !== 'off' ? true : guides.edit && s.kind !== 'off' })}
            >
              {o.label}
            </button>
          ))}
        </div>
        {p.kind !== 'off' && (
          <>
            <Toggle label="Snap strokes to perspective" on={p.snap} onChange={(v) => onGuides({ ...guides, perspective: { ...p, snap: v } })} />
            <button type="button" className="ldx-link" onClick={() => onGuides({ ...guides, perspective: { ...p, vps: p.kind === 'one' ? vpsFor('one', p.vps) : DEFAULT_VPS.map((v) => ({ ...v })) } })}>
              Put the points back
            </button>
          </>
        )}
      </section>
      <section className="ldx-section" aria-labelledby="ldx-sym-t">
        <h4 className="ldx-sub" id="ldx-sym-t">
          <SIcon name="symmetry" size={16} /> Symmetry
        </h4>
        <div className="ldx-chips" role="radiogroup" aria-label="Symmetry">
          {SYM.map((o) => (
            <button key={o.id} type="button" role="radio" className="ldx-chip" aria-checked={s.kind === o.id} onClick={() => onGuides({ ...guides, symmetry: { ...s, kind: o.id } })}>
              {o.label}
            </button>
          ))}
        </div>
        {s.kind === 'radial' && <Slider label="Parts" value={s.n} min={2} max={24} step={1} onChange={(v) => onGuides({ ...guides, symmetry: { ...s, n: v } })} text={`${s.n}`} />}
        {s.kind !== 'off' && (
          <>
            <Toggle label="Rotational (turn instead of mirror)" on={s.rotational} onChange={(v) => onGuides({ ...guides, symmetry: { ...s, rotational: v } })} />
            <button type="button" className="ldx-link" onClick={() => onGuides({ ...guides, symmetry: { ...s, cx: 0.5, cy: 0.5 } })}>
              Centre it again
            </button>
          </>
        )}
      </section>
      {any && (
        <button type="button" className="ldx-link" aria-pressed={guides.edit} onClick={() => onGuides({ ...guides, edit: !guides.edit })}>
          <SIcon name="select" size={16} /> {guides.edit ? 'Done moving points' : 'Move the points on the canvas'}
        </button>
      )}
      <section className="ldx-section" aria-labelledby="ldx-steady-t">
        <h4 className="ldx-sub" id="ldx-steady-t">
          <SIcon name="steady" size={16} /> Steady lines
        </h4>
        <Slider label="Pulled string" value={guides.rope} onChange={(v) => onGuides({ ...guides, rope: v })} text={guides.rope < 0.02 ? 'Off' : guides.rope < 0.34 ? 'Short' : guides.rope < 0.67 ? 'Medium' : 'Long'} />
        <p className="ldx-note">The line follows your pen on a string: small wobbles never reach it.</p>
        <Toggle label="Hold to snap shapes" on={guides.quickShape} onChange={(v) => onGuides({ ...guides, quickShape: v })} hint="Draw a line, arc, circle or box and hold still at the end" />
        <p className="ldx-note">Draw a line, arc, circle or box and hold still at the end: it becomes the clean shape. Keep holding and move to adjust it.</p>
      </section>
    </div>
  );
}
