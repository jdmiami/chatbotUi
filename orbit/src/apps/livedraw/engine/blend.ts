/**
 * Blend modes, the W3C Compositing way (the same maths as Photoshop and the browsers' canvas): a
 * reference version in plain numbers (what the tests check and the GPU shader copies), the canvas
 * names for the 2D fallback, and the names ag-psd writes into a PSD.
 */
import type { BlendMode } from '../layers/model';

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function sep(mode: BlendMode, b: number, s: number): number {
  switch (mode) {
    case 'multiply':
      return b * s;
    case 'screen':
      return b + s - b * s;
    case 'overlay':
      return sep('hard-light', s, b);
    case 'darken':
      return Math.min(b, s);
    case 'lighten':
      return Math.max(b, s);
    case 'color-dodge':
      return b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s));
    case 'color-burn':
      return b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s);
    case 'hard-light':
      return s <= 0.5 ? b * 2 * s : sep('screen', b, 2 * s - 1);
    case 'soft-light': {
      if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
      const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
      return b + (2 * s - 1) * (d - b);
    }
    case 'difference':
      return Math.abs(b - s);
    case 'exclusion':
      return b + s - 2 * b * s;
    case 'add':
      return Math.min(1, b + s);
    default:
      return s;
  }
}

const lum = (c: RGB) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c: RGB): RGB {
  const l = lum(c);
  const n = Math.min(...c);
  const x = Math.max(...c);
  let out = c.slice() as RGB;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n || 1e-9)) as RGB;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l || 1e-9)) as RGB;
  return out;
}
const setLum = (c: RGB, l: number) => {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
};
const sat = (c: RGB) => Math.max(...c) - Math.min(...c);
function setSat(c: RGB, s: number): RGB {
  const mx = Math.max(...c);
  const mn = Math.min(...c);
  if (mx === mn) return [0, 0, 0];
  return c.map((v) => ((v - mn) * s) / (mx - mn)) as RGB;
}

/** B(Cb, Cs): the blended colour where both are fully there (unpremultiplied 0..1). */
export function blendRgb(mode: BlendMode, b: RGB, s: RGB): RGB {
  switch (mode) {
    case 'hue':
      return setLum(setSat(s, sat(b)), lum(b));
    case 'saturation':
      return setLum(setSat(b, sat(s)), lum(b));
    case 'color':
      return setLum(s, lum(b));
    case 'luminosity':
      return setLum(b, lum(s));
    default:
      return [sep(mode, b[0], s[0]), sep(mode, b[1], s[1]), sep(mode, b[2], s[2])];
  }
}

/**
 * One layer over what is under it, both premultiplied RGBA 0..1: the source's colour is first mixed
 * with the blend result where the backdrop is there, then laid over it (source-over).
 */
export function composite(mode: BlendMode, backdrop: RGBA, source: RGBA): RGBA {
  const ab = backdrop[3];
  const as = source[3];
  if (as <= 0) return backdrop.slice() as RGBA;
  const cb: RGB = ab > 0 ? [backdrop[0] / ab, backdrop[1] / ab, backdrop[2] / ab] : [0, 0, 0];
  const cs: RGB = [source[0] / as, source[1] / as, source[2] / as];
  const mixed = blendRgb(mode, cb, cs);
  const ao = as + ab * (1 - as);
  const out: RGBA = [0, 0, 0, ao];
  for (let k = 0; k < 3; k++) {
    const c = (1 - ab) * cs[k] + ab * clamp01(mixed[k]);
    out[k] = as * c + (1 - as) * ab * cb[k];
  }
  return out;
}

/** Layers (bottom first, each with its own mode and opacity) over transparent: the stack's colour. */
export function flattenStack(layers: { color: RGBA; mode: BlendMode; opacity: number }[]): RGBA {
  let acc: RGBA = [0, 0, 0, 0];
  for (const l of layers) {
    const src = l.color.map((v) => v * l.opacity) as RGBA;
    acc = composite(l.mode, acc, src);
  }
  return acc;
}

/** The 2D canvas's name for each mode. */
export const CANVAS_OP: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  'soft-light': 'soft-light',
  'hard-light': 'hard-light',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  add: 'lighter',
};

/** The PSD's name for each mode (ag-psd). */
export const PSD_BLEND: Record<BlendMode, string> = {
  normal: 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  'soft-light': 'soft light',
  'hard-light': 'hard light',
  'color-dodge': 'color dodge',
  'color-burn': 'color burn',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  add: 'linear dodge',
};

/** The GPU shader's number for each mode. */
export const GL_BLEND: Record<BlendMode, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  'soft-light': 4,
  'hard-light': 5,
  'color-dodge': 6,
  'color-burn': 7,
  darken: 8,
  lighten: 9,
  difference: 10,
  exclusion: 11,
  hue: 12,
  saturation: 13,
  color: 14,
  luminosity: 15,
  add: 16,
};
