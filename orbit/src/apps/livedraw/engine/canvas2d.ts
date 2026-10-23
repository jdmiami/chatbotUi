/**
 * The 2D-canvas engine: the same layers, strokes and blend modes as the GPU one, drawn with the
 * browser's canvas (its composite operations cover every blend mode). Used where WebGL2 isn't there,
 * and for the brush previews (renderBrushPreview), which are small and many.
 */
import { dabBounds, dabsFor } from '../brushes/dabs';
import type { Brush, Dab } from '../brushes/types';
import { CANVAS_OP } from './blend';
import { Renderer, type CompositeEntry, type Img, type LiveStroke, type StrokeMode } from './renderer';
import { GRAIN, alphaToRgba, cachedGrain, cachedTip, TIP } from './textures';

const make = (w: number, h = w) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
const ctx2 = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: false })!;

const tipCanvases = new Map<string, HTMLCanvasElement>();
const tinted = new Map<string, HTMLCanvasElement>();
const grainCanvases = new Map<string, HTMLCanvasElement>();

function alphaCanvas(bytes: Uint8Array, size: number): HTMLCanvasElement {
  const c = make(size);
  const g = ctx2(c);
  const img = g.createImageData(size, size);
  img.data.set(alphaToRgba(bytes));
  g.putImageData(img, 0, 0);
  return c;
}

/** The brush's tip in a colour (cached). */
function tipFor(brush: Brush, color: string): HTMLCanvasElement {
  const key = brush.shape === 'round' ? `round:${Math.round(brush.hardness * 20)}` : brush.shape;
  const tk = `${key}|${color}`;
  let t = tinted.get(tk);
  if (t) return t;
  let base = tipCanvases.get(key);
  if (!base) tipCanvases.set(key, (base = alphaCanvas(cachedTip(brush.shape, brush.hardness), TIP)));
  t = make(TIP);
  const g = ctx2(t);
  g.drawImage(base, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, TIP, TIP);
  if (tinted.size > 64) tinted.clear();
  tinted.set(tk, t);
  return t;
}

/** The grain at a depth, as a pattern tile (alpha = what shows). */
function grainTile(brush: Brush): HTMLCanvasElement | null {
  if (brush.grain === 'none' || brush.grainDepth <= 0) return null;
  const key = `${brush.grain}:${Math.round(brush.grainDepth * 20)}`;
  let c = grainCanvases.get(key);
  if (!c) {
    const g = cachedGrain(brush.grain);
    const k = brush.grainDepth;
    const mixed = new Uint8Array(g.length);
    for (let i = 0; i < g.length; i++) mixed[i] = Math.round(255 * (1 - k) + g[i] * k);
    grainCanvases.set(key, (c = alphaCanvas(mixed, GRAIN)));
  }
  return c;
}

/** Stamp dabs onto a 2D context `w` px wide (canvas units scale by w and h), grain printed through. */
export function stamp2d(target: CanvasRenderingContext2D, dabs: readonly Dab[], brush: Brush, color: string, w: number, h: number, scratch?: HTMLCanvasElement) {
  if (!dabs.length) return;
  const tip = tipFor(brush, color);
  const grain = grainTile(brush);
  let g = target;
  let tmp: HTMLCanvasElement | null = null;
  if (grain) {
    tmp = scratch && scratch.width === w && scratch.height === h ? scratch : make(w, h);
    g = ctx2(tmp);
    g.clearRect(0, 0, w, h);
  }
  for (const d of dabs) {
    let size = d.size * w;
    let alpha = d.alpha;
    if (size < 1.5) {
      alpha *= size / 1.5;
      size = 1.5;
    }
    g.save();
    g.globalAlpha = alpha;
    g.translate(d.x * w, d.y * h);
    g.rotate(d.angle);
    g.scale(1, d.roundness);
    g.drawImage(tip, -size / 2, -size / 2, size, size);
    g.restore();
  }
  if (grain && tmp) {
    const pat = g.createPattern(grain, 'repeat');
    if (pat) {
      const s = brush.grainScale * Math.max(0.6, w / 1600);
      try {
        pat.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
      } catch {
        /* older browsers: unscaled grain */
      }
      g.save();
      g.globalCompositeOperation = 'destination-in';
      g.fillStyle = pat;
      const b = dabBounds(dabs)!;
      g.fillRect(Math.floor(b.x0 * w) - 2, Math.floor(b.y0 * h) - 2, Math.ceil((b.x1 - b.x0) * w) + 4, Math.ceil((b.y1 - b.y0) * h) + 4);
      g.restore();
    }
    target.drawImage(tmp, 0, 0);
  }
}

export class Canvas2DRenderer extends Renderer {
  readonly kind = 'canvas2d' as const;
  private layers = new Map<number, HTMLCanvasElement>();
  private masks = new Map<number, HTMLCanvasElement>();
  private strokeC = make(1);
  private grainScratch = make(1);
  private w1 = make(1);
  private w2 = make(1);
  private pick = make(1);

  protected resizeTargets(px: number) {
    for (const c of [this.strokeC, this.grainScratch, this.w1, this.w2]) {
      c.width = px;
      c.height = px;
    }
    for (const c of this.layers.values()) c.width = c.height = px;
    for (const c of this.masks.values()) c.width = c.height = px;
  }
  protected allocLayer(id: number) {
    if (!this.layers.has(id)) this.layers.set(id, make(this.px));
  }
  protected freeLayer(id: number) {
    const c = this.layers.get(id);
    if (c) c.width = c.height = 1;
    this.layers.delete(id);
  }
  protected allocMask(id: number) {
    if (!this.masks.has(id)) this.masks.set(id, make(this.px));
  }
  protected freeMask(id: number) {
    const c = this.masks.get(id);
    if (c) c.width = c.height = 1;
    this.masks.delete(id);
  }
  private tgt(id: number, mask: boolean) {
    return (mask ? this.masks : this.layers).get(id);
  }
  protected clearTarget(id: number, mask: boolean) {
    const c = this.tgt(id, mask);
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  }
  protected drawImage(id: number, mask: boolean, img: Img) {
    const c = this.tgt(id, mask);
    c?.getContext('2d')?.drawImage(img, 0, 0, this.px, this.px);
  }
  protected clearStroke() {
    ctx2(this.strokeC).clearRect(0, 0, this.px, this.px);
  }
  protected stampStroke(dabs: readonly Dab[], brush: Brush, color: string) {
    stamp2d(ctx2(this.strokeC), dabs, brush, color, this.px, this.px, this.grainScratch);
  }
  private applyStroke(g: CanvasRenderingContext2D, opacity: number, mode: StrokeMode) {
    g.save();
    g.globalAlpha = opacity;
    g.globalCompositeOperation = mode === 'erase' ? 'destination-out' : mode === 'lock' ? 'source-atop' : 'source-over';
    g.drawImage(this.strokeC, 0, 0);
    g.restore();
  }
  protected bake(id: number, mask: boolean, opacity: number, mode: StrokeMode, _bounds: LiveStroke['bounds']) {
    const c = this.tgt(id, mask);
    if (c) this.applyStroke(ctx2(c), opacity, mode);
  }
  protected smudge(id: number, mask: boolean, dabs: readonly Dab[], brush: Brush, prev: Dab | null) {
    const c = this.tgt(id, mask);
    if (!c || !dabs.length) return;
    const g = ctx2(c);
    const px = this.px;
    const tip = tipFor({ ...brush, shape: brush.shape }, '#ffffff');
    let from = prev ?? dabs[0];
    for (let i = prev ? 0 : 1; i < dabs.length; i++) {
      const d = dabs[i];
      const size = Math.max(2, Math.round(d.size * px));
      if (this.pick.width !== size) this.pick.width = this.pick.height = size;
      const pg = ctx2(this.pick);
      pg.globalCompositeOperation = 'copy';
      pg.drawImage(c, from.x * px - size / 2, from.y * px - size / 2, size, size, 0, 0, size, size);
      pg.globalCompositeOperation = 'destination-in';
      pg.drawImage(tip, 0, 0, size, size);
      // What is under the tip moves toward the picked-up paint (L·(1−k) + P·k), so smudging never piles paint up.
      g.save();
      g.globalAlpha = Math.min(1, brush.smudge * d.alpha);
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(tip, d.x * px - size / 2, d.y * px - size / 2, size, size);
      g.globalCompositeOperation = 'lighter';
      g.drawImage(this.pick, d.x * px - size / 2, d.y * px - size / 2);
      g.restore();
      from = d;
    }
  }

  /** The layers blended onto `g` (cleared first). */
  private compose(g: CanvasRenderingContext2D, entries: CompositeEntry[], withLive: boolean) {
    const px = this.px;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    for (const e of entries) {
      const layer = this.layers.get(e.id);
      if (!layer) continue;
      const live = withLive && this.live && this.live.layerId === e.id && this.live.op.brush.mode !== 'smudge' ? this.live : null;
      let src: HTMLCanvasElement = layer;
      const mask = e.mask ? this.masks.get(e.id) : undefined;
      const clip = e.clip !== null ? this.layers.get(e.clip) : undefined;
      if ((live && !live.toMask) || mask || clip) {
        const w = ctx2(this.w1);
        w.globalCompositeOperation = 'copy';
        w.globalAlpha = 1;
        w.drawImage(layer, 0, 0);
        if (live && !live.toMask) this.applyStroke(w, live.op.opacity, live.mode);
        if (mask) {
          let m: HTMLCanvasElement = mask;
          if (live?.toMask) {
            const w2 = ctx2(this.w2);
            w2.globalCompositeOperation = 'copy';
            w2.drawImage(mask, 0, 0);
            this.applyStroke(w2, live.op.opacity, live.mode);
            m = this.w2;
          }
          w.globalCompositeOperation = 'destination-out';
          w.drawImage(m, 0, 0);
        }
        if (clip) {
          w.globalCompositeOperation = 'destination-in';
          w.drawImage(clip, 0, 0);
          const cm = e.clipMask && e.clip !== null ? this.masks.get(e.clip) : undefined;
          if (cm) {
            w.globalCompositeOperation = 'destination-out';
            w.drawImage(cm, 0, 0);
          }
        }
        w.globalCompositeOperation = 'source-over';
        src = this.w1;
      }
      g.globalAlpha = e.opacity;
      g.globalCompositeOperation = CANVAS_OP[e.blend];
      g.drawImage(src, 0, 0, px, px);
    }
    g.restore();
  }

  protected present(entries: CompositeEntry[]) {
    const g = ctx2(this.canvas);
    this.compose(g, entries, true);
    if (this.predicted.length && this.live) {
      g.save();
      g.globalAlpha = this.live.op.opacity;
      stamp2d(g, this.predicted, this.live.op.brush, this.live.op.color, this.px, this.px);
      g.restore();
    }
  }

  protected compositeCanvas(entries: CompositeEntry[], side: number): HTMLCanvasElement {
    const full = make(this.px);
    this.compose(ctx2(full), entries, false);
    if (side === this.px) return full;
    const out = make(side);
    const g = ctx2(out);
    g.imageSmoothingQuality = 'high';
    g.drawImage(full, 0, 0, side, side);
    return out;
  }

  protected readTarget(id: number, mask: boolean, side: number): HTMLCanvasElement {
    const out = make(side);
    const c = this.tgt(id, mask);
    if (c) {
      const g = ctx2(out);
      g.imageSmoothingQuality = 'high';
      g.drawImage(c, 0, 0, side, side);
    }
    return out;
  }

  pixel(x: number, y: number): [number, number, number, number] {
    const d = this.canvas.getContext('2d')?.getImageData(Math.min(this.px - 1, Math.floor(x * this.px)), Math.min(this.px - 1, Math.floor(y * this.px)), 1, 1).data;
    if (!d) return [0, 0, 0, 0];
    const a = d[3] / 255;
    return [Math.round(d[0] * a), Math.round(d[1] * a), Math.round(d[2] * a), d[3]];
  }

  destroy() {
    for (const c of this.layers.values()) c.width = c.height = 1;
    for (const c of this.masks.values()) c.width = c.height = 1;
    this.layers.clear();
    this.masks.clear();
  }
}

/**
 * A brush's preview: an S-shaped stroke from light to firm pressure (then back), on a canvas `w` × `h`.
 * Tilt stays upright; speed is steady. Erasers show as a stroke cut out of a grey band; smudge as a
 * band of colours pulled sideways.
 */
export function renderBrushPreview(canvas: HTMLCanvasElement, brush: Brush, color: string, opts: { scale?: number } = {}) {
  const w = canvas.width;
  const h = canvas.height;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, w, h);
  // Points in a w-wide frame: canvas units by width, y scaled to the height.
  const n = 64;
  const pts = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return { x: 0.08 + 0.84 * t, y: ((0.5 + 0.28 * Math.sin(t * Math.PI * 2)) * h) / w, p: Math.sin(t * Math.PI) * 0.9 + 0.05, tilt: 0, t: i * 8 };
  });
  // Preview size: the brush scaled so the stroke fills the band (thin pens drawn bigger to be seen).
  const want = Math.min((h / w) * 0.55, Math.max(brush.size * 3, 0.02));
  const size = want * (opts.scale ?? 1);
  const dabs = dabsFor(brush, size, 7, pts);
  const scaled = dabs.map((d) => ({ ...d, y: d.y }));
  if (brush.mode === 'erase' || brush.mode === 'smudge') {
    const band = make(w, h);
    const bg = ctx2(band);
    const grad = bg.createLinearGradient(0, 0, w, 0);
    // Erasers cut through a mid grey band (it shows on light and dark alike); smudge pulls colours.
    grad.addColorStop(0, brush.mode === 'smudge' ? '#d6452b' : '#8d8a84');
    grad.addColorStop(0.5, brush.mode === 'smudge' ? '#e5c21c' : '#8d8a84');
    grad.addColorStop(1, brush.mode === 'smudge' ? '#2f6fdb' : '#8d8a84');
    bg.fillStyle = grad;
    bg.globalAlpha = 0.85;
    bg.fillRect(0, h * 0.3, w, h * 0.4);
    if (brush.mode === 'erase') {
      const s = make(w, h);
      stamp2d(ctx2(s), scaled, brush, '#000000', w, w);
      bg.globalAlpha = brush.opacity;
      bg.globalCompositeOperation = 'destination-out';
      bg.drawImage(s, 0, 0);
    } else {
      // Smudge: drag the band along the stroke.
      const tip = tipFor(brush, '#ffffff');
      const pick = make(4);
      let from = scaled[0];
      for (const d of scaled.slice(1)) {
        const sz = Math.max(2, Math.round(d.size * w));
        pick.width = pick.height = sz;
        const pg = ctx2(pick);
        pg.drawImage(band, from.x * w - sz / 2, from.y * w - sz / 2, sz, sz, 0, 0, sz, sz);
        pg.globalCompositeOperation = 'destination-in';
        pg.drawImage(tip, 0, 0, sz, sz);
        bg.globalCompositeOperation = 'source-over';
        bg.globalAlpha = Math.min(1, brush.smudge * d.alpha);
        bg.drawImage(pick, d.x * w - sz / 2, d.y * w - sz / 2);
        from = d;
      }
    }
    g.drawImage(band, 0, 0);
    return;
  }
  const s = make(w, h);
  stamp2d(ctx2(s), scaled, brush, color, w, w);
  g.globalAlpha = brush.opacity;
  g.drawImage(s, 0, 0);
  g.globalAlpha = 1;
}
