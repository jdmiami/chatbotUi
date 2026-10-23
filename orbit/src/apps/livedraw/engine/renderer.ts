/**
 * The layer renderer: keeps every layer's pixels in step with the drawing (layers/model.ts) and draws
 * them, blended, onto the one on-screen canvas. Two engines share this: the GPU one (WebGL2, engine/
 * gl.ts) and a plain 2D-canvas one (engine/canvas2d.ts) for browsers without WebGL2 and for small
 * previews. This base does the bookkeeping both need: which strokes each layer already has (a new
 * stroke is drawn on top; anything else, like an undo, redraws that layer from its strokes), the live
 * stroke while you draw, symmetry copies, snapshots for the drawing machine and the exports.
 */
import { dabBounds, dabsFor } from '../brushes/dabs';
import type { Brush, Dab } from '../brushes/types';
import { mirrorDabs } from '../guides/symmetry';
import { drawVectors, type VStroke } from '../ink/vector';
import { clipBase, type BlendMode, type DocState, type ImageOp, type Layer, type PaintOp, type StrokeOp } from '../layers/model';

export type Img = ImageOp['image'];

/** How a stroke changes what it lands on: paint over, erase, or paint only where there is paint. */
export type StrokeMode = 'paint' | 'erase' | 'lock';

export interface CompositeEntry {
  id: number;
  opacity: number;
  blend: BlendMode;
  mask: boolean;
  /** The layer it clips to (its id), if any. */
  clip: number | null;
  clipMask: boolean;
}

interface Drawn {
  ops: PaintOp[];
  maskOps: PaintOp[];
  vectors: VStroke[] | null;
  mask: boolean;
  dirty: boolean;
  maskDirty: boolean;
}

export interface LiveStroke {
  layerId: number;
  toMask: boolean;
  op: StrokeOp;
  mode: StrokeMode;
  bounds: { x0: number; y0: number; x1: number; y1: number } | null;
  dabs: Dab[];
}

export const strokeMode = (op: StrokeOp, lock: boolean): StrokeMode => (op.brush.mode === 'erase' ? 'erase' : lock ? 'lock' : 'paint');

/** Every dab of a stroke op, symmetry copies included. */
export function opDabs(op: StrokeOp): Dab[] {
  return mirrorDabs(dabsFor(op.brush, op.size, op.seed, op.points), op.mirrors);
}

function samePrefix(have: readonly PaintOp[], want: readonly PaintOp[]): boolean {
  if (have.length > want.length) return false;
  for (let i = 0; i < have.length; i++) if (have[i] !== want[i]) return false;
  return true;
}

export abstract class Renderer {
  abstract readonly kind: 'webgl2' | 'canvas2d';
  /** Canvas px per side. */
  px = 0;
  protected state: DocState | null = null;
  protected drawn = new Map<number, Drawn>();
  protected live: LiveStroke | null = null;
  protected predicted: Dab[] = [];
  private frame = 0;
  /** Called after each drawn frame. */
  onFrame: (() => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {}

  // ---- what each engine provides
  protected abstract resizeTargets(px: number): void;
  protected abstract allocLayer(id: number): void;
  protected abstract freeLayer(id: number): void;
  protected abstract allocMask(id: number): void;
  protected abstract freeMask(id: number): void;
  protected abstract clearTarget(id: number, mask: boolean): void;
  protected abstract drawImage(id: number, mask: boolean, img: Img): void;
  protected abstract clearStroke(): void;
  protected abstract stampStroke(dabs: readonly Dab[], brush: Brush, color: string): void;
  protected abstract bake(id: number, mask: boolean, opacity: number, mode: StrokeMode, bounds: LiveStroke['bounds']): void;
  protected abstract smudge(id: number, mask: boolean, dabs: readonly Dab[], brush: Brush, prev: Dab | null): void;
  protected abstract present(entries: CompositeEntry[]): void;
  /** Composite some layers at full size, read back as a canvas `side` square. */
  protected abstract compositeCanvas(entries: CompositeEntry[], side: number): HTMLCanvasElement;
  protected abstract readTarget(id: number, mask: boolean, side: number): HTMLCanvasElement;
  /** The composite's colour at a canvas point (premultiplied 0..255), after the last frame. */
  abstract pixel(x: number, y: number): [number, number, number, number];
  abstract destroy(): void;

  // ---- size
  resize(px: number) {
    if (px === this.px) return;
    this.px = px;
    this.gen++;
    this.canvas.width = px;
    this.canvas.height = px;
    this.resizeTargets(px);
    for (const d of this.drawn.values()) {
      d.dirty = true;
      d.maskDirty = true;
      d.vectors = null;
    }
    if (this.state) this.sync(this.state);
  }

  /** Bring every layer's pixels in step with the drawing. */
  sync(state: DocState) {
    if (state !== this.state) this.gen++;
    this.state = state;
    if (!this.px) return;
    for (const id of [...this.drawn.keys()]) {
      if (!state.layers.some((l) => l.id === id)) {
        if (this.drawn.get(id)!.mask) this.freeMask(id);
        this.freeLayer(id);
        this.drawn.delete(id);
      }
    }
    for (const l of state.layers) {
      let d = this.drawn.get(l.id);
      if (!d) {
        this.allocLayer(l.id);
        d = { ops: [], maskOps: [], vectors: null, mask: false, dirty: false, maskDirty: false };
        this.drawn.set(l.id, d);
      }
      if (l.kind === 'vector') {
        if (d.vectors !== l.vectors || d.dirty) {
          this.drawVectorLayer(l.id, l.vectors);
          d.vectors = l.vectors;
          d.dirty = false;
        }
      } else {
        d.ops = this.catchUp(l.id, false, d.ops, l.ops, d.dirty);
        d.dirty = false;
      }
      if (l.hasMask && !d.mask) {
        this.allocMask(l.id);
        d.mask = true;
        d.maskOps = [];
      } else if (!l.hasMask && d.mask) {
        this.freeMask(l.id);
        d.mask = false;
        d.maskOps = [];
      }
      if (d.mask) {
        d.maskOps = this.catchUp(l.id, true, d.maskOps, l.maskOps, d.maskDirty);
        d.maskDirty = false;
      }
    }
    this.invalidate();
  }

  private catchUp(id: number, mask: boolean, have: PaintOp[], want: PaintOp[], dirty: boolean): PaintOp[] {
    if (!dirty && have === want) return want;
    if (!dirty && samePrefix(have, want)) {
      for (let i = have.length; i < want.length; i++) this.drawOp(id, mask, want[i]);
      return want;
    }
    this.clearTarget(id, mask);
    for (const op of want) this.drawOp(id, mask, op);
    return want;
  }

  private drawOp(id: number, mask: boolean, op: PaintOp) {
    if (op.kind === 'image') return this.drawImage(id, mask, op.image);
    const dabs = opDabs(op);
    if (op.brush.mode === 'smudge') return this.smudgeAll(id, mask, dabs, op.brush, (op.mirrors?.length ?? 1) || 1);
    this.clearStroke();
    this.stampStroke(dabs, op.brush, op.color);
    this.bake(id, mask, op.opacity, strokeMode(op, Boolean(op.lock)), dabBounds(dabs));
  }

  /** Smudge copies run one after another per symmetry copy (each drags its own paint). */
  private smudgeAll(id: number, mask: boolean, dabs: Dab[], brush: Brush, copies: number) {
    const per = Math.floor(dabs.length / copies);
    for (let c = 0; c < copies; c++) {
      const part = dabs.slice(c * per, (c + 1) * per);
      this.smudge(id, mask, part, brush, null);
    }
  }

  private drawVectorLayer(id: number, vectors: VStroke[]) {
    this.clearTarget(id, false);
    if (!vectors.length) return;
    const c = document.createElement('canvas');
    c.width = c.height = this.px;
    const g = c.getContext('2d');
    if (!g) return;
    drawVectors(g, vectors, this.px, this.px);
    this.drawImage(id, false, c);
  }

  // ---- the live stroke
  beginStroke(layerId: number, op: StrokeOp, toMask: boolean, lock: boolean) {
    this.live = { layerId, toMask, op, mode: strokeMode(op, lock), bounds: null, dabs: [] };
    this.predicted = [];
    if (op.brush.mode !== 'smudge') this.clearStroke();
  }

  /** New dabs for the live stroke (already mirrored). */
  addDabs(dabs: Dab[]) {
    const l = this.live;
    if (!l || !dabs.length) return;
    const b = dabBounds(dabs)!;
    l.bounds = l.bounds ? { x0: Math.min(l.bounds.x0, b.x0), y0: Math.min(l.bounds.y0, b.y0), x1: Math.max(l.bounds.x1, b.x1), y1: Math.max(l.bounds.y1, b.y1) } : b;
    if (l.op.brush.mode === 'smudge') {
      const copies = l.op.mirrors?.length || 1;
      const per = dabs.length / copies;
      for (let c = 0; c < copies; c++) {
        const part = dabs.slice(c * per, (c + 1) * per);
        const prevAll = l.dabs.length ? l.dabs.slice(c * (l.dabs.length / copies), (c + 1) * (l.dabs.length / copies)) : [];
        this.smudge(l.layerId, l.toMask, part, l.op.brush, prevAll[prevAll.length - 1] ?? null);
      }
      l.dabs = interleave(l.dabs, dabs, copies);
    } else {
      this.stampStroke(dabs, l.op.brush, l.op.color);
      l.dabs.push(...dabs);
    }
    this.invalidate();
  }

  /** Draw the live stroke again from scratch (the end taper once its length is known, a snapped shape). */
  replaceDabs(dabs: Dab[]) {
    const l = this.live;
    if (!l || l.op.brush.mode === 'smudge') return;
    this.clearStroke();
    l.dabs = [];
    l.bounds = null;
    this.addDabs(dabs);
  }

  /** Dabs just ahead of the pen (predicted): shown this frame only. */
  setPredicted(dabs: Dab[]) {
    this.predicted = this.live && this.live.op.brush.mode === 'paint' ? dabs : [];
    this.invalidate();
  }

  /**
   * The pen lifted. `commit`: the stroke goes onto the layer (and the layer counts it as drawn, so
   * the drawing's next state doesn't draw it twice). Otherwise it is dropped.
   */
  endStroke(commit: boolean) {
    const l = this.live;
    this.live = null;
    this.predicted = [];
    if (!l) return;
    const d = this.drawn.get(l.layerId);
    if (commit && l.op.brush.mode !== 'smudge') this.bake(l.layerId, l.toMask, l.op.opacity, l.mode, l.bounds);
    if (d) {
      if (!commit) {
        if (l.op.brush.mode === 'smudge') {
          if (l.toMask) d.maskDirty = true;
          else d.dirty = true;
        }
      } else if (l.toMask) d.maskOps = [...d.maskOps, l.op];
      else d.ops = [...d.ops, l.op];
    }
    this.invalidate();
  }

  get drawing() {
    return this.live !== null;
  }

  // ---- frames
  invalidate() {
    if (this.frame || typeof requestAnimationFrame === 'undefined') return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNow();
    });
  }

  renderNow() {
    if (!this.state || !this.px) return;
    this.present(this.entries(this.state.layers.filter((l) => l.visible)));
    this.onFrame?.();
  }

  protected entries(layers: readonly Layer[], all: readonly Layer[] = this.state?.layers ?? layers): CompositeEntry[] {
    return layers.map((l) => {
      const at = all.indexOf(l);
      const base = at >= 0 ? clipBase(all, at) : null;
      return { id: l.id, opacity: l.opacity, blend: l.blend, mask: l.hasMask && (this.drawn.get(l.id)?.mask ?? false), clip: base?.id ?? null, clipMask: Boolean(base?.hasMask) };
    });
  }

  // ---- reading pixels back
  /**
   * The visible layers (or those `filter` keeps), blended, as a canvas `side` square. With a `key`,
   * the result is kept until the drawing changes (Bring to life asks for it 8 times a second): the
   * canvas returned is shared, so read it, don't draw on it.
   */
  snapshot(side: number, filter: (l: Layer) => boolean = () => true, key?: string): HTMLCanvasElement {
    const k = key ? `${key}:${side}` : null;
    const hit = k ? this.snaps.get(k) : undefined;
    if (hit && hit.state === this.state && hit.gen === this.gen) return hit.canvas;
    const layers = (this.state?.layers ?? []).filter((l) => l.visible && filter(l));
    const canvas = this.compositeCanvas(this.entries(layers), side);
    if (k) this.snaps.set(k, { state: this.state, gen: this.gen, canvas });
    return canvas;
  }
  private snaps = new Map<string, { state: DocState | null; gen: number; canvas: HTMLCanvasElement }>();
  /** Goes up whenever pixels change outside a new state (a resize, a lost GPU coming back). */
  protected gen = 0;

  /** One layer's own pixels (no opacity, no mask), `side` square. */
  layerCanvas(id: number, side: number): HTMLCanvasElement {
    return this.readTarget(id, false, side);
  }

  /** A layer's mask as the PSD wants it: white shows, black hides. */
  maskCanvas(id: number, side: number): HTMLCanvasElement | null {
    if (!this.drawn.get(id)?.mask) return null;
    const hidden = this.readTarget(id, true, side);
    const out = document.createElement('canvas');
    out.width = out.height = side;
    const g = out.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, side, side);
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(hidden, 0, 0);
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = '#000000';
    g.fillRect(0, 0, side, side);
    return out;
  }

  /** A layer and the one under it drawn together (for Merge down), full size. */
  mergedImage(lowerId: number, upperId: number): HTMLCanvasElement {
    const all = this.state?.layers ?? [];
    const lower = all.find((l) => l.id === lowerId);
    const upper = all.find((l) => l.id === upperId);
    const entries: CompositeEntry[] = [];
    if (lower) entries.push({ id: lower.id, opacity: 1, blend: 'normal', mask: lower.hasMask, clip: null, clipMask: false });
    if (upper) entries.push({ id: upper.id, opacity: upper.opacity, blend: upper.blend, mask: upper.hasMask, clip: upper.clip && lower ? lower.id : null, clipMask: Boolean(upper.clip && lower?.hasMask) });
    return this.compositeCanvas(entries, this.px);
  }
}

/** Live smudge dabs are kept per symmetry copy in order: copy 0's, then copy 1's… */
function interleave(have: Dab[], add: Dab[], copies: number): Dab[] {
  if (copies <= 1) return [...have, ...add];
  const hp = have.length / copies;
  const ap = add.length / copies;
  const out: Dab[] = [];
  for (let c = 0; c < copies; c++) out.push(...have.slice(c * hp, (c + 1) * hp), ...add.slice(c * ap, (c + 1) * ap));
  return out;
}

/** "#rrggbb" as 0..1 floats. */
export function rgb01(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The renderer this device can run: the GPU one when WebGL2 is there (unless turned off), else 2D. */
export async function createRenderer(canvas: HTMLCanvasElement, prefer: 'auto' | '2d' = 'auto'): Promise<Renderer> {
  if (prefer !== '2d') {
    try {
      const { GLRenderer } = await import('./gl');
      const r = GLRenderer.create(canvas);
      if (r) return r;
    } catch {
      /* no WebGL2: the 2D one */
    }
  }
  const { Canvas2DRenderer } = await import('./canvas2d');
  return new Canvas2DRenderer(canvas);
}
