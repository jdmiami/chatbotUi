/**
 * Symmetry: every stroke drawn again, mirrored or turned about a centre you can move. Vertical (left
 * and right mirror), horizontal (top and bottom), quadrant (both), and radial: N turns, like a
 * mandala, each also mirrored unless "rotational" is on. With rotational, the mirror kinds turn
 * instead of mirroring (a stroke on the left reappears upside down on the right).
 */
import { IDENTITY, type Dab, type Mat } from '../brushes/types';

export type SymKind = 'off' | 'vertical' | 'horizontal' | 'quadrant' | 'radial';

export interface Symmetry {
  kind: SymKind;
  /** Radial: how many parts (2..24). */
  n: number;
  rotational: boolean;
  cx: number;
  cy: number;
}

export const NO_SYMMETRY: Symmetry = { kind: 'off', n: 6, rotational: false, cx: 0.5, cy: 0.5 };

/** A linear map about (cx, cy) as an affine transform. */
function about(a: number, b: number, c: number, d: number, cx: number, cy: number): Mat {
  return { a, b, c, d, e: cx - (a * cx + c * cy), f: cy - (b * cx + d * cy) };
}
const rot = (t: number, cx: number, cy: number) => about(Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), cx, cy);
/** Mirror across the line through the centre at angle φ. */
const mirror = (phi: number, cx: number, cy: number) => about(Math.cos(2 * phi), Math.sin(2 * phi), Math.sin(2 * phi), -Math.cos(2 * phi), cx, cy);

/** Every copy of a stroke, the stroke itself (identity) first. */
export function symmetryMats(s: Symmetry): Mat[] {
  const { cx, cy } = s;
  switch (s.kind) {
    case 'off':
      return [IDENTITY];
    case 'vertical':
      return [IDENTITY, s.rotational ? rot(Math.PI, cx, cy) : mirror(Math.PI / 2, cx, cy)];
    case 'horizontal':
      return [IDENTITY, s.rotational ? rot(Math.PI, cx, cy) : mirror(0, cx, cy)];
    case 'quadrant':
      return s.rotational
        ? [IDENTITY, rot(Math.PI / 2, cx, cy), rot(Math.PI, cx, cy), rot((3 * Math.PI) / 2, cx, cy)]
        : [IDENTITY, mirror(Math.PI / 2, cx, cy), mirror(0, cx, cy), rot(Math.PI, cx, cy)];
    case 'radial': {
      const n = Math.max(2, Math.min(24, Math.round(s.n)));
      const out: Mat[] = [IDENTITY];
      for (let k = 1; k < n; k++) out.push(rot((2 * Math.PI * k) / n, cx, cy));
      if (!s.rotational) for (let k = 0; k < n; k++) out.push(mirror((Math.PI * k) / n, cx, cy));
      return out;
    }
  }
}

export function applyMat(m: Mat, p: { x: number; y: number }): { x: number; y: number } {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

export const isIdentity = (m: Mat) => m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;

/** Dabs copied through each transform (the tip turned with them). */
export function mirrorDabs(dabs: readonly Dab[], mats: readonly Mat[] | undefined): Dab[] {
  if (!mats || mats.length <= 1) return dabs as Dab[];
  const out: Dab[] = [];
  for (const m of mats) {
    if (isIdentity(m)) {
      out.push(...dabs);
      continue;
    }
    for (const d of dabs) {
      const p = applyMat(m, d);
      // The tip's axis through the map's linear part.
      const ax = m.a * Math.cos(d.angle) + m.c * Math.sin(d.angle);
      const ay = m.b * Math.cos(d.angle) + m.d * Math.sin(d.angle);
      out.push({ ...d, x: p.x, y: p.y, angle: Math.atan2(ay, ax) });
    }
  }
  return out;
}

/** The lines to show on the canvas (canvas units): the mirror axes or the radial spokes. */
export function symmetryAxes(s: Symmetry): { x1: number; y1: number; x2: number; y2: number }[] {
  const L = 3;
  const line = (phi: number) => ({ x1: s.cx - Math.cos(phi) * L, y1: s.cy - Math.sin(phi) * L, x2: s.cx + Math.cos(phi) * L, y2: s.cy + Math.sin(phi) * L });
  const spoke = (phi: number) => ({ x1: s.cx, y1: s.cy, x2: s.cx + Math.cos(phi) * L, y2: s.cy + Math.sin(phi) * L });
  switch (s.kind) {
    case 'off':
      return [];
    case 'vertical':
      return [line(Math.PI / 2)];
    case 'horizontal':
      return [line(0)];
    case 'quadrant':
      return [line(0), line(Math.PI / 2)];
    case 'radial': {
      const n = Math.max(2, Math.min(24, Math.round(s.n)));
      return Array.from({ length: n }, (_, k) => spoke(-Math.PI / 2 + (2 * Math.PI * k) / n));
    }
  }
}
