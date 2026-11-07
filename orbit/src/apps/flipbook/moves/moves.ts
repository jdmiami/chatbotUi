/**
 * The Action Pack: real recorded human motion (CMU Graphics Lab Motion Capture Database, free for
 * research and commercial projects) turned into stick-figure joints, 12 frames a second
 * (scripts/mocap/cmu_to_flipbook.py). Putting a move on the notes fits the character's own skeleton
 * (any level) to those joints, one pose per note, so a drawn character backflips, kicks or cartwheels.
 */
import { norm, skeleton, type Bone, type Level, type Pose } from '../rig';
import { setPose, type Scene } from '../model';

export interface PackMove {
  id: string;
  name: string;
  group: string;
  source: string;
  view: 'side' | 'front';
  fps: number;
  /** Each frame: x, y of every joint, in the order of `joints`. */
  frames: number[][];
}
export interface Pack {
  about: string;
  joints: string[];
  moves: PackMove[];
}

let loading: Promise<Pack> | null = null;
/** The pack is only downloaded when it is first opened. */
export function loadPack(): Promise<Pack> {
  loading ??= import('./actionPack.json').then((m) => (m.default ?? m) as unknown as Pack);
  return loading;
}

export const GROUPS = ['Flips', 'Cartwheels', 'Kicks', 'Punches', 'Falls and rolls', 'Jumps', 'Run and walk'];

type XY = { x: number; y: number };
type Joints = Record<string, XY>;

function jointsOf(pack: Pack, f: number[]): Joints {
  const out: Joints = {};
  pack.joints.forEach((name, i) => (out[name] = { x: f[2 * i], y: f[2 * i + 1] }));
  return out;
}

/** The joints at time `t` seconds into the move, smoothly between recorded frames. */
export function jointsAt(pack: Pack, move: PackMove, t: number): Joints {
  const k = Math.max(0, Math.min(move.frames.length - 1, t * move.fps));
  const a = Math.floor(k);
  const b = Math.min(move.frames.length - 1, a + 1);
  const u = k - a;
  const fa = move.frames[a];
  const fb = move.frames[b];
  return jointsOf(
    pack,
    fa.map((v, i) => v + (fb[i] - v) * u),
  );
}

export const seconds = (m: PackMove) => (m.frames.length - 1) / m.fps;

/** Which recorded joints each of Flipbook's bones points between (start → end). */
function segmentFor(level: Level, id: string): [string, string] | null {
  const side = id.slice(-1);
  const base = /[LR]$/.test(id) ? id.slice(0, -1) : id;
  const simple = level === 'simple';
  switch (base) {
    case 'hips':
      return ['pelvis', 'spine1'];
    case 'belly':
      return ['spine1', 'spine2'];
    case 'chest':
      return simple ? ['spine1', 'neckBase'] : ['spine2', 'neckBase'];
    case 'neck':
      return ['neckBase', 'neckTop'];
    case 'head':
      return simple ? ['neckBase', 'headTop'] : ['neckTop', 'headTop'];
    case 'shoulder':
      return ['neckBase', `shoulder${side}`];
    case 'upperArm':
      return [`shoulder${side}`, `elbow${side}`];
    case 'forearm':
      return [`elbow${side}`, `wrist${side}`];
    case 'hand':
      return [`wrist${side}`, `hand${side}`];
    case 'thigh':
      return [`hip${side}`, `knee${side}`];
    case 'shin':
      return [`knee${side}`, `ankle${side}`];
    case 'foot':
      return [`ankle${side}`, `foot${side}`];
    case 'toes':
      return [`foot${side}`, `toe${side}`];
    default:
      return null; // fingers keep their own curl
  }
}

export interface FitOptions {
  /** Flip left and right (facing the other way). */
  mirror?: boolean;
  /** Where the hips start on the note (the move travels from there). */
  at?: XY;
  /** Keep the figure in the middle of the note instead of travelling with the move. */
  inPlace?: boolean;
  /** Where the hips were at the start of the move (for keeping it in place and for moving it to `at`). */
  start?: XY;
}

/** Flipbook's skeleton (at `level`) fitted to a set of recorded joints. */
export function fit(bones: readonly Bone[], level: Level, j: Joints, o: FitOptions = {}): Pose {
  const start = o.start ?? j.pelvis;
  const at = o.at ?? start;
  const flip = (p: XY): XY => (o.mirror ? { x: 2 * start.x - p.x, y: p.y } : p);
  const get = (name: string): XY => {
    // Mirroring also swaps which side is which.
    const n = o.mirror && /[LR]$/.test(name) ? name.slice(0, -1) + (name.endsWith('L') ? 'R' : 'L') : name;
    return flip(j[n]);
  };
  const abs = new Map<string, number>();
  const angles: Record<string, number> = {};
  for (const b of bones) {
    const parentAbs = b.parent ? (abs.get(b.parent) ?? 0) : 0;
    const seg = segmentFor(level, b.id);
    let a: number;
    if (seg && j[seg[0]] && j[seg[1]]) {
      const p = get(seg[0]);
      const q = get(seg[1]);
      a = Math.atan2(q.y - p.y, q.x - p.x);
    } else a = parentAbs + b.rest;
    abs.set(b.id, a);
    angles[b.id] = norm(a - parentAbs);
  }
  const pelvis = get('pelvis');
  const x = o.inPlace ? at.x : at.x + (pelvis.x - start.x);
  const y = at.y + (pelvis.y - start.y);
  return { x, y, angles, eyes: 0, mouth: 0 };
}

export interface ApplyOptions {
  /** The note the move starts on. */
  from: number;
  /** Notes a second of the flipbook (the move keeps its real speed). */
  fps: number;
  /** 0.5 slow motion, 1 real speed, 1.5 fast. */
  speed: number;
  mirror: boolean;
  inPlace: boolean;
  /** Where the character stands when the move begins (its pose on the first note). */
  standing: Pose;
}

/** How many notes the move takes at this flipbook's speed. */
export const notesFor = (m: PackMove, fps: number, speed: number) => Math.max(1, Math.round((seconds(m) / speed) * fps) + 1);

/**
 * Put a move on the notes: one pose per note for this character, making notes as needed. The move
 * starts where the character stands now (the recorded feet are on the same ground).
 */
export function applyMove(scene: Scene, castId: string, level: Level, pack: Pack, move: PackMove, o: ApplyOptions): { scene: Scene; notes: number } {
  const bones = skeleton(level);
  const n = notesFor(move, o.fps, o.speed);
  const first = jointsAt(pack, move, 0);
  // The recorded hips start where a standing figure's hips are; follow the character from there.
  const at = { x: o.standing.x, y: o.standing.y + (first.pelvis.y - 0.56) };
  let s = scene;
  for (let k = 0; k < n; k++) {
    const t = (k / o.fps) * o.speed;
    const pose = fit(bones, level, jointsAt(pack, move, t), { mirror: o.mirror, inPlace: o.inPlace, at, start: first.pelvis });
    s = setPose(s, o.from + k, castId, { ...pose, eyes: o.standing.eyes, mouth: o.standing.mouth });
  }
  return { scene: s, notes: n };
}
