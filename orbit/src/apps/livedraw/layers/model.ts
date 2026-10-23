/**
 * The drawing as data: a stack of layers (bottom first), each with what was drawn on it (strokes,
 * fills, merged pictures) and how it shows (blend mode, opacity, mask, clipping, alpha lock), plus the
 * Paint over mask. Every change makes a new state (layers that didn't change are shared), so undo and
 * redo are just stepping between states, and the renderer redraws only the layers that changed.
 *
 * What the drawing machine sees stays as it was: layers marked "lines" are sent as `sketch`, layers
 * marked "colour" as `color` (see LiveDrawApp's buildFrame).
 */
import type { Brush, Mat } from '../brushes/types';
import type { Op } from '../canvas/doc';
import type { Pt } from '../canvas/sketch';
import type { VStroke } from '../ink/vector';

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'color-dodge'
  | 'color-burn'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'add';

/** In the order the picker shows them, with plain names. */
export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'darken', label: 'Darken' },
  { id: 'color-burn', label: 'Colour burn' },
  { id: 'screen', label: 'Screen' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'add', label: 'Add' },
  { id: 'color-dodge', label: 'Colour dodge' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'soft-light', label: 'Soft light' },
  { id: 'hard-light', label: 'Hard light' },
  { id: 'difference', label: 'Difference' },
  { id: 'exclusion', label: 'Exclusion' },
  { id: 'hue', label: 'Hue' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'color', label: 'Colour' },
  { id: 'luminosity', label: 'Luminosity' },
];

/** What the drawing machine reads a layer as. */
export type Role = 'sketch' | 'colour' | 'none';

export interface StrokeOp {
  kind: 'stroke';
  brush: Brush;
  color: string;
  /** Diameter at full dynamics (canvas units). */
  size: number;
  /** The stroke's opacity (the brush's, times the Opacity slider). */
  opacity: number;
  seed: number;
  points: Pt[];
  /** Symmetry: the stroke is drawn once per transform. */
  mirrors?: Mat[];
  /** Drawn with the layer's alpha locked (paint only where there was paint). */
  lock?: boolean;
}

/** Pixels laid on a layer at once: a fill, a merged layer, a picture brought in. */
export interface ImageOp {
  kind: 'image';
  image: CanvasImageSource & { width: number; height: number };
}

export type PaintOp = StrokeOp | ImageOp;

export interface Layer {
  id: number;
  name: string;
  /** Paint (pixels) or ink (editable vector strokes). */
  kind: 'paint' | 'vector';
  role: Role;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  alphaLock: boolean;
  /** Clipped to the layer below: shows only where that one has paint. */
  clip: boolean;
  /** Has a layer mask (paint on it hides, erase shows again). */
  hasMask: boolean;
  ops: PaintOp[];
  maskOps: PaintOp[];
  vectors: VStroke[];
}

export interface DocState {
  /** Bottom first. */
  layers: Layer[];
  activeId: number;
  /** The Paint over mask (white = may change). */
  paintMask: Op[];
}

let seq = 0;
export const nextId = () => ++seq;

export function makeLayer(p: Partial<Layer> & { name: string }): Layer {
  return { id: nextId(), kind: 'paint', role: 'colour', visible: true, opacity: 1, blend: 'normal', alphaLock: false, clip: false, hasMask: false, ops: [], maskOps: [], vectors: [], ...p };
}

/** A fresh drawing: Colour under Sketch, drawing on Sketch. */
export function initialState(): DocState {
  const colour = makeLayer({ name: 'Colour', role: 'colour' });
  const sketch = makeLayer({ name: 'Sketch', role: 'sketch' });
  return { layers: [colour, sketch], activeId: sketch.id, paintMask: [] };
}

export const layerById = (s: DocState, id: number) => s.layers.find((l) => l.id === id) ?? null;
export const activeLayer = (s: DocState) => layerById(s, s.activeId) ?? s.layers[s.layers.length - 1];

/** Anything drawn on a layer (erasing alone is nothing). */
export function layerHasInk(l: Layer): boolean {
  return l.vectors.length > 0 || l.ops.some((o) => o.kind === 'image' || o.brush.mode === 'paint');
}

/** Change one layer. */
export function patchLayer(s: DocState, id: number, patch: Partial<Layer>): DocState {
  return { ...s, layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) };
}

export function addOp(s: DocState, id: number, op: PaintOp, toMask = false): DocState {
  return { ...s, layers: s.layers.map((l) => (l.id !== id ? l : toMask ? { ...l, maskOps: [...l.maskOps, op] } : { ...l, ops: [...l.ops, op] })) };
}

/** A new layer just above the active one (it becomes the active one). */
export function addLayer(s: DocState, kind: Layer['kind'] = 'paint'): DocState {
  const at = s.layers.findIndex((l) => l.id === s.activeId);
  const n = s.layers.length + 1;
  const active = activeLayer(s);
  const layer = makeLayer({ name: kind === 'vector' ? `Ink ${n}` : `Layer ${n}`, kind, role: kind === 'vector' ? 'sketch' : (active?.role ?? 'colour') });
  const layers = s.layers.slice();
  layers.splice(at + 1, 0, layer);
  return { ...s, layers, activeId: layer.id };
}

export function removeLayer(s: DocState, id: number): DocState {
  if (s.layers.length <= 1) return s;
  const at = s.layers.findIndex((l) => l.id === id);
  if (at < 0) return s;
  const layers = s.layers.filter((l) => l.id !== id);
  // A clipped layer whose base is gone clips to the next one down, or nothing.
  if (layers[at] && at === 0) layers[at] = { ...layers[at], clip: false };
  const activeId = s.activeId === id ? layers[Math.max(0, at - 1)].id : s.activeId;
  return { ...s, layers, activeId };
}

export function duplicateLayer(s: DocState, id: number): DocState {
  const at = s.layers.findIndex((l) => l.id === id);
  if (at < 0) return s;
  const src = s.layers[at];
  const copy: Layer = { ...src, id: nextId(), name: `${src.name} copy` };
  const layers = s.layers.slice();
  layers.splice(at + 1, 0, copy);
  return { ...s, layers, activeId: copy.id };
}

/** Move a layer to a new place in the stack (0 = bottom). */
export function moveLayer(s: DocState, id: number, to: number): DocState {
  const from = s.layers.findIndex((l) => l.id === id);
  if (from < 0) return s;
  const target = Math.max(0, Math.min(s.layers.length - 1, to));
  if (target === from) return s;
  const layers = s.layers.slice();
  const [l] = layers.splice(from, 1);
  layers.splice(target, 0, l);
  if (layers[0].clip) layers[0] = { ...layers[0], clip: false };
  return { ...s, layers };
}

/**
 * Merge a layer into the one below: the lower one keeps its place, name, blend and opacity and now
 * holds `merged` (the two drawn together, as the renderer made them); the upper one goes.
 */
export function mergeDown(s: DocState, id: number, merged: ImageOp['image']): DocState {
  const at = s.layers.findIndex((l) => l.id === id);
  if (at <= 0) return s;
  const lower = s.layers[at - 1];
  const next: Layer = { ...lower, kind: 'paint', ops: [{ kind: 'image', image: merged }], maskOps: [], hasMask: false, vectors: [], alphaLock: false };
  const layers = s.layers.slice();
  layers.splice(at - 1, 2, next);
  return { ...s, layers, activeId: next.id };
}

export function clearLayer(s: DocState, id: number): DocState {
  return patchLayer(s, id, { ops: [], vectors: [] });
}

/** The base a clipped layer clips to: the nearest layer below that isn't clipped itself. */
export function clipBase(layers: readonly Layer[], index: number): Layer | null {
  if (!layers[index]?.clip) return null;
  for (let i = index - 1; i >= 0; i--) if (!layers[i].clip) return layers[i];
  return null;
}

/**
 * How many layers this device can hold at `px` square: each layer is a full-size texture (4 bytes a
 * pixel) and the renderer keeps a few spare; the budget is a share of the device's memory (iPhone
 * and iPad Safari don't say, so 4 GB is assumed).
 */
export function layerCap(px: number, deviceMemoryGb?: number): number {
  const gb = deviceMemoryGb && deviceMemoryGb > 0 ? deviceMemoryGb : 4;
  const budget = gb * 1024 ** 3 * 0.1;
  const perLayer = px * px * 4 * 1.6;
  return Math.max(4, Math.min(100, Math.floor(budget / perLayer)));
}

/**
 * Undo and redo: a list of states. Settings dragged with a slider (opacity…) fold into one step
 * (`merge` with the same key). Picking which layer to draw on is not a step.
 */
export class StudioDoc {
  state: DocState;
  private past: DocState[] = [];
  private future: DocState[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;
  version = 0;

  constructor(
    initial: DocState = initialState(),
    readonly maxSteps = 100,
    private now: () => number = Date.now,
  ) {
    this.state = initial;
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  commit(next: DocState, merge?: string) {
    if (next === this.state) return;
    const t = this.now();
    if (merge && merge === this.lastKey && t - this.lastAt < 1500 && this.past.length) {
      this.state = next;
    } else {
      this.past.push(this.state);
      if (this.past.length > this.maxSteps) this.past.shift();
      this.state = next;
    }
    this.lastKey = merge ?? null;
    this.lastAt = t;
    this.future = [];
    this.version++;
  }

  /** Change which layer is drawn on (no undo step). */
  setActive(id: number) {
    if (!layerById(this.state, id)) return;
    this.state = { ...this.state, activeId: id };
    this.version++;
  }

  private keepActive(s: DocState): DocState {
    return layerById(s, this.state.activeId) ? { ...s, activeId: this.state.activeId } : s;
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this.state);
    this.state = this.keepActive(prev);
    this.lastKey = null;
    this.version++;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.state);
    this.state = this.keepActive(next);
    this.lastKey = null;
    this.version++;
    return true;
  }

  /** Start over: one fresh state, no history. */
  reset(s: DocState = initialState()) {
    this.state = s;
    this.past = [];
    this.future = [];
    this.version++;
  }
}
