/**
 * Flipbook's drawing, as plain data: a scene is a pad of square paper notes (frames), each holding
 * the ink drawn on it. Ink is Live Draw's vector ink (ink/vector.ts): points in paper units (0..1),
 * so a note draws the same at any size, from the stack in the corner to the big note in the middle.
 *
 * Every change makes a new scene (nothing is changed in place), so undo is a list of old scenes.
 */
import type { VStroke } from '../livedraw/ink/vector';
import type { Pose } from './rig';
import type { PaperKind } from './paperGL';

export interface Frame {
  id: string;
  /** Ink drawn on this note (on top of any character). */
  strokes: VStroke[];
  /** Each character's pose on this note, by cast id. A note without one holds the pose of the note before. */
  poses?: Record<string, Pose>;
}

/** A character on this flipbook (the character itself is kept in the character library). */
export interface CastMember {
  id: string;
  characterId: string;
}

export interface Scene {
  id: string;
  name: string;
  /** Frames per second when it plays. */
  fps: number;
  frames: Frame[];
  /** The characters on it, in drawing order. */
  cast?: CastMember[];
  /** Which paper its notes are (sticky notes when not set). */
  paper?: PaperKind;
  updatedAt: number;
}

export const FPS_CHOICES = [8, 12, 24] as const;

let seq = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const blankFrame = (): Frame => ({ id: newId('f'), strokes: [] });

export function newScene(name = 'My flipbook'): Scene {
  return { id: newId('scene'), name, fps: 12, frames: [blankFrame()], updatedAt: Date.now() };
}

const touch = (s: Scene, frames: Frame[]): Scene => ({ ...s, frames, updatedAt: Date.now() });

/**
 * The pad never runs out: one blank note always waits after the last frame. Drawing on it (index
 * === frames.length) makes it a real frame.
 */
export const padLength = (s: Scene) => s.frames.length + 1;

/** Frame `i`, making it (and any blank ones before it) if the pen lands on the waiting blank note. */
function ensure(s: Scene, i: number): Scene {
  if (i < s.frames.length) return s;
  const frames = s.frames.slice();
  while (frames.length <= i) frames.push(blankFrame());
  return touch(s, frames);
}

export function addStroke(s: Scene, i: number, stroke: VStroke): Scene {
  const e = ensure(s, i);
  return touch(
    e,
    e.frames.map((f, k) => (k === i ? { ...f, strokes: [...f.strokes, stroke] } : f)),
  );
}

export function removeStrokes(s: Scene, i: number, ids: ReadonlySet<number>): Scene {
  if (i >= s.frames.length || !ids.size) return s;
  return touch(
    s,
    s.frames.map((f, k) => (k === i ? { ...f, strokes: f.strokes.filter((st) => !ids.has(st.id)) } : f)),
  );
}

export function clearFrame(s: Scene, i: number): Scene {
  if (i >= s.frames.length) return s;
  return touch(
    s,
    s.frames.map((f, k) => (k === i ? { ...f, strokes: [] } : f)),
  );
}

/** A blank note slipped in before frame `i` (the new note becomes frame `i`). */
export function insertBlank(s: Scene, i: number): Scene {
  const frames = s.frames.slice();
  frames.splice(Math.min(i, frames.length), 0, blankFrame());
  return touch(s, frames);
}

/** A copy of frame `i` placed right after it, to trace the next pose from. */
export function duplicate(s: Scene, i: number): Scene {
  if (i >= s.frames.length) return s;
  const frames = s.frames.slice();
  const src = frames[i];
  frames.splice(i + 1, 0, { id: newId('f'), strokes: src.strokes.map((st) => ({ ...st, points: st.points.slice() })), ...(src.poses ? { poses: { ...src.poses } } : {}) });
  return touch(s, frames);
}

/** Tear off note `i`. The pad always keeps at least one frame. */
export function removeFrame(s: Scene, i: number): Scene {
  if (i >= s.frames.length) return s;
  const frames = s.frames.filter((_, k) => k !== i);
  return touch(s, frames.length ? frames : [blankFrame()]);
}

/** Put a character on the flipbook. It stands in the middle until it is posed. */
export function addCast(s: Scene, characterId: string): { scene: Scene; castId: string } {
  const castId = newId('cast');
  return { scene: { ...s, cast: [...(s.cast ?? []), { id: castId, characterId }], updatedAt: Date.now() }, castId };
}

/** Swap who plays a part: the poses stay, the character changes. */
export function recast(s: Scene, castId: string, characterId: string): Scene {
  return { ...s, cast: (s.cast ?? []).map((c) => (c.id === castId ? { ...c, characterId } : c)), updatedAt: Date.now() };
}

/** Take a character off the flipbook (its poses go with it; the character stays in the library). */
export function removeCast(s: Scene, castId: string): Scene {
  return {
    ...s,
    cast: (s.cast ?? []).filter((c) => c.id !== castId),
    frames: s.frames.map((f) => {
      if (!f.poses?.[castId]) return f;
      const { [castId]: _gone, ...rest } = f.poses;
      return { ...f, poses: rest };
    }),
    updatedAt: Date.now(),
  };
}

/** A character's pose on note `i` (making the note if it is the waiting blank one). */
export function setPose(s: Scene, i: number, castId: string, pose: Pose): Scene {
  const e = ensure(s, i);
  return touch(
    e,
    e.frames.map((f, k) => (k === i ? { ...f, poses: { ...f.poses, [castId]: pose } } : f)),
  );
}

/** The pose a character has on note `i`: its own, or the last one before it, or null (standing). */
export function poseAt(s: Scene, i: number, castId: string): Pose | null {
  for (let k = Math.min(i, s.frames.length - 1); k >= 0; k--) {
    const p = s.frames[k].poses?.[castId];
    if (p) return p;
  }
  return null;
}

/** Does note `i` have its own pose for this character (rather than holding the one before)? */
export const ownsPose = (s: Scene, i: number, castId: string) => Boolean(s.frames[i]?.poses?.[castId]);

export function setPaper(s: Scene, paper: PaperKind): Scene {
  return { ...s, paper, updatedAt: Date.now() };
}

export function setFps(s: Scene, fps: number): Scene {
  return { ...s, fps, updatedAt: Date.now() };
}

/** The frames that have something on them, in order (what plays). Empty pads play their one blank note. */
export function playable(s: Scene): number[] {
  let last = -1;
  s.frames.forEach((f, i) => {
    if (f.strokes.length || (f.poses && Object.keys(f.poses).length)) last = i;
  });
  return Array.from({ length: Math.max(1, last + 1) }, (_, i) => i);
}

export const nextStrokeId = (s: Scene) => s.frames.reduce((m, f) => f.strokes.reduce((mm, st) => Math.max(mm, st.id), m), 0) + 1;

/** Undo and redo: old scenes kept in two lists. */
export interface History {
  past: Scene[];
  now: Scene;
  future: Scene[];
}

const LIMIT = 100;

export const historyOf = (now: Scene): History => ({ past: [], now, future: [] });

export function commit(h: History, next: Scene): History {
  if (next === h.now) return h;
  return { past: [...h.past, h.now].slice(-LIMIT), now: next, future: [] };
}

export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), now: h.past[h.past.length - 1], future: [h.now, ...h.future] };
}

export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.now], now: h.future[0], future: h.future.slice(1) };
}

/** A scene read back from storage, made safe (anything missing filled in). */
export function sanitize(raw: unknown): Scene | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Scene>;
  if (typeof r.id !== 'string' || !Array.isArray(r.frames)) return null;
  const frames: Frame[] = r.frames
    .filter((f): f is Frame => Boolean(f) && typeof f === 'object' && Array.isArray((f as Frame).strokes))
    .map((f) => ({
      id: typeof f.id === 'string' ? f.id : newId('f'),
      strokes: f.strokes.filter((st) => st && Array.isArray(st.points) && typeof st.width === 'number' && typeof st.color === 'string'),
      ...(f.poses && typeof f.poses === 'object' ? { poses: cleanPoses(f.poses) } : {}),
    }));
  const cast = Array.isArray(r.cast) ? r.cast.filter((c): c is CastMember => Boolean(c) && typeof c.id === 'string' && typeof c.characterId === 'string') : [];
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name ? r.name : 'My flipbook',
    fps: FPS_CHOICES.includes(r.fps as (typeof FPS_CHOICES)[number]) ? (r.fps as number) : 12,
    frames: frames.length ? frames : [blankFrame()],
    ...(cast.length ? { cast } : {}),
    ...(['sticky', 'sketch', 'lined', 'grid', 'kraft'].includes(r.paper as string) ? { paper: r.paper } : {}),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
  };
}

function cleanPoses(raw: Record<string, unknown>): Record<string, Pose> {
  const out: Record<string, Pose> = {};
  for (const [k, v] of Object.entries(raw)) {
    const p = v as Partial<Pose> | null;
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
    const angles: Record<string, number> = {};
    if (p.angles && typeof p.angles === 'object') for (const [b, a] of Object.entries(p.angles)) if (typeof a === 'number' && Number.isFinite(a)) angles[b] = a;
    out[k] = { x: p.x, y: p.y, angles, eyes: typeof p.eyes === 'number' ? p.eyes : 0, mouth: typeof p.mouth === 'number' ? p.mouth : 0 };
  }
  return out;
}
