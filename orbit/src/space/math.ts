/** Small, dependency-free 3D math and easing for Orbit Space (ported from docs/orbit-space/samples.html). */

export interface Vec {
  x: number;
  y: number;
  z: number;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
/** Progress of `t` through a segment that starts at `s` and lasts `d` (0…1). */
export const seg = (t: number, s: number, d: number) => (d <= 0 ? (t >= s ? 1 : 0) : clamp((t - s) / d, 0, 1));
/** Close to cubic-bezier(.22,1,.36,1), the agreed "settle" curve. */
export const settle = (p: number) => 1 - Math.pow(1 - p, 5);
export const inout = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
/** About 8% overshoot: close to the agreed spring (stiffness 180, damping 22) over its duration. */
export const spring = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : 1 - Math.exp(-6.5 * p) * Math.cos(8 * p));
/** 0 → 1 → 0 over a segment: arcs and swings. */
export const bump = (p: number) => Math.sin(Math.PI * clamp(p, 0, 1));

export const V = (x: number, y: number, z: number): Vec => ({ x, y, z });
export const vlerp = (a: Vec, b: Vec, p: number) => V(lerp(a.x, b.x, p), lerp(a.y, b.y, p), lerp(a.z, b.z, p));
export const vadd = (a: Vec, b: Vec) => V(a.x + b.x, a.y + b.y, a.z + b.z);
export const vdist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const rotY = (v: Vec, a: number) => V(v.x * Math.cos(a) + v.z * Math.sin(a), v.y, -v.x * Math.sin(a) + v.z * Math.cos(a));

/** Seeded random numbers (mulberry32): the same seed gives the same dust every time. */
export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
