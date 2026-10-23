/**
 * Your own brushes: kept in this browser (localStorage, a few hundred bytes each), duplicated from any
 * brush, renamed, and taken away or brought in as a small JSON file. A file from elsewhere is read
 * carefully: every value is checked and clamped, unknown fields are dropped, so a bad file can only
 * fail to load, never break the canvas.
 */
import { BASE, PRESETS } from './presets';
import type { Brush, Dyn, GrainKind, RotationMode, ShapeKind } from './types';

const KEY = 'orbit:livedraw:brushes';
const RECENT_KEY = 'orbit:livedraw:recent-brushes';
export const FILE_KIND = 'orbit-live-draw-brush';

const SHAPES: ShapeKind[] = ['round', 'pencil', 'charcoal', 'chisel', 'splatter', 'bristle', 'spray'];
const GRAINS: GrainKind[] = ['none', 'paper', 'canvas', 'charcoal', 'noise', 'fibre'];
const ROTATIONS: RotationMode[] = ['fixed', 'stroke', 'azimuth', 'random'];

const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
const pick = <T extends string>(v: unknown, list: readonly T[], dflt: T): T => (list.includes(v as T) ? (v as T) : dflt);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const dyn = (v: unknown, d: Dyn): Dyn => {
  const o = obj(v);
  return { pressure: num(o.pressure, -1, 1, d.pressure), tilt: num(o.tilt, -1, 1, d.tilt), speed: num(o.speed, -1, 1, d.speed) };
};

export function newBrushId(): string {
  return `b-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Any JSON value as a valid brush (clamped, defaults filled in), or null when it isn't one at all. */
export function normalizeBrush(input: unknown): Brush | null {
  const o = obj(input);
  if (typeof o.name !== 'string' || !o.name.trim()) return null;
  const d = obj(o.dynamics);
  const dual = obj(o.dual);
  const jit = obj(o.jitter);
  const tap = obj(o.taper);
  const curve = Array.isArray(o.pressureCurve) && o.pressureCurve.length === 4 ? (o.pressureCurve as unknown[]) : null;
  return {
    v: 1,
    id: typeof o.id === 'string' && /^[\w-]{1,64}$/.test(o.id) ? o.id : newBrushId(),
    name: o.name.trim().slice(0, 40),
    group: typeof o.group === 'string' && o.group.trim() ? o.group.trim().slice(0, 24) : 'Mine',
    mode: pick(o.mode, ['paint', 'erase', 'smudge'] as const, 'paint'),
    size: num(o.size, 0.0005, 0.5, BASE.size),
    opacity: num(o.opacity, 0, 1, BASE.opacity),
    flow: num(o.flow, 0.005, 1, BASE.flow),
    spacing: num(o.spacing, 0.01, 3, BASE.spacing),
    hardness: num(o.hardness, 0, 1, BASE.hardness),
    shape: pick(o.shape, SHAPES, 'round'),
    roundness: num(o.roundness, 0.05, 1, 1),
    angle: num(o.angle, -360, 360, 0),
    rotation: pick(o.rotation, ROTATIONS, 'fixed'),
    grain: pick(o.grain, GRAINS, 'none'),
    grainScale: num(o.grainScale, 0.2, 5, 1),
    grainDepth: num(o.grainDepth, 0, 1, 0),
    dual: { shape: pick(dual.shape, ['none', ...SHAPES] as const, 'none'), scale: num(dual.scale, 0.2, 5, 1), scatter: num(dual.scatter, 0, 1, 0), depth: num(dual.depth, 0, 1, 0) },
    jitter: { size: num(jit.size, 0, 1, 0), opacity: num(jit.opacity, 0, 1, 0), angle: num(jit.angle, 0, 1, 0), scatter: num(jit.scatter, 0, 4, 0) },
    count: Math.round(num(o.count, 1, 32, 1)),
    smoothing: num(o.smoothing, 0, 1, BASE.smoothing),
    taper: { start: num(tap.start, 0, 1, 0), end: num(tap.end, 0, 1, 0) },
    pressureCurve: curve ? [num(curve[0], 0, 1, 0.33), num(curve[1], 0, 1, 0.33), num(curve[2], 0, 1, 0.67), num(curve[3], 0, 1, 0.67)] : [...BASE.pressureCurve],
    dynamics: {
      size: dyn(d.size, BASE.dynamics.size),
      opacity: dyn(d.opacity, BASE.dynamics.opacity),
      flow: dyn(d.flow, BASE.dynamics.flow),
      scatter: dyn(d.scatter, BASE.dynamics.scatter),
    },
    tiltSpread: num(o.tiltSpread, 0, 6, 0),
    tiltFlatten: num(o.tiltFlatten, 0, 1, 0),
    smudge: num(o.smudge, 0, 1, BASE.smudge),
  };
}

/** A brush as the small JSON file you take away. */
export function brushToJson(b: Brush): string {
  const { builtin: _builtin, ...rest } = b;
  return JSON.stringify({ kind: FILE_KIND, brush: rest }, null, 2);
}

/** A brush file's text back as a brush (a fresh id, so it never replaces one you have), or an error in words. */
export function brushFromJson(text: string): { brush: Brush } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'That file isn’t a brush (it isn’t JSON).' };
  }
  const o = obj(data);
  const inner = o.kind === FILE_KIND ? o.brush : data;
  const b = normalizeBrush(inner);
  if (!b) return { error: 'That file isn’t a brush this app can read.' };
  return { brush: { ...b, id: newBrushId(), group: 'Mine' } };
}

/** A copy you can change: a new id, "… copy", in your own group. */
export function duplicateBrush(b: Brush, name?: string): Brush {
  const copy: Brush = JSON.parse(JSON.stringify(b));
  delete copy.builtin;
  return { ...copy, id: newBrushId(), name: (name ?? `${b.name} copy`).slice(0, 40), group: 'Mine' };
}

export function loadMine(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Brush[] {
  try {
    const list = JSON.parse(storage?.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.map(normalizeBrush).filter((b): b is Brush => Boolean(b)) : [];
  } catch {
    return [];
  }
}

export function saveMine(list: Brush[], storage: Pick<Storage, 'setItem'> | null = safeStorage()): boolean {
  try {
    storage?.setItem(KEY, JSON.stringify(list.map((b) => ({ ...b, builtin: undefined }))));
    return true;
  } catch {
    return false;
  }
}

/** Your brush replaces the one with its id, or joins the end. */
export function upsert(list: Brush[], b: Brush): Brush[] {
  const i = list.findIndex((x) => x.id === b.id);
  if (i < 0) return [...list, b];
  const next = list.slice();
  next[i] = b;
  return next;
}

export function allBrushes(mine: Brush[]): Brush[] {
  return [...PRESETS, ...mine];
}

/** The last few brushes used, newest first (the quick menu). */
export function pushRecent(list: string[], id: string, max = 5): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}
export function loadRecent(): string[] {
  try {
    const v = JSON.parse(safeStorage()?.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}
export function saveRecent(list: string[]) {
  try {
    safeStorage()?.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* private mode */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
