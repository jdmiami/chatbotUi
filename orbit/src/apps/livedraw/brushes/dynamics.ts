/**
 * Brush dynamics, as plain maths: the pressure curve, how pressure / tilt / speed scale a property,
 * and a small seeded random source so a stroke draws exactly the same when it is drawn again (undo,
 * a new screen size, the export).
 */
import type { Dyn } from './types';

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * A cubic-bezier from (0,0) to (1,1) with control points (x1,y1), (x2,y2), the way CSS easing curves
 * work: returns y for a given x (0..1). Linear when the controls lie on the diagonal.
 */
export function bezierY(curve: readonly [number, number, number, number], x: number): number {
  const [x1, y1, x2, y2] = curve;
  x = clamp01(x);
  if (x1 === y1 && x2 === y2) return x;
  const bx = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const by = (t: number) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  // Bisection on t (x(t) is monotonic for controls inside 0..1): plenty fast for a few thousand dabs.
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 24; i++) {
    const v = bx(t);
    if (Math.abs(v - x) < 1e-5) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return clamp01(by(t));
}

/**
 * One input's effect on a property, as a multiplier 0..1. Amount a > 0: at no input the property is
 * (1 - a), at full input 1. a < 0: at no input 1, at full input (1 - |a|). a = 0: always 1.
 */
export function term(a: number, input: number): number {
  const v = clamp01(input);
  if (!a) return 1;
  const k = Math.min(1, Math.abs(a));
  return a > 0 ? 1 - k + k * v : 1 - k * v;
}

/** Pressure (after the curve), tilt and speed together scale a property: the product of the three. */
export function dynamic(d: Dyn, p: number, tilt: number, speed: number): number {
  return term(d.pressure, p) * term(d.tilt, tilt) * term(d.speed, speed);
}

/** How fast the pen moves, as 0 (still) .. 1 (fast): canvas sides per second over `fast`. */
export function speedOf(dist: number, ms: number, fast = 3): number {
  if (!(ms > 0)) return 0;
  return clamp01(dist / (ms / 1000) / fast);
}

/** A seeded random source (mulberry32): the same seed gives the same numbers, 0..1. */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Taper at the ends: 0 at the very start/end, 1 once `len` along. Smooth (smoothstep). */
export function taperAt(along: number, total: number | null, start: number, end: number): number {
  const s = (v: number, len: number) => {
    if (len <= 0) return 1;
    const t = clamp01(v / len);
    return 0.15 + 0.85 * t * t * (3 - 2 * t);
  };
  let k = s(along, start);
  if (total !== null) k = Math.min(k, s(total - along, end));
  return k;
}
