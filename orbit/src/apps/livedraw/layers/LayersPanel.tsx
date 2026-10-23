import { useRef, useState } from 'react';
import { Slider } from '../panels';
import { Toggle } from '../ui/controls';
import { SIcon } from '../ui/StudioIcon';
import { BLEND_MODES, type DocState, type Layer, type Role } from './model';

const ROLES: { id: Role; label: string }[] = [
  { id: 'sketch', label: 'Lines' },
  { id: 'colour', label: 'Colour' },
  { id: 'none', label: 'Not read' },
];
const ROW = 60;

/**
 * Layers, top of the stack first. Tap a layer to draw on it (its settings open under it); drag the
 * grip to move it up or down. The Picture (from the drawing machine) and the Reference (a picture to
 * trace) sit under every layer.
 */
export function LayersPanel(p: {
  state: DocState;
  thumbs: Record<number, string>;
  cap: number;
  maskEdit: boolean;
  onMaskEdit: (on: boolean) => void;
  onActive: (id: number) => void;
  onPatch: (id: number, patch: Partial<Layer>, merge?: string) => void;
  onAdd: (kind: Layer['kind']) => void;
  onDuplicate: (id: number) => void;
  onMerge: (id: number) => void;
  onRemove: (id: number) => void;
  onClear: (id: number) => void;
  onMove: (id: number, to: number) => void;
  onMask: (id: number, on: boolean) => void;
  ink: number;
  onInk: (v: number) => void;
  visible: { picture: boolean; reference: boolean };
  onVisible: (id: 'picture' | 'reference', on: boolean) => void;
  reference: string | null;
  onReference: (file: File | null) => void;
  kept: boolean;
  onLetGo: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState<{ id: number; y0: number; dy: number } | null>(null);
  const top = [...p.state.layers].reverse();
  const n = p.state.layers.length;
  return (
    <div className="ldx-layers">
      <Slider label="Ink" value={p.ink} min={0} max={100} step={1} onChange={p.onInk} text={`${Math.round(p.ink)}%`} />
      <div className="ldx-actions">
        <button type="button" className="ldx-link" onClick={() => p.onAdd('paint')}>
          <SIcon name="plus" size={16} /> Layer
        </button>
        <button type="button" className="ldx-link" onClick={() => p.onAdd('vector')}>
          <SIcon name="nib" size={16} /> Ink layer
        </button>
        <span className="ldx-note ldx-count" title={`This device has room for ${p.cap} layers at this size`}>
          {n} {n === 1 ? 'layer' : 'layers'} · room for {p.cap}
        </span>
      </div>
      <ul className="ldx-rows ldx-layer-rows" aria-label="Layers">
        {top.map((l) => {
          const index = p.state.layers.indexOf(l);
          const active = l.id === p.state.activeId;
          const dragging = drag?.id === l.id;
          return (
            <li key={l.id} className="ldx-lrow" data-active={active || undefined} data-dragging={dragging || undefined} data-clip={l.clip || undefined} style={dragging ? { transform: `translateY(${drag!.dy}px)` } : undefined}>
              <div className="ldx-lrow-main">
                <span
                  className="ldx-grip"
                  role="button"
                  tabIndex={0}
                  aria-label={`Move ${l.name} (drag up or down)`}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                    setDrag({ id: l.id, y0: e.clientY, dy: 0 });
                  }}
                  onPointerMove={(e) => drag?.id === l.id && setDrag({ ...drag, dy: e.clientY - drag.y0 })}
                  onPointerUp={() => {
                    if (drag?.id === l.id) {
                      const steps = Math.round(drag.dy / ROW);
                      if (steps) p.onMove(l.id, index - steps);
                    }
                    setDrag(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') p.onMove(l.id, index + 1);
                    else if (e.key === 'ArrowDown') p.onMove(l.id, index - 1);
                  }}
                >
                  <SIcon name="grip" size={18} />
                </span>
                <button type="button" className="ldx-lrow-pick" aria-pressed={active} aria-label={`${l.name}${active ? ', drawing here' : ''}`} onClick={() => p.onActive(l.id)}>
                  <span className="ldx-thumb-sm">{p.thumbs[l.id] ? <img src={p.thumbs[l.id]} alt="" /> : null}</span>
                  <span className="ldx-lrow-text">
                    <span className="ldx-row-name">
                      {l.clip && <SIcon name="clip" size={14} />} {l.name}
                    </span>
                    <span className="ldx-lrow-sub">
                      {l.kind === 'vector' ? 'Ink · ' : ''}
                      {ROLES.find((r) => r.id === l.role)?.label}
                      {l.blend !== 'normal' ? ` · ${BLEND_MODES.find((b) => b.id === l.blend)?.label}` : ''}
                      {l.opacity < 1 ? ` · ${Math.round(l.opacity * 100)}%` : ''}
                      {l.alphaLock ? ' · locked' : ''}
                      {l.hasMask ? ' · mask' : ''}
                    </span>
                  </span>
                </button>
                <button type="button" className="ldx-eye" aria-pressed={l.visible} aria-label={`${l.visible ? 'Hide' : 'Show'} ${l.name}`} onClick={() => p.onPatch(l.id, { visible: !l.visible })}>
                  <SIcon name={l.visible ? 'eye' : 'eyeOff'} size={18} />
                </button>
              </div>
              {active && !drag && (
                <div className="ldx-lrow-more" role="group" aria-label={`${l.name} settings`}>
                  <input className="ldx-input" value={l.name} maxLength={30} aria-label="Layer name" onChange={(e) => p.onPatch(l.id, { name: e.target.value }, `name${l.id}`)} />
                  <label className="ldx-field ldx-blend">
                    <span className="ldx-slider-label">Blend</span>
                    <select value={l.blend} aria-label="Blend mode" onChange={(e) => p.onPatch(l.id, { blend: e.target.value as Layer['blend'] })}>
                      {BLEND_MODES.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Slider label="Opacity" value={l.opacity} onChange={(v) => p.onPatch(l.id, { opacity: v }, `opacity${l.id}`)} text={`${Math.round(l.opacity * 100)}%`} />
                  <Toggle label="Lock transparency (paint only on paint)" on={l.alphaLock} onChange={(v) => p.onPatch(l.id, { alphaLock: v })} />
                  <Toggle label="Clip to the layer below" on={l.clip} onChange={(v) => index > 0 && p.onPatch(l.id, { clip: v })} />
                  {l.kind === 'paint' &&
                    (l.hasMask ? (
                      <>
                        <Toggle label="Paint on the mask (hides; erase shows)" on={p.maskEdit} onChange={p.onMaskEdit} />
                        <button type="button" className="ldx-link" onClick={() => p.onMask(l.id, false)}>
                          <SIcon name="mask" size={16} /> Remove the mask
                        </button>
                      </>
                    ) : (
                      <button type="button" className="ldx-link" onClick={() => p.onMask(l.id, true)}>
                        <SIcon name="mask" size={16} /> Add a mask
                      </button>
                    ))}
                  <div className="ldx-field">
                    <span className="ldx-slider-label">The drawing machine reads it as</span>
                    <div className="ldx-chips" role="radiogroup" aria-label="The drawing machine reads it as">
                      {ROLES.map((r) => (
                        <button key={r.id} type="button" role="radio" className="ldx-chip" aria-checked={l.role === r.id} onClick={() => p.onPatch(l.id, { role: r.id })}>
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="ldx-actions">
                    <button type="button" className="ldx-link" disabled={index >= n - 1} onClick={() => p.onMove(l.id, index + 1)}>
                      <SIcon name="arrowUp" size={16} /> Up
                    </button>
                    <button type="button" className="ldx-link" disabled={index <= 0} onClick={() => p.onMove(l.id, index - 1)}>
                      <SIcon name="down" size={16} /> Down
                    </button>
                    <button type="button" className="ldx-link" onClick={() => p.onDuplicate(l.id)}>
                      <SIcon name="copy" size={16} /> Duplicate
                    </button>
                    <button type="button" className="ldx-link" disabled={index <= 0} onClick={() => p.onMerge(l.id)}>
                      <SIcon name="merge" size={16} /> Merge down
                    </button>
                    <button type="button" className="ldx-link" onClick={() => p.onClear(l.id)}>
                      <SIcon name="eraser" size={16} /> Clear
                    </button>
                    <button type="button" className="ldx-link ldx-danger" disabled={n <= 1} onClick={() => p.onRemove(l.id)}>
                      <SIcon name="trash" size={16} /> Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        <li className="ldx-row">
          <button type="button" className="ldx-eye" aria-pressed={p.visible.picture} aria-label={`${p.visible.picture ? 'Hide' : 'Show'} Picture`} onClick={() => p.onVisible('picture', !p.visible.picture)}>
            <SIcon name={p.visible.picture ? 'eye' : 'eyeOff'} size={18} />
          </button>
          <span className="ldx-row-name">Picture</span>
          {p.kept && (
            <button type="button" className="ldx-link" onClick={p.onLetGo}>
              Let go of the kept one
            </button>
          )}
        </li>
        <li className="ldx-row">
          <button type="button" className="ldx-eye" aria-pressed={p.visible.reference} aria-label={`${p.visible.reference ? 'Hide' : 'Show'} Reference`} onClick={() => p.onVisible('reference', !p.visible.reference)}>
            <SIcon name={p.visible.reference ? 'eye' : 'eyeOff'} size={18} />
          </button>
          <span className="ldx-row-name">Reference</span>
          {p.reference ? (
            <button type="button" className="ldx-link" onClick={() => p.onReference(null)}>
              Remove
            </button>
          ) : (
            <button type="button" className="ldx-link" onClick={() => file.current?.click()}>
              Add a picture to trace
            </button>
          )}
        </li>
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
