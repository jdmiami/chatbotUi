/**
 * Vector ink: strokes that stay editable. A stroke is a few control points (the drawn line,
 * simplified) joined by a smooth curve through them, its width following the pressure at each point.
 * Select one to move its points, change its width or colour; it is drawn as a filled outline (crisp at
 * any size) and becomes pixels only when the drawing is saved.
 */
import type { Pt } from '../canvas/sketch';

export interface VStroke {
  id: number;
  points: Pt[];
  /** Width at full pressure (fraction of the canvas side). */
  width: number;
  color: string;
}

interface XY {
  x: number;
  y: number;
}

function segDist(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Fewer points, same line (Ramer–Douglas–Peucker): every dropped point is within `eps` of the result. */
export function simplify<T extends XY>(pts: readonly T[], eps = 0.0015): T[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(pts[k], pts[i], pts[j]);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (worst > eps && at > 0) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/** The smooth curve through the control points (Catmull–Rom), `per` samples between each pair. */
export function sampleCurve(pts: readonly Pt[], per = 8): Pt[] {
  if (pts.length < 3) return pts.slice();
  const out: Pt[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 1; s <= per; s++) {
      const t = s / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), p: p1.p + (p2.p - p1.p) * t, tilt: 0 });
    }
  }
  return out;
}

/** Width at one point: pressure thins it down to a third. */
export const vWidth = (s: Pick<VStroke, 'width'>, p: number) => s.width * (0.3 + 0.7 * Math.min(1, Math.max(0, p)));

/** Draw vector strokes onto a canvas `w` × `h` px (canvas units scale to w and h). */
export function drawVectors(ctx: CanvasRenderingContext2D, strokes: readonly VStroke[], w: number, h: number, opts: { color?: string } = {}) {
  ctx.save();
  for (const s of strokes) {
    ctx.fillStyle = opts.color ?? s.color;
    const pts = sampleCurve(s.points);
    if (!pts.length) continue;
    // Circles at each sample, joined by quads: a clean variable-width outline, filled once per stroke.
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i];
      const r = (vWidth(s, q.p) * w) / 2;
      ctx.moveTo(q.x * w + r, q.y * h);
      ctx.arc(q.x * w, q.y * h, r, 0, Math.PI * 2);
      if (i) {
        const a = pts[i - 1];
        const ra = (vWidth(s, a.p) * w) / 2;
        const dx = q.x * w - a.x * w;
        const dy = q.y * h - a.y * h;
        const l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l;
        const ny = dx / l;
        const quad = [
          [a.x * w + nx * ra, a.y * h + ny * ra],
          [q.x * w + nx * r, q.y * h + ny * r],
          [q.x * w - nx * r, q.y * h - ny * r],
          [a.x * w - nx * ra, a.y * h - ny * ra],
        ];
        // Every piece wound the same way as the circles, so 'nonzero' fills overlaps instead of cutting holes.
        let area = 0;
        for (let k = 0; k < 4; k++) area += quad[k][0] * quad[(k + 1) % 4][1] - quad[(k + 1) % 4][0] * quad[k][1];
        if (area < 0) quad.reverse();
        ctx.moveTo(quad[0][0], quad[0][1]);
        for (let k = 1; k < 4; k++) ctx.lineTo(quad[k][0], quad[k][1]);
        ctx.closePath();
      }
    }
    ctx.fill('nonzero');
  }
  ctx.restore();
}

/** The stroke under a point (topmost first), within `tol` of its outline, or null. */
export function hitStroke(strokes: readonly VStroke[], p: XY, tol: number): VStroke | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    const pts = sampleCurve(s.points, 4);
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)];
      if (segDist(p, a, pts[k]) <= tol + vWidth(s, pts[k].p) / 2) return s;
    }
  }
  return null;
}

/** The control point under a point, or -1. */
export function hitPoint(s: VStroke, p: XY, tol: number): number {
  let best = -1;
  let bestD = tol;
  s.points.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export function movePoint(s: VStroke, i: number, to: XY): VStroke {
  return { ...s, points: s.points.map((q, k) => (k === i ? { ...q, x: to.x, y: to.y } : q)) };
}

export function moveStroke(s: VStroke, dx: number, dy: number): VStroke {
  return { ...s, points: s.points.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })) };
}

/** A drawn stroke as a vector stroke: simplified to its control points. */
export function toVector(id: number, points: readonly Pt[], width: number, color: string): VStroke {
  const pts = simplify(points.map((p) => ({ x: p.x, y: p.y, p: p.p, tilt: 0 })));
  return { id, points: pts, width, color };
}
