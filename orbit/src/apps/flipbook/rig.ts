/**
 * The stick figure's skeleton: bones in a tree from the hips, at three levels of detail.
 *
 *  - Simple (15 parts): hips, chest, head, and each arm (upper arm, forearm, hand) and leg (thigh,
 *    shin, foot).
 *  - Detailed (19): adds the belly (a bendy spine), the neck and both shoulders.
 *  - Full (51): adds every finger joint (three per finger) and the toes.
 *
 * Everything is in note units (0..1 across the note) and screen angles (0 = pointing right,
 * a quarter turn = pointing down). "Left" and "right" are as you see the figure standing on the note.
 *
 * A pose is where the hips are plus each bone's turn relative to the bone it hangs from; any bone not
 * in the pose keeps its standing angle. Posing never changes the bones' lengths.
 */

export type Level = 'simple' | 'detailed' | 'full';
export const LEVELS: { value: Level; label: string; parts: string }[] = [
  { value: 'simple', label: 'Simple', parts: '15 parts' },
  { value: 'detailed', label: 'Detailed', parts: 'adds the neck, shoulders and a bendy spine' },
  { value: 'full', label: 'Full', parts: 'adds every finger joint and the toes' },
];

export interface Bone {
  id: string;
  /** Its plain name, for the walkthrough ("Upper arm, left"). */
  name: string;
  parent: string | null;
  /** Hangs from its parent's end (most bones) or its start (the thighs hang from the hips' start). */
  at: 'start' | 'end';
  len: number;
  /** Standing angle, relative to the parent (radians). */
  rest: number;
  /** The head is drawn as a circle until its own drawing is made. */
  kind: 'line' | 'head';
  /** Bones a two-bone reach moves together: dragging the end of a forearm or shin bends the elbow or knee. */
  reach?: boolean;
}

export interface XY {
  x: number;
  y: number;
}

export interface Pose {
  /** Where the hips (the pelvis) are on the note. */
  x: number;
  y: number;
  /** Turns relative to the parent bone, by bone id (radians). Missing bones stand as they do at rest. */
  angles: Record<string, number>;
  /** Which of the character's eyes and mouths show (by number, wrapping). */
  eyes: number;
  mouth: number;
}

export interface Placed {
  bone: Bone;
  /** Where the bone starts and ends, and which way it points (absolute radians). */
  o: XY;
  e: XY;
  a: number;
}

const deg = (d: number) => (d * Math.PI) / 180;
export const norm = (a: number) => {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
};

type Spec = Omit<Bone, 'rest'> & { abs: number };

/** Bones with their standing direction given as an absolute angle (easier to read), made relative. */
/** The lengths below are for a figure about 0.6 of the note tall; this makes it fill the note better. */
const SIZE = 1.25;

function build(specs: Spec[]): Bone[] {
  const absDeg = new Map<string, number>();
  return specs.map(({ abs, ...bone }) => {
    absDeg.set(bone.id, abs);
    const from = bone.parent ? absDeg.get(bone.parent)! : 0;
    return { ...bone, len: bone.len * SIZE, rest: norm(deg(abs - from)) };
  });
}

const UP = -90;
const DOWN = 90;

function limbs(level: Level, armFrom: { l: string; r: string }): Spec[] {
  const out: Spec[] = [];
  for (const side of ['l', 'r'] as const) {
    const s = side === 'l' ? -1 : 1; // screen left points to larger angles (toward 180)
    const Side = side === 'l' ? 'left' : 'right';
    const id = (n: string) => `${n}${side.toUpperCase()}`;
    const arm = DOWN - s * 18; // hanging down, a little out from the body
    out.push(
      { id: id('upperArm'), name: `Upper arm, ${Side}`, parent: armFrom[side], at: 'end', len: 0.11, abs: arm, kind: 'line' },
      { id: id('forearm'), name: `Forearm, ${Side}`, parent: id('upperArm'), at: 'end', len: 0.1, abs: arm + s * 8, kind: 'line', reach: true },
      { id: id('hand'), name: `Hand, ${Side}`, parent: id('forearm'), at: 'end', len: 0.04, abs: arm + s * 8, kind: 'line' },
    );
    if (level === 'full') {
      // Five fingers from the hand's end, three joints each, fanned out and a little curled.
      const fingers = [
        { n: 'Thumb', spread: -s * 42, len: 0.011 },
        { n: 'Pointer finger', spread: -s * 16, len: 0.013 },
        { n: 'Middle finger', spread: 0, len: 0.014 },
        { n: 'Ring finger', spread: s * 14, len: 0.013 },
        { n: 'Little finger', spread: s * 30, len: 0.01 },
      ];
      fingers.forEach((f, k) => {
        let parent = id('hand');
        let a = arm + s * 8 + f.spread;
        for (let j = 1; j <= 3; j++) {
          const fid = id(`finger${k + 1}_${j}`);
          a += s * (j === 1 ? 0 : 8);
          out.push({ id: fid, name: `${f.n} ${['base', 'middle', 'tip'][j - 1]}, ${Side}`, parent, at: 'end', len: f.len, abs: a, kind: 'line' });
          parent = fid;
        }
      });
    }
    const leg = DOWN - s * 10;
    out.push(
      { id: id('thigh'), name: `Thigh, ${Side}`, parent: 'hips', at: 'start', len: 0.13, abs: leg, kind: 'line' },
      { id: id('shin'), name: `Shin, ${Side}`, parent: id('thigh'), at: 'end', len: 0.13, abs: DOWN, kind: 'line', reach: true },
      { id: id('foot'), name: `Foot, ${Side}`, parent: id('shin'), at: 'end', len: 0.05, abs: side === 'l' ? 180 : 0, kind: 'line' },
    );
    if (level === 'full') out.push({ id: id('toes'), name: `Toes, ${Side}`, parent: id('foot'), at: 'end', len: 0.02, abs: side === 'l' ? 180 : 0, kind: 'line' });
  }
  return out;
}

const cache = new Map<Level, Bone[]>();

/** The bones at a level, parents before children. */
export function skeleton(level: Level): Bone[] {
  const hit = cache.get(level);
  if (hit) return hit;
  let specs: Spec[];
  if (level === 'simple') {
    specs = [
      { id: 'hips', name: 'Hips', parent: null, at: 'start', len: 0.07, abs: UP, kind: 'line' },
      { id: 'chest', name: 'Chest', parent: 'hips', at: 'end', len: 0.15, abs: UP, kind: 'line' },
      { id: 'head', name: 'Head', parent: 'chest', at: 'end', len: 0.09, abs: UP, kind: 'head' },
      ...limbs(level, { l: 'chest', r: 'chest' }),
    ];
  } else {
    specs = [
      { id: 'hips', name: 'Hips', parent: null, at: 'start', len: 0.06, abs: UP, kind: 'line' },
      { id: 'belly', name: 'Belly', parent: 'hips', at: 'end', len: 0.07, abs: UP, kind: 'line' },
      { id: 'chest', name: 'Chest', parent: 'belly', at: 'end', len: 0.09, abs: UP, kind: 'line' },
      { id: 'neck', name: 'Neck', parent: 'chest', at: 'end', len: 0.03, abs: UP, kind: 'line' },
      { id: 'head', name: 'Head', parent: 'neck', at: 'end', len: 0.09, abs: UP, kind: 'head' },
      { id: 'shoulderL', name: 'Shoulder, left', parent: 'chest', at: 'end', len: 0.045, abs: 162, kind: 'line' },
      { id: 'shoulderR', name: 'Shoulder, right', parent: 'chest', at: 'end', len: 0.045, abs: 18, kind: 'line' },
      ...limbs(level, { l: 'shoulderL', r: 'shoulderR' }),
    ];
  }
  const bones = build(specs);
  cache.set(level, bones);
  return bones;
}

/** Standing in the middle of the note, feet on the lower part. */
export function restPose(): Pose {
  return { x: 0.5, y: 0.56, angles: {}, eyes: 0, mouth: 0 };
}

export const angleOf = (b: Bone, pose: Pose) => pose.angles[b.id] ?? b.rest;

/** Every bone placed for a pose (parents first). */
export function place(bones: readonly Bone[], pose: Pose): Map<string, Placed> {
  const out = new Map<string, Placed>();
  for (const b of bones) {
    let o: XY;
    let base = 0;
    if (!b.parent) o = { x: pose.x, y: pose.y };
    else {
      const p = out.get(b.parent)!;
      o = b.at === 'start' ? p.o : p.e;
      base = p.a;
    }
    const a = norm(base + angleOf(b, pose));
    out.set(b.id, { bone: b, o, a, e: { x: o.x + Math.cos(a) * b.len, y: o.y + Math.sin(a) * b.len } });
  }
  return out;
}

/** What a finger or pen can grab when posing: the hips' start moves the figure; any bone's end turns that bone. */
export interface Handle {
  /** 'move' (the whole figure), or the id of the bone whose end it is. */
  id: string;
  at: XY;
}

export function handles(placed: Map<string, Placed>): Handle[] {
  const hs: Handle[] = [];
  const root = [...placed.values()].find((p) => !p.bone.parent);
  if (root) hs.push({ id: 'move', at: root.o });
  for (const p of placed.values()) hs.push({ id: p.bone.id, at: p.e });
  return hs;
}

/** The handle nearest a point, within `tol` (smaller bones win ties, so fingers can be grabbed). */
export function grab(placed: Map<string, Placed>, at: XY, tol: number): Handle | null {
  let best: Handle | null = null;
  let bestD = tol;
  for (const h of handles(placed)) {
    const d = Math.hypot(h.at.x - at.x, h.at.y - at.y);
    if (d < bestD - 1e-9 || (best && Math.abs(d - bestD) < 1e-9)) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

const parentAbs = (placed: Map<string, Placed>, b: Bone) => (b.parent ? placed.get(b.parent)!.a : 0);

/**
 * Drag a handle to a point and get the new pose.
 *  - the hips' start moves the whole figure;
 *  - the end of a forearm or shin reaches for the point, bending the elbow or knee the way it already bends;
 *  - any other bone's end turns that bone to point at it.
 */
export function drag(bones: readonly Bone[], pose: Pose, handle: string, to: XY): Pose {
  if (handle === 'move') return { ...pose, x: to.x, y: to.y };
  const placed = place(bones, pose);
  const p = placed.get(handle);
  if (!p) return pose;
  const b = p.bone;
  const upper = b.reach && b.parent ? placed.get(b.parent) : undefined;
  if (upper) {
    const L1 = upper.bone.len;
    const L2 = b.len;
    const S = upper.o;
    const dx = to.x - S.x;
    const dy = to.y - S.y;
    const d = Math.min(L1 + L2 - 1e-6, Math.max(Math.abs(L1 - L2) + 1e-6, Math.hypot(dx, dy)));
    const toward = Math.atan2(dy, dx);
    const cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
    const alpha = Math.acos(Math.min(1, Math.max(-1, cosA)));
    // Keep the elbow or knee on the side it bends now (straight limbs bend the way they stand).
    const bend = norm(angleOf(b, pose)) || b.rest || 1;
    const sign = bend >= 0 ? -1 : 1;
    const upperAbs = toward + sign * alpha;
    const elbow = { x: S.x + Math.cos(upperAbs) * L1, y: S.y + Math.sin(upperAbs) * L1 };
    const target = { x: S.x + Math.cos(toward) * d, y: S.y + Math.sin(toward) * d };
    const lowerAbs = Math.atan2(target.y - elbow.y, target.x - elbow.x);
    return {
      ...pose,
      angles: { ...pose.angles, [upper.bone.id]: norm(upperAbs - parentAbs(placed, upper.bone)), [b.id]: norm(lowerAbs - upperAbs) },
    };
  }
  const abs = Math.atan2(to.y - p.o.y, to.x - p.o.x);
  return { ...pose, angles: { ...pose.angles, [b.id]: norm(abs - parentAbs(placed, b)) } };
}

/** A point on the note in a bone's own frame (along it, across it), at rest, and back out for a pose. */
export function toLocal(p: Placed, at: XY): XY {
  const dx = at.x - p.o.x;
  const dy = at.y - p.o.y;
  const c = Math.cos(-p.a);
  const s = Math.sin(-p.a);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export function toNote(p: Placed, local: XY): XY {
  const c = Math.cos(p.a);
  const s = Math.sin(p.a);
  return { x: p.o.x + local.x * c - local.y * s, y: p.o.y + local.x * s + local.y * c };
}
