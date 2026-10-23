/**
 * The stamp engine's walk: turns the points of a stroke into dabs (stamps of the tip) every so often
 * along it, each sized, faded, turned and scattered by the brush's dynamics. It walks incrementally
 * (new points as the Pencil sends them) and the same walk again gives the same dabs (seeded), so a
 * stroke can be drawn again after undo or at another size.
 */
import type { Pt } from '../canvas/sketch';
import { bezierY, clamp01, dynamic, speedOf, taperAt } from './dynamics';
import type { Brush, Dab } from './types';

/** No dab closer than this to the last (canvas units, about a pixel at 2048). */
export const MIN_STEP = 0.0004;
/** Taper lengths are fractions of this (canvas units). */
export const TAPER_LEN = 0.1;

class Rand {
  constructor(private a: number) {
    this.a = a >>> 0 || 0x9e3779b9;
  }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  clone() {
    const r = new Rand(1);
    r.a = this.a;
    return r;
  }
}

export function strokeLength(points: readonly Pt[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return n;
}

export class DabWalker {
  private rand: Rand;
  private along = 0;
  private nextAt = 0;
  private last: Pt | null = null;
  private speed = 0;
  private dir = 0;
  /** How many points it has walked. */
  fed = 0;

  /**
   * @param size the diameter at full dynamics (the brush's size times the Size slider), canvas units
   * @param total the stroke's whole length when known (for the end taper), else null
   */
  constructor(
    readonly brush: Brush,
    readonly size: number,
    seed: number,
    readonly total: number | null = null,
  ) {
    this.rand = new Rand(seed);
  }

  /** A copy that can walk ahead (predicted points) without moving this one. */
  clone(): DabWalker {
    const w = new DabWalker(this.brush, this.size, 1, this.total);
    w.rand = this.rand.clone();
    w.along = this.along;
    w.nextAt = this.nextAt;
    w.last = this.last;
    w.speed = this.speed;
    w.dir = this.dir;
    w.fed = this.fed;
    return w;
  }

  /** Walk the points from `fed` on (all of them the first time); returns the new dabs. */
  feed(points: readonly Pt[]): Dab[] {
    const out: Dab[] = [];
    for (let i = this.fed; i < points.length; i++) {
      const b = points[i];
      const a = this.last;
      if (!a) {
        this.last = b;
        this.place(b, b, 0, out);
        this.nextAt = this.step(b);
        continue;
      }
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > 1e-7) {
        this.dir = Math.atan2(b.y - a.y, b.x - a.x);
        if (typeof a.t === 'number' && typeof b.t === 'number') this.speed = this.speed * 0.7 + speedOf(len, b.t - a.t) * 0.3;
        while (this.nextAt <= this.along + len) {
          const u = (this.nextAt - this.along) / len;
          const q = this.place(a, b, u, out);
          this.nextAt += this.step(q);
        }
        this.along += len;
      }
      this.last = b;
    }
    this.fed = points.length;
    return out;
  }

  /** Spacing at a point: a fraction of the dab's own diameter there. */
  private step(q: { p: number; tilt: number }): number {
    const d = this.size * this.sizeK(q.p, q.tilt, this.along);
    return Math.max(MIN_STEP, this.brush.spacing * d);
  }

  private sizeK(p: number, tilt: number, along: number): number {
    const b = this.brush;
    const pc = bezierY(b.pressureCurve, p);
    const t = clamp01(tilt);
    return dynamic(b.dynamics.size, pc, t, this.speed) * (1 + b.tiltSpread * t ** 1.5) * taperAt(along, this.total, b.taper.start * TAPER_LEN, b.taper.end * TAPER_LEN);
  }

  private place(a: Pt, b: Pt, u: number, out: Dab[]): Pt {
    const br = this.brush;
    const q: Pt = {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      p: a.p + (b.p - a.p) * u,
      tilt: a.tilt + (b.tilt - a.tilt) * u,
      az: b.az ?? a.az,
    };
    const along = this.along + Math.hypot(b.x - a.x, b.y - a.y) * u;
    const pc = bezierY(br.pressureCurve, q.p);
    const tilt = clamp01(q.tilt);
    const baseK = this.sizeK(q.p, tilt, along);
    const alphaK = br.flow * dynamic(br.dynamics.flow, pc, tilt, this.speed) * dynamic(br.dynamics.opacity, pc, tilt, this.speed);
    const scatterK = br.jitter.scatter * dynamic(br.dynamics.scatter, pc, tilt, this.speed);
    const count = Math.max(1, Math.min(32, Math.round(br.count)));
    for (let k = 0; k < count; k++) {
      const r1 = this.rand.next();
      const r2 = this.rand.next();
      const r3 = this.rand.next();
      const r4 = this.rand.next();
      const r5 = this.rand.next();
      const size = Math.max(0.0005, this.size * baseK * (1 - br.jitter.size * r1));
      let angle = (br.angle * Math.PI) / 180;
      if (br.rotation === 'stroke') angle += this.dir;
      else if (br.rotation === 'azimuth') angle += q.az ?? this.dir;
      else if (br.rotation === 'random') angle += r3 * Math.PI * 2;
      angle += (r3 - 0.5) * Math.PI * 2 * br.jitter.angle;
      // Scatter: anywhere in a disc up to twice the diameter, more often near the middle.
      const sr = scatterK * size * 2 * Math.sqrt(r4);
      const sa = r5 * Math.PI * 2;
      out.push({
        x: q.x + Math.cos(sa) * sr,
        y: q.y + Math.sin(sa) * sr,
        size,
        alpha: clamp01(alphaK * (1 - br.jitter.opacity * r2)),
        angle,
        roundness: Math.max(0.05, br.roundness * (1 - br.tiltFlatten * tilt)),
        r: r2,
      });
    }
    return q;
  }
}

/** Every dab of a finished stroke (its whole length known, so both ends taper). */
export function dabsFor(brush: Brush, size: number, seed: number, points: readonly Pt[]): Dab[] {
  return new DabWalker(brush, size, seed, strokeLength(points)).feed(points);
}

/** The box around some dabs (canvas units), padded by each dab's radius: what to redraw. */
export function dabBounds(dabs: readonly Dab[]): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!dabs.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const d of dabs) {
    const r = d.size * 0.75;
    if (d.x - r < x0) x0 = d.x - r;
    if (d.y - r < y0) y0 = d.y - r;
    if (d.x + r > x1) x1 = d.x + r;
    if (d.y + r > y1) y1 = d.y + r;
  }
  return { x0, y0, x1, y1 };
}
