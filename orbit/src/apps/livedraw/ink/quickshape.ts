/**
 * Shape snapping: draw a rough line, arc, circle or box and hold the pen still at the end; it becomes
 * the clean shape. Plain geometry on the stroke's points: a line if every point is close to the
 * chord, an arc if they sit on the circle through the start, middle and end, and for a closed loop
 * whichever fits better of an ellipse (circle when nearly round) and a rectangle (square-on when
 * nearly level).
 */
import type { Pt } from '../canvas/sketch';

export interface XY {
  x: number;
  y: number;
}

export type Shape =
  | { kind: 'line'; a: XY; b: XY }
  | { kind: 'arc'; cx: number; cy: number; r: number; start: number; sweep: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; angle: number }
  | { kind: 'rect'; cx: number; cy: number; w: number; h: number; angle: number };

export const SHAPE_NAMES: Record<Shape['kind'], string> = { line: 'a line', arc: 'an arc', ellipse: 'an ellipse', rect: 'a rectangle' };

const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(pts: readonly XY[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += dist(pts[i], pts[i - 1]);
  return n;
}

/** The point halfway along the path (by length). */
function midAlong(pts: readonly XY[]): XY {
  const half = pathLength(pts) / 2;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i], pts[i - 1]);
    if (acc + d >= half) {
      const t = d ? (half - acc) / d : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    acc += d;
  }
  return pts[pts.length - 1];
}

/** The circle through three points, or null when they are in a line. */
export function circleThrough(a: XY, b: XY, c: XY): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}

function rotate(p: XY, c: XY, ang: number): XY {
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: dx * cs - dy * sn, y: dx * sn + dy * cs };
}

function fitEllipse(pts: readonly XY[]) {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const local = pts.map((p) => rotate(p, { x: mx, y: my }, -angle));
  const u0 = Math.min(...local.map((p) => p.x));
  const u1 = Math.max(...local.map((p) => p.x));
  const v0 = Math.min(...local.map((p) => p.y));
  const v1 = Math.max(...local.map((p) => p.y));
  const rx = (u1 - u0) / 2;
  const ry = (v1 - v0) / 2;
  // Centre at the middle of the extents (a loop drawn unevenly has its mean off-centre).
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  const cx = mx + cu * cs - cv * sn;
  const cy = my + cu * sn + cv * cs;
  if (rx < 1e-4 || ry < 1e-4) return null;
  let err = 0;
  for (const p of local) err += Math.abs(Math.hypot((p.x - cu) / rx, (p.y - cv) / ry) - 1);
  return { cx, cy, rx, ry, angle, err: err / n };
}

function fitRect(pts: readonly XY[]) {
  // The tightest box over turns of 0..90°, then how far points sit from its sides.
  let best: { cx: number; cy: number; w: number; h: number; angle: number; area: number } | null = null;
  const c = { x: 0, y: 0 };
  for (let deg = 0; deg < 90; deg += 1.5) {
    const ang = (deg * Math.PI) / 180;
    const local = pts.map((p) => rotate(p, c, -ang));
    const u0 = Math.min(...local.map((p) => p.x));
    const u1 = Math.max(...local.map((p) => p.x));
    const v0 = Math.min(...local.map((p) => p.y));
    const v1 = Math.max(...local.map((p) => p.y));
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-12) {
      const cu = (u0 + u1) / 2;
      const cv = (v0 + v1) / 2;
      best = { cx: cu * Math.cos(ang) - cv * Math.sin(ang), cy: cu * Math.sin(ang) + cv * Math.cos(ang), w: u1 - u0, h: v1 - v0, angle: ang, area };
    }
  }
  if (!best || best.w < 1e-4 || best.h < 1e-4) return null;
  let err = 0;
  for (const p of pts) {
    const l = rotate(p, { x: best.cx, y: best.cy }, -best.angle);
    const dx = Math.abs(Math.abs(l.x) - best.w / 2);
    const dy = Math.abs(Math.abs(l.y) - best.h / 2);
    // Distance to the nearer side (inside or out).
    err += Math.min(Math.abs(l.y) <= best.h / 2 ? dx : Math.hypot(dx, Math.abs(l.y) - best.h / 2), Math.abs(l.x) <= best.w / 2 ? dy : Math.hypot(dy, Math.abs(l.x) - best.w / 2));
  }
  return { ...best, err: err / pts.length / Math.min(best.w, best.h) };
}

/** The clean shape a rough stroke is closest to, or null when it isn't close to any. */
export function recognize(points: readonly XY[]): Shape | null {
  if (points.length < 3) return null;
  const len = pathLength(points);
  if (len < 0.02) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const chord = dist(first, last);
  const closed = chord < 0.2 * len && len > 0.06;
  if (!closed) {
    if (chord < 1e-4) return null;
    // A line: no point far from the chord.
    let dev = 0;
    for (const p of points) dev = Math.max(dev, Math.abs((last.x - first.x) * (first.y - p.y) - (first.x - p.x) * (last.y - first.y)) / chord);
    if (dev < 0.06 * chord && len < chord * 1.08) return { kind: 'line', a: { x: first.x, y: first.y }, b: { x: last.x, y: last.y } };
    const mid = midAlong(points);
    const c = circleThrough(first, mid, last);
    if (!c || c.r > 2) return null;
    let err = 0;
    for (const p of points) err += Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.r);
    if (err / points.length / c.r > 0.08) return null;
    const a0 = Math.atan2(first.y - c.cy, first.x - c.cx);
    const am = Math.atan2(mid.y - c.cy, mid.x - c.cx);
    const a1 = Math.atan2(last.y - c.cy, last.x - c.cx);
    const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    // Sweep the way that passes through the middle point.
    let sweep = norm(a1 - a0);
    if (norm(am - a0) > sweep) sweep -= 2 * Math.PI;
    return { kind: 'arc', cx: c.cx, cy: c.cy, r: c.r, start: a0, sweep };
  }
  const e = fitEllipse(points);
  const r = fitRect(points);
  const eOk = e && e.err < 0.14;
  const rOk = r && r.err < 0.1;
  if (rOk && (!eOk || r.err * 1.6 < e!.err)) {
    let angle = r.angle;
    let w = r.w;
    let h = r.h;
    // Nearly level: make it level (and a turned-by-90 box is the same box, sides swapped).
    const deg = (angle * 180) / Math.PI;
    if (deg < 6) angle = 0;
    else if (deg > 84) {
      angle = 0;
      [w, h] = [h, w];
    }
    return { kind: 'rect', cx: r.cx, cy: r.cy, w, h, angle };
  }
  if (eOk && e) {
    if (Math.abs(e.rx - e.ry) / Math.max(e.rx, e.ry) < 0.12) {
      const rr = (e.rx + e.ry) / 2;
      return { kind: 'ellipse', cx: e.cx, cy: e.cy, rx: rr, ry: rr, angle: 0 };
    }
    return { kind: 'ellipse', cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry, angle: e.angle };
  }
  return null;
}

/** The shape as stroke points (even pressure, `p`), dense enough for any brush. */
export function shapePoints(s: Shape, p = 0.5, tilt = 0): Pt[] {
  const pt = (x: number, y: number): Pt => ({ x, y, p, tilt });
  const out: Pt[] = [];
  switch (s.kind) {
    case 'line': {
      const n = Math.max(2, Math.ceil(dist(s.a, s.b) / 0.01));
      for (let i = 0; i <= n; i++) out.push(pt(s.a.x + ((s.b.x - s.a.x) * i) / n, s.a.y + ((s.b.y - s.a.y) * i) / n));
      return out;
    }
    case 'arc': {
      const n = Math.max(8, Math.ceil((Math.abs(s.sweep) * s.r) / 0.008));
      for (let i = 0; i <= n; i++) {
        const a = s.start + (s.sweep * i) / n;
        out.push(pt(s.cx + Math.cos(a) * s.r, s.cy + Math.sin(a) * s.r));
      }
      return out;
    }
    case 'ellipse': {
      const n = Math.max(24, Math.ceil((Math.PI * 2 * Math.max(s.rx, s.ry)) / 0.008));
      const cs = Math.cos(s.angle);
      const sn = Math.sin(s.angle);
      for (let i = 0; i <= n; i++) {
        const a = (Math.PI * 2 * i) / n;
        const u = Math.cos(a) * s.rx;
        const v = Math.sin(a) * s.ry;
        out.push(pt(s.cx + u * cs - v * sn, s.cy + u * sn + v * cs));
      }
      return out;
    }
    case 'rect': {
      const cs = Math.cos(s.angle);
      const sn = Math.sin(s.angle);
      const corners = [
        [-s.w / 2, -s.h / 2],
        [s.w / 2, -s.h / 2],
        [s.w / 2, s.h / 2],
        [-s.w / 2, s.h / 2],
        [-s.w / 2, -s.h / 2],
      ].map(([u, v]) => ({ x: s.cx + u * cs - v * sn, y: s.cy + u * sn + v * cs }));
      for (let k = 0; k < 4; k++) {
        const a = corners[k];
        const b = corners[k + 1];
        const n = Math.max(2, Math.ceil(dist(a, b) / 0.01));
        for (let i = k ? 1 : 0; i <= n; i++) out.push(pt(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n));
      }
      return out;
    }
  }
}

/** After snapping, keep holding and move: a line's end follows the pen; other shapes grow or shrink from their start. */
export function adjustShape(s: Shape, anchor: XY, from: XY, to: XY): Shape {
  if (s.kind === 'line') return { ...s, b: { x: to.x, y: to.y } };
  const d0 = dist(anchor, from);
  const k = d0 > 1e-4 ? Math.max(0.05, dist(anchor, to) / d0) : 1;
  const sc = (x: number, y: number) => ({ x: anchor.x + (x - anchor.x) * k, y: anchor.y + (y - anchor.y) * k });
  if (s.kind === 'arc') {
    const c = sc(s.cx, s.cy);
    return { ...s, cx: c.x, cy: c.y, r: s.r * k };
  }
  const c = sc(s.cx, s.cy);
  if (s.kind === 'ellipse') return { ...s, cx: c.x, cy: c.y, rx: s.rx * k, ry: s.ry * k };
  return { ...s, cx: c.x, cy: c.y, w: s.w * k, h: s.h * k };
}

/** Held still: the pen moved less than `tol` over the samples from `since` (ms) on. */
export function heldStill(samples: readonly { x: number; y: number; t: number }[], since: number, tol = 0.006): boolean {
  const recent = samples.filter((s) => s.t >= since);
  if (recent.length < 2) return true;
  const a = recent[0];
  return recent.every((s) => Math.hypot(s.x - a.x, s.y - a.y) <= tol);
}
