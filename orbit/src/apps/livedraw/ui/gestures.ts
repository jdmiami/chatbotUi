/**
 * The canvas view (zoom, turn, move) as maths: two fingers pinch to zoom and twist to turn, the point
 * under your fingers stays under them; on lifting, a quick pinch-in snaps back to the whole canvas and
 * a turn close to upright (or a quarter turn) settles onto it.
 */
export interface View {
  /** Zoom. */
  s: number;
  /** Turn, radians. */
  r: number;
  tx: number;
  ty: number;
}

export interface XY {
  x: number;
  y: number;
}

export const FIT: View = { s: 1, r: 0, tx: 0, ty: 0 };
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 8;
/** Turns within this of upright or a quarter turn settle onto it. */
export const SNAP_TURN = (7 * Math.PI) / 180;

/** A screen point (relative to the paper's untransformed top-left) in paper px. */
export function toPaper(v: View, p: XY): XY {
  const x = p.x - v.tx;
  const y = p.y - v.ty;
  const c = Math.cos(-v.r);
  const s = Math.sin(-v.r);
  return { x: (x * c - y * s) / v.s, y: (x * s + y * c) / v.s };
}

/** A paper px point on the screen (relative to the paper's untransformed top-left). */
export function fromPaper(v: View, p: XY): XY {
  const c = Math.cos(v.r);
  const s = Math.sin(v.r);
  return { x: v.tx + v.s * (p.x * c - p.y * s), y: v.ty + v.s * (p.x * s + p.y * c) };
}

export const cssTransform = (v: View) => `translate(${v.tx}px, ${v.ty}px) rotate(${v.r}rad) scale(${v.s})`;

/**
 * Two fingers moved from (a0, b0) to (a1, b1): the view that keeps the paper point that was under
 * their middle under it, zoomed by how far apart they are and turned by how much they twisted.
 */
export function pinchView(v0: View, a0: XY, b0: XY, a1: XY, b1: XY): View {
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y) || 1;
  const d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y) || 1;
  const t0 = Math.atan2(b0.y - a0.y, b0.x - a0.x);
  const t1 = Math.atan2(b1.y - a1.y, b1.x - a1.x);
  const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (v0.s * d1) / d0));
  const r = v0.r + Math.atan2(Math.sin(t1 - t0), Math.cos(t1 - t0));
  const P = toPaper(v0, m0);
  const c = Math.cos(r);
  const sn = Math.sin(r);
  return { s, r, tx: m1.x - s * (P.x * c - P.y * sn), ty: m1.y - s * (P.x * sn + P.y * c) };
}

/** Zoom by `k` about a screen point (mouse wheel, trackpad). */
export function zoomAbout(v: View, at: XY, k: number): View {
  const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.s * k));
  const P = toPaper(v, at);
  const c = Math.cos(v.r);
  const sn = Math.sin(v.r);
  return { ...v, s, tx: at.x - s * (P.x * c - P.y * sn), ty: at.y - s * (P.x * sn + P.y * c) };
}

/**
 * Where the view settles when the fingers lift: zoomed out past the whole canvas → the whole canvas;
 * nearly upright or a quarter turn → exactly that (the paper point at `centre` stays put); nearly
 * upright at nearly 100 % → the whole canvas.
 */
export function settleView(v: View, centre: XY): View {
  if (v.s < 0.95) return FIT;
  const quarter = Math.PI / 2;
  const k = Math.round(v.r / quarter);
  const target = k * quarter;
  if (Math.abs(v.r - target) > SNAP_TURN) return v;
  const norm = ((target % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (norm < 1e-6 && Math.abs(v.s - 1) < 0.04) return FIT;
  const P = toPaper(v, centre);
  const c = Math.cos(target);
  const sn = Math.sin(target);
  return { s: v.s, r: target, tx: centre.x - v.s * (P.x * c - P.y * sn), ty: centre.y - v.s * (P.x * sn + P.y * c) };
}

/** Between two views (0..1), turning the short way. */
export function lerpView(a: View, b: View, t: number): View {
  const dr = Math.atan2(Math.sin(b.r - a.r), Math.cos(b.r - a.r));
  return { s: a.s + (b.s - a.s) * t, r: a.r + dr * t, tx: a.tx + (b.tx - a.tx) * t, ty: a.ty + (b.ty - a.ty) * t };
}

/** A tap with several fingers: what it does. */
export function tapAction(fingers: number): 'undo' | 'redo' | 'ui' | null {
  if (fingers === 2) return 'undo';
  if (fingers === 3) return 'redo';
  if (fingers >= 4) return 'ui';
  return null;
}
