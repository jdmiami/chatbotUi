/**
 * A character: a skeleton at one level of detail, with a drawing on as many of its bones as you have
 * drawn so far, plus a few eyes and mouths to pick from on each frame. Parts not drawn yet show as
 * plain stick lines, so a character can be animated before it is finished.
 *
 * Each part's drawing is kept in its bone's own frame (along the bone, across it), so it turns and
 * moves with the bone. Eyes and mouths ride on the head.
 */
import type { VStroke } from '../livedraw/ink/vector';
import { newId } from './model';
import { place, restPose, skeleton, toLocal, toNote, type Level, type Placed, type Pose, type XY } from './rig';

export interface Character {
  id: string;
  name: string;
  level: Level;
  /** Drawings by bone id, in that bone's own frame. Kept even for bones a lower level hides. */
  parts: Record<string, VStroke[]>;
  /** Looks to pick from, each in the head's own frame. */
  eyes: VStroke[][];
  mouths: VStroke[][];
  updatedAt: number;
}

export function newCharacter(name: string, level: Level): Character {
  return { id: newId('char'), name: name.trim() || 'My character', level, parts: {}, eyes: [], mouths: [], updatedAt: Date.now() };
}

/** The walkthrough's steps: body parts head first, down the body, then each arm and leg; then the face. */
export type Step = { kind: 'part'; bone: string; name: string } | { kind: 'eyes' | 'mouth'; name: string };

export function steps(level: Level): Step[] {
  const bones = skeleton(level);
  const torso = ['head', 'neck', 'chest', 'belly', 'hips', 'shoulderL', 'shoulderR'];
  const order = [...torso.filter((id) => bones.some((b) => b.id === id))];
  for (const side of ['L', 'R']) for (const b of bones) if (b.id.endsWith(side) && !torso.includes(b.id) && /^(upperArm|forearm|hand|finger)/.test(b.id)) order.push(b.id);
  for (const side of ['L', 'R']) for (const b of bones) if (b.id.endsWith(side) && /^(thigh|shin|foot|toes)/.test(b.id)) order.push(b.id);
  const byId = new Map(bones.map((b) => [b.id, b]));
  return [
    ...order.map((id): Step => ({ kind: 'part', bone: id, name: byId.get(id)!.name })),
    { kind: 'eyes', name: 'Eyes' },
    { kind: 'mouth', name: 'Mouth' },
  ];
}

export const isDone = (c: Character, s: Step) =>
  s.kind === 'part' ? (c.parts[s.bone]?.length ?? 0) > 0 : (s.kind === 'eyes' ? c.eyes : c.mouths).some((l) => l.length > 0);

/** How many body parts are drawn, of how many at its level. */
export function progress(c: Character): { drawn: number; total: number } {
  const bones = skeleton(c.level);
  return { drawn: bones.filter((b) => (c.parts[b.id]?.length ?? 0) > 0).length, total: bones.length };
}

const stamp = (c: Character, patch: Partial<Character>): Character => ({ ...c, ...patch, updatedAt: Date.now() });

export function setPart(c: Character, bone: string, strokes: VStroke[]): Character {
  return stamp(c, { parts: { ...c.parts, [bone]: strokes } });
}

/** Look `i` of the eyes or mouths (adding empty looks up to it). */
export function setLook(c: Character, kind: 'eyes' | 'mouth', i: number, strokes: VStroke[]): Character {
  const list = (kind === 'eyes' ? c.eyes : c.mouths).slice();
  while (list.length <= i) list.push([]);
  list[i] = strokes;
  return stamp(c, kind === 'eyes' ? { eyes: list } : { mouths: list });
}

export function removeLook(c: Character, kind: 'eyes' | 'mouth', i: number): Character {
  const list = (kind === 'eyes' ? c.eyes : c.mouths).filter((_, k) => k !== i);
  return stamp(c, kind === 'eyes' ? { eyes: list } : { mouths: list });
}

export const setLevel = (c: Character, level: Level) => stamp(c, { level });
export const rename = (c: Character, name: string) => stamp(c, { name: name.trim() || c.name });

/** Looks with something in them (what a frame picks from). */
export const looks = (c: Character, kind: 'eyes' | 'mouth') => (kind === 'eyes' ? c.eyes : c.mouths).filter((l) => l.length > 0);

/** Strokes drawn on the note (standing figure) as a part's own drawing: moved into the bone's frame. */
export function strokesToBone(strokes: readonly VStroke[], p: Placed): VStroke[] {
  return strokes.map((s) => ({ ...s, points: s.points.map((q) => ({ ...q, ...toLocal(p, q) })) }));
}

/** A part's drawing out on the note, where its bone is now. */
export function boneToNote(strokes: readonly VStroke[], p: Placed): VStroke[] {
  return strokes.map((s) => ({ ...s, points: s.points.map((q) => ({ ...q, ...toNote(p, q) })) }));
}

export const STICK = 0.011;
export const STICK_COLOR = '#1d1b22';

/** A bone as a plain stick (the head as a circle), for parts not drawn yet. */
export function stick(p: Placed, color: string = STICK_COLOR, width: number = STICK): VStroke {
  if (p.bone.kind === 'head') {
    // The head: a circle, its bottom where the bone starts.
    const r = p.bone.len / 2;
    const c: XY = { x: (p.o.x + p.e.x) / 2, y: (p.o.y + p.e.y) / 2 };
    const pts = Array.from({ length: 25 }, (_, k) => {
      const t = (k / 24) * Math.PI * 2;
      return { x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r, p: 0.6, tilt: 0 };
    });
    return { id: -1, points: pts, width, color };
  }
  return { id: -1, points: [{ x: p.o.x, y: p.o.y, p: 0.6, tilt: 0 }, { x: p.e.x, y: p.e.y, p: 0.6, tilt: 0 }], width, color };
}

const cache = new WeakMap<Pose, WeakMap<Character, VStroke[]>>();

/** The whole figure in a pose, as strokes on the note (drawn parts, sticks for the rest, the face). */
export function figure(c: Character, pose: Pose): VStroke[] {
  let byChar = cache.get(pose);
  if (!byChar) cache.set(pose, (byChar = new WeakMap()));
  const hit = byChar.get(c);
  if (hit) return hit;
  const placed = place(skeleton(c.level), pose);
  const out: VStroke[] = [];
  for (const p of placed.values()) {
    const art = c.parts[p.bone.id];
    if (art?.length) out.push(...boneToNote(art, p));
    else out.push(stick(p, STICK_COLOR, STICK));
  }
  const head = placed.get('head');
  if (head) {
    const eyes = looks(c, 'eyes');
    const mouths = looks(c, 'mouth');
    if (eyes.length) out.push(...boneToNote(eyes[((pose.eyes % eyes.length) + eyes.length) % eyes.length], head));
    if (mouths.length) out.push(...boneToNote(mouths[((pose.mouth % mouths.length) + mouths.length) % mouths.length], head));
  }
  byChar.set(c, out);
  return out;
}

/** The standing pose every character starts from (one shared object, so drawings of it are cached). */
export const STANDING: Pose = Object.freeze(restPose()) as Pose;

export function sanitizeCharacter(raw: unknown): Character | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Character>;
  if (typeof r.id !== 'string') return null;
  const okStrokes = (v: unknown): VStroke[] =>
    Array.isArray(v) ? v.filter((s) => s && Array.isArray(s.points) && typeof s.width === 'number' && typeof s.color === 'string') : [];
  const parts: Record<string, VStroke[]> = {};
  if (r.parts && typeof r.parts === 'object') for (const [k, v] of Object.entries(r.parts)) parts[k] = okStrokes(v);
  const lvl: Level = r.level === 'detailed' || r.level === 'full' ? r.level : 'simple';
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name ? r.name : 'My character',
    level: lvl,
    parts,
    eyes: Array.isArray(r.eyes) ? r.eyes.map(okStrokes) : [],
    mouths: Array.isArray(r.mouths) ? r.mouths.map(okStrokes) : [],
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
  };
}
