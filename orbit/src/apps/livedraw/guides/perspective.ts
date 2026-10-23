/**
 * Perspective guides: one, two or three vanishing points you drag into place, a grid of lines running
 * to them, and (when "snap" is on) strokes that run straight toward one of them: once a stroke has
 * started moving, it locks onto the guide closest to the way it set off (toward a vanishing point,
 * or straight up and down / across where the grid has those), and every later point slides onto that
 * line.
 */
export interface XY {
  x: number;
  y: number;
}

export type PerspKind = 'off' | 'one' | 'two' | 'three';

export interface Perspective {
  kind: PerspKind;
  /** Up to three vanishing points (canvas units; may lie off the canvas). */
  vps: XY[];
  snap: boolean;
}

export const DEFAULT_VPS: XY[] = [
  { x: 0.08, y: 0.42 },
  { x: 0.92, y: 0.42 },
  { x: 0.5, y: 0.96 },
];
export const NO_PERSPECTIVE: Perspective = { kind: 'off', vps: DEFAULT_VPS.map((p) => ({ ...p })), snap: true };

/** The vanishing points in use for a kind (one-point uses a single centred point). */
export function activeVps(p: Perspective): XY[] {
  switch (p.kind) {
    case 'off':
      return [];
    case 'one':
      return [p.vps[0]];
    case 'two':
      return p.vps.slice(0, 2);
    case 'three':
      return p.vps.slice(0, 3);
  }
}

/** Where a fresh one-point grid puts its point (the middle, a little above centre). */
export function vpsFor(kind: PerspKind, current: XY[]): XY[] {
  if (kind === 'one') return [{ x: 0.5, y: 0.42 }, current[1] ?? DEFAULT_VPS[1], current[2] ?? DEFAULT_VPS[2]];
  if (kind === 'two' || kind === 'three') return [current[0]?.x === 0.5 ? DEFAULT_VPS[0] : current[0] ?? DEFAULT_VPS[0], current[1] ?? DEFAULT_VPS[1], current[2] ?? DEFAULT_VPS[2]];
  return current;
}

const unit = (x: number, y: number): XY | null => {
  const l = Math.hypot(x, y);
  return l > 1e-9 ? { x: x / l, y: y / l } : null;
};

/** The directions a stroke starting at `start` may snap to. */
export function snapDirections(p: Perspective, start: XY): XY[] {
  const out: XY[] = [];
  for (const vp of activeVps(p)) {
    const u = unit(vp.x - start.x, vp.y - start.y);
    if (u) out.push(u);
  }
  if (p.kind === 'one') out.push({ x: 1, y: 0 }, { x: 0, y: 1 });
  if (p.kind === 'two') out.push({ x: 0, y: 1 });
  return out;
}

/** Of the candidates, the one closest to the way the stroke is going (either sense), or null. */
export function pickDirection(candidates: XY[], move: XY): XY | null {
  const m = unit(move.x, move.y);
  if (!m) return null;
  let best: XY | null = null;
  let bestDot = -1;
  for (const c of candidates) {
    const d = Math.abs(c.x * m.x + c.y * m.y);
    if (d > bestDot) {
      bestDot = d;
      best = c;
    }
  }
  return best;
}

/** A point slid onto the line through `start` along `dir`. */
export function projectOnto(start: XY, dir: XY, p: XY): XY {
  const t = (p.x - start.x) * dir.x + (p.y - start.y) * dir.y;
  return { x: start.x + dir.x * t, y: start.y + dir.y * t };
}

/** How far a stroke moves before it picks its guide (canvas units). */
export const SNAP_DECIDE = 0.015;

/** One stroke's snapping: decides once, then slides every point onto that guide. */
export class PerspectiveSnap {
  private dir: XY | null = null;
  constructor(
    readonly guides: Perspective,
    readonly start: XY,
  ) {}
  get decided() {
    return this.dir !== null;
  }
  /** A point in, the snapped point out (unchanged until the stroke has moved far enough to decide). */
  apply<T extends XY>(p: T): T {
    if (!this.dir) {
      if (Math.hypot(p.x - this.start.x, p.y - this.start.y) < SNAP_DECIDE) return { ...p, x: this.start.x, y: this.start.y };
      this.dir = pickDirection(snapDirections(this.guides, this.start), { x: p.x - this.start.x, y: p.y - this.start.y });
      if (!this.dir) return p;
    }
    const q = projectOnto(this.start, this.dir, p);
    return { ...p, x: q.x, y: q.y };
  }
}

/** Grid lines to show (canvas units): rays out of each vanishing point, plus the horizon. */
export function gridLines(p: Perspective, rays = 18): { x1: number; y1: number; x2: number; y2: number; horizon?: boolean }[] {
  const vps = activeVps(p);
  const out: { x1: number; y1: number; x2: number; y2: number; horizon?: boolean }[] = [];
  const L = 4;
  for (const vp of vps) {
    // The rays spread over the angles the canvas covers as seen from the point (all round if inside).
    const corners = [
      { x: -0.05, y: -0.05 },
      { x: 1.05, y: -0.05 },
      { x: 1.05, y: 1.05 },
      { x: -0.05, y: 1.05 },
    ];
    const inside = vp.x > -0.05 && vp.x < 1.05 && vp.y > -0.05 && vp.y < 1.05;
    let a0 = 0;
    let span = Math.PI * 2;
    if (!inside) {
      const angles = corners.map((c) => Math.atan2(c.y - vp.y, c.x - vp.x));
      const mid = Math.atan2(0.5 - vp.y, 0.5 - vp.x);
      const rel = angles.map((a) => Math.atan2(Math.sin(a - mid), Math.cos(a - mid)));
      a0 = mid + Math.min(...rel);
      span = Math.max(...rel) - Math.min(...rel);
    }
    const n = inside ? rays * 2 : rays;
    for (let k = 0; k <= n - (inside ? 1 : 0); k++) {
      const a = a0 + (span * k) / n;
      out.push({ x1: vp.x, y1: vp.y, x2: vp.x + Math.cos(a) * L, y2: vp.y + Math.sin(a) * L });
    }
  }
  if (p.kind === 'one' || p.kind === 'two' || p.kind === 'three') {
    const a = vps[0];
    const b = p.kind === 'one' ? { x: a.x + 1, y: a.y } : vps[1];
    const u = unit(b.x - a.x, b.y - a.y) ?? { x: 1, y: 0 };
    out.push({ x1: a.x - u.x * L, y1: a.y - u.y * L, x2: a.x + u.x * L, y2: a.y + u.y * L, horizon: true });
  }
  if (p.kind === 'one') {
    // A one-point grid also has its level and upright lines.
    for (let k = 1; k < 8; k++) {
      out.push({ x1: -1, y1: k / 8, x2: 2, y2: k / 8 });
      out.push({ x1: k / 8, y1: -1, x2: k / 8, y2: 2 });
    }
  }
  if (p.kind === 'two') for (let k = 1; k < 8; k++) out.push({ x1: k / 8, y1: -1, x2: k / 8, y2: 2 });
  return out;
}
