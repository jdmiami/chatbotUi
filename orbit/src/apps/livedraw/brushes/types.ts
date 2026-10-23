/**
 * A brush, as plain data: everything the stamp engine needs to lay a stroke down, small enough to
 * save in the browser and pass around as a JSON file. Sizes are fractions of the canvas side, so a
 * brush draws the same on a phone and on an iPad. Textures are made in code (see engine/textures),
 * so a brush names its tip and grain instead of carrying pictures.
 */

/** The tip stamped along the stroke. `round` is drawn exactly (with `hardness`); the rest are textures. */
export type ShapeKind = 'round' | 'pencil' | 'charcoal' | 'chisel' | 'splatter' | 'bristle' | 'spray';
/** The paper-like texture the stroke is printed through. */
export type GrainKind = 'none' | 'paper' | 'canvas' | 'charcoal' | 'noise' | 'fibre';
/** What a stroke does to the layer. */
export type BrushMode = 'paint' | 'erase' | 'smudge';
/** How the tip turns: fixed, along the stroke, with the Pencil's lean, or at random. */
export type RotationMode = 'fixed' | 'stroke' | 'azimuth' | 'random';

/**
 * How much one property follows pressure, tilt and speed: each -1..1. Positive: more input, more of
 * it (a harder press, a bigger dab). Negative: the other way round. 0: not at all.
 */
export interface Dyn {
  pressure: number;
  tilt: number;
  speed: number;
}

export interface Brush {
  v: 1;
  id: string;
  name: string;
  /** Where it sits in the library (Inking, Sketching, Painting…). */
  group: string;
  mode: BrushMode;
  /** Diameter at 100 % (fraction of the canvas side). */
  size: number;
  /** The stroke's opacity ceiling: overlapping dabs in one stroke never go past it. */
  opacity: number;
  /** How much each dab lays down (dabs build up to `opacity`). */
  flow: number;
  /** Distance between dabs, as a fraction of the dab's diameter. */
  spacing: number;
  /** Edge of the round tip: 0 soft (airbrush) .. 1 crisp. */
  hardness: number;
  shape: ShapeKind;
  /** 1 round .. 0.1 a thin ellipse. */
  roundness: number;
  /** The tip's angle in degrees (added to the rotation mode). */
  angle: number;
  rotation: RotationMode;
  grain: GrainKind;
  /** Grain tile size: 1 is the default, bigger is coarser. */
  grainScale: number;
  /** How much grain shows: 0 none .. 1 full. */
  grainDepth: number;
  /** A second texture the tip is printed through (dual brush). */
  dual: { shape: ShapeKind | 'none'; scale: number; scatter: number; depth: number };
  /** Random variation per dab, each 0..1. */
  jitter: { size: number; opacity: number; angle: number; scatter: number };
  /** Dabs per step (spray). */
  count: number;
  /** Streamline: 0 raw .. 1 very smooth. */
  smoothing: number;
  /** Thin ends: how long the start and end taper are (0..1 of a tenth of the canvas). */
  taper: { start: number; end: number };
  /** Pressure response, a cubic-bezier from (0,0) to (1,1): [x1, y1, x2, y2]. */
  pressureCurve: [number, number, number, number];
  dynamics: { size: Dyn; opacity: Dyn; flow: Dyn; scatter: Dyn };
  /** Tilting the Pencil widens the tip up to (1 + this) times, like shading with a pencil's side. */
  tiltSpread: number;
  /** Tilting flattens the tip (0..1). */
  tiltFlatten: number;
  /** Smudge: how much paint is carried along (0..1). */
  smudge: number;
  /** Built in (can't be changed in place; duplicate it to make your own). */
  builtin?: boolean;
}

/** One stamp of the tip. Position and size in canvas units (fractions of the side). */
export interface Dab {
  x: number;
  y: number;
  /** Diameter. */
  size: number;
  /** 0..1, flow and opacity dynamics together. */
  alpha: number;
  /** Radians. */
  angle: number;
  roundness: number;
  /** Per-dab random 0..1 (offsets the dual texture). */
  r: number;
}

/** A 2D affine transform in canvas units: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
