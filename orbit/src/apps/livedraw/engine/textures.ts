/**
 * The brushes' tips and grains, made in code (no picture files, nothing borrowed): tileable value
 * noise for paper and charcoal grain, a woven canvas, fibres, and tips for pencil lead, a charcoal
 * stick, a chisel marker, splatter, bristles and spray. Each is an 8-bit alpha map: 255 lets the
 * paint through, 0 holds it back. The same seed always gives the same texture.
 */
import type { GrainKind, ShapeKind } from '../brushes/types';

export const TIP = 128;
export const GRAIN = 256;

function hash(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a: number, b: number, x: number) => (b === a ? (x < a ? 0 : 1) : smooth(clamp01((x - a) / (b - a))));

/** Value noise that tiles every `px` and `py` lattice cells, sampled over a `size` square. */
function valueNoise(size: number, px: number, py: number, seed: number): Float32Array {
  const r = hash(seed);
  const lat = new Float32Array(px * py).map(() => r());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * py;
    const y0 = Math.floor(fy);
    const ty = smooth(fy - y0);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * px;
      const x0 = Math.floor(fx);
      const tx = smooth(fx - x0);
      const at = (i: number, j: number) => lat[((j % py) * px + (i % px)) | 0];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  }
  return out;
}

/** Fractal noise (several octaves), 0..1, tileable. */
export function fbm(size: number, period: number, octaves: number, seed: number, stretch = 1): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const p = period * 2 ** o;
    const n = valueNoise(size, Math.max(1, Math.round(p / stretch)), p, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

const toBytes = (f: Float32Array) => {
  const b = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) b[i] = Math.round(clamp01(f[i]) * 255);
  return b;
};

/** A grain: what of each stroke shows through (1) or is held back (0). Tileable. */
export function grainAlpha(kind: GrainKind, size = GRAIN): Uint8Array {
  const n = size * size;
  const f = new Float32Array(n);
  switch (kind) {
    case 'none':
      f.fill(1);
      break;
    case 'paper': {
      const a = fbm(size, 24, 4, 11);
      for (let i = 0; i < n; i++) f[i] = clamp01((a[i] - 0.28) * 2.1) ** 0.9;
      break;
    }
    case 'canvas': {
      const a = fbm(size, 32, 3, 23);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const wx = 0.5 + 0.5 * Math.sin((2 * Math.PI * x) / 8);
          const wy = 0.5 + 0.5 * Math.sin((2 * Math.PI * y) / 8);
          // Over-under threads: alternate which runs on top.
          const over = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? wx : wy;
          f[y * size + x] = clamp01(0.35 + 0.55 * over + 0.3 * (a[y * size + x] - 0.5));
        }
      break;
    }
    case 'charcoal': {
      const streak = fbm(size, 16, 3, 37, 6);
      const tooth = fbm(size, 48, 2, 41);
      for (let i = 0; i < n; i++) f[i] = clamp01((streak[i] * 0.6 + tooth[i] * 0.4 - 0.32) * 2.4);
      break;
    }
    case 'noise': {
      const r = hash(53);
      for (let i = 0; i < n; i++) f[i] = r();
      break;
    }
    case 'fibre': {
      const base = fbm(size, 16, 2, 61);
      for (let i = 0; i < n; i++) f[i] = 0.75 + 0.25 * base[i];
      const r = hash(67);
      for (let k = 0; k < 140; k++) {
        const x0 = r() * size;
        const y0 = r() * size;
        const ang = r() * Math.PI;
        const len = 10 + r() * 40;
        for (let s = 0; s < len; s++) {
          const x = Math.floor(x0 + Math.cos(ang) * s + size) % size;
          const y = Math.floor(y0 + Math.sin(ang) * s + size) % size;
          f[y * size + x] *= 0.55;
        }
      }
      break;
    }
  }
  return toBytes(f);
}

/** The soft-or-hard round tip at a distance from the centre (0 centre .. 1 edge). */
export function roundAlpha(r: number, hardness: number): number {
  const inner = Math.min(0.985, Math.max(0, hardness) * 0.985);
  return 1 - smoothstep(inner, 1, r);
}

/** A tip, `size` square, centred, fitting the circle that touches the edges. */
export function tipAlpha(kind: ShapeKind, size = TIP, hardness = 0.9): Uint8Array {
  const f = new Float32Array(size * size);
  const c = (size - 1) / 2;
  const R = size / 2;
  const noise = kind === 'round' ? null : fbm(size, 8, 3, kind.length * 7 + 3);
  const r = hash(kind.length * 13 + 5);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x - c) / R;
      const v = (y - c) / R;
      const d = Math.hypot(u, v);
      const i = y * size + x;
      switch (kind) {
        case 'round':
          f[i] = roundAlpha(d, hardness);
          break;
        case 'spray':
          f[i] = Math.exp(-d * d * 6) * (d < 1 ? 1 : 0);
          break;
        case 'pencil':
          f[i] = roundAlpha(d, 0.75) * (0.45 + 0.55 * noise![i]);
          break;
        case 'charcoal': {
          const edge = 0.7 + 0.3 * noise![Math.floor(((Math.atan2(v, u) + Math.PI) / (2 * Math.PI)) * (size - 1))];
          f[i] = (1 - smoothstep(edge - 0.2, edge, d)) * clamp01(0.3 + 0.9 * noise![i]);
          break;
        }
        case 'chisel':
          f[i] = (1 - smoothstep(0.86, 0.98, Math.abs(u))) * (1 - smoothstep(0.86, 0.98, Math.abs(v)));
          break;
        case 'bristle':
          // Hairs run along x (the stroke turns the tip to its direction); each row its own strength.
          f[i] = 0;
          break;
        case 'splatter':
          f[i] = 0;
          break;
      }
    }
  if (kind === 'bristle') {
    const hairs = 22;
    const strength = Array.from({ length: hairs }, () => 0.35 + 0.65 * r());
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = (x - c) / R;
        const v = (y - c) / R;
        const h = ((v + 1) / 2) * hairs;
        const k = Math.min(hairs - 1, Math.floor(h));
        const across = Math.abs(h - k - 0.5) * 2; // 0 in the middle of a hair
        const body = (1 - smoothstep(0.75, 1, Math.hypot(u * 0.85, v)));
        f[y * size + x] = body * strength[k] * (1 - smoothstep(0.55, 1, across)) * (0.75 + 0.25 * noise![y * size + x]);
      }
  }
  if (kind === 'splatter') {
    for (let k = 0; k < 26; k++) {
      const a = r() * Math.PI * 2;
      const rr = Math.sqrt(r()) * 0.8;
      const dx = Math.cos(a) * rr;
      const dy = Math.sin(a) * rr;
      const rad = 0.05 + r() * 0.13;
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const u = (x - c) / R - dx;
          const v = (y - c) / R - dy;
          const d = Math.hypot(u, v) / rad;
          if (d < 1) f[y * size + x] = Math.max(f[y * size + x], 1 - smoothstep(0.7, 1, d));
        }
    }
  }
  return toBytes(f);
}

/** An alpha map as an RGBA buffer (white, alpha = the map): ready for a canvas or a texture. */
export function alphaToRgba(a: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(a.length * 4);
  for (let i = 0; i < a.length; i++) {
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 255;
    out[i * 4 + 3] = a[i];
  }
  return out;
}

/** Textures are made once per kind and kept. */
const tipCache = new Map<string, Uint8Array>();
const grainCache = new Map<GrainKind, Uint8Array>();
export function cachedTip(kind: ShapeKind, hardness = 0.9): Uint8Array {
  const key = kind === 'round' ? `round:${Math.round(hardness * 20)}` : kind;
  let t = tipCache.get(key);
  if (!t) tipCache.set(key, (t = tipAlpha(kind, TIP, Math.round(hardness * 20) / 20)));
  return t;
}
export function cachedGrain(kind: GrainKind): Uint8Array {
  let g = grainCache.get(kind);
  if (!g) grainCache.set(kind, (g = grainAlpha(kind)));
  return g;
}
