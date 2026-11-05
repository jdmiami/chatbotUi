/**
 * Where every paper note sits on the desk, as a pure function of how far it is from the note you
 * draw on. The notes make a U:
 *
 *   next notes (top left)                    done notes (top right)
 *        \                                        /
 *         \___________ the note you draw on _____/
 *                       (bottom middle)
 *
 * `d` is a note's distance in frames from the drawing spot: 0 is the note you draw on, 1 the next
 * one, -1 the one you just finished. It is fractional while a thumb moves the pad, so every note
 * between the stacks and the middle is caught mid-flight, frozen at the speed of the thumb.
 *
 * Onion view lays the notes on either side flat, like cards, beside the note you draw on (next on
 * the left, where they come from; done on the right, where they go).
 */

export interface XY {
  x: number;
  y: number;
}

export interface Desk {
  w: number;
  h: number;
  /** Side of the note you draw on, px. */
  size: number;
  /** Its centre. */
  paper: XY;
  /** Scale of the notes in the corner stacks. */
  k: number;
  /** Centre of the stack of next notes (top left) and of done notes (top right). */
  next: XY;
  done: XY;
  /** Onion view: centre and scale of the first card on each side. */
  cardNext: XY;
  cardDone: XY;
  cardK: number;
  /** True when the onion cards sit beside the note (wide desk), false when they take the stacks' place. */
  cardsBeside: boolean;
  /** How far a thumb moves for one frame, px. */
  perFrame: number;
}

const M = 14;

export function deskOf(w: number, h: number): Desk {
  const tall = h >= w * 0.95;
  const k = tall ? 0.34 : 0.42;
  const size = Math.max(120, Math.floor(Math.min(tall ? w * 0.8 : w * 0.44, (h - 2 * M) / (1 + k) - 10)));
  const paper = { x: w / 2, y: h - M - size / 2 };
  const half = (size * k) / 2;
  const next = { x: M + half + 8, y: M + half + 6 };
  const done = { x: w - M - half - 8, y: M + half + 6 };
  const side = (w - size) / 2 - M;
  const cardsBeside = side >= size * 0.4;
  let cardK: number;
  let cardNext: XY;
  let cardDone: XY;
  if (cardsBeside) {
    cardK = Math.min((side - 16) / size, 0.62);
    const cy = paper.y + size * 0.08;
    cardNext = { x: M + side / 2, y: cy };
    cardDone = { x: w - M - side / 2, y: cy };
  } else {
    cardK = Math.min(k * 1.12, ((paper.y - size / 2 - M - 8) / size) * 0.98);
    cardNext = { x: M + (size * cardK) / 2 + 8, y: M + (size * cardK) / 2 + 4 };
    cardDone = { x: w - M - (size * cardK) / 2 - 8, y: cardNext.y };
  }
  return { w, h, size, paper, k, next, done, cardNext, cardDone, cardK, cardsBeside, perFrame: Math.max(70, size * 0.36) };
}

/** How a note is placed: centre, scale, tilt (degrees), stacking order and opacity. */
export interface Place {
  x: number;
  y: number;
  s: number;
  /** Tilt toward you around the top edge (lifting the note), around the vertical axis, and on the desk. */
  rx: number;
  ry: number;
  rz: number;
  z: number;
  o: number;
  /** 0..1: how far off the desk it is (for its shadow). */
  lift: number;
}

/** Notes this far from the middle are in a stack. */
const ARM = 3;
/** Before this, a note only lifts (or waits under the note you draw on); after it, it travels. */
const LIFTED = 0.5;
/** Visible depth of a stack; deeper notes are hidden under it. */
export const STACK_DEPTH = 6;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
/** Quick off the middle, gentle into the corner: at rest the next notes spread up the arms like a U. */
const out = (t: number) => 1 - (1 - t) ** 2;

/** The same small tilt for a note every time (so stacks look hand-piled, not shuffled). */
export function jitter(i: number): number {
  const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
}

/** A point on the U's arm: from the middle along the bottom, then up into the corner. */
function arm(from: XY, to: XY, t: number): XY {
  const c = { x: to.x, y: from.y };
  const u = 1 - t;
  return { x: u * u * from.x + 2 * u * t * c.x + t * t * to.x, y: u * u * from.y + 2 * u * t * c.y + t * t * to.y };
}

function stacked(at: XY, side: -1 | 1, depth: number, k: number, i: number, size: number): Place {
  const d = clamp(depth, 0, STACK_DEPTH + 1);
  const step = Math.max(1.5, size * k * 0.012);
  return {
    x: at.x + side * d * step,
    y: at.y - d * step * 0.8,
    s: k,
    rx: 0,
    ry: 0,
    rz: jitter(i) * 4,
    z: 1000 - Math.round(STACK_DEPTH * 10 + depth * 10) * 2,
    o: depth > STACK_DEPTH ? 0 : 1,
    lift: 0,
  };
}

/** The flip-book U: notes flap along the arms between the corner stacks and the middle. */
function flipPlace(i: number, d: number, desk: Desk): Place {
  const a = Math.abs(d);
  // Nearest the middle on top; at the same distance a done note is on top, since it is laid back down over the pad.
  const z = 1000 - Math.round(a * 10) * 2 + (d < 0 ? 1 : 0);
  if (a === 0) return { x: desk.paper.x, y: desk.paper.y, s: 1, rx: 0, ry: 0, rz: 0, z, o: 1, lift: 0 };
  const corner = d < 0 ? desk.done : desk.next; // done notes go up to the right
  if (a >= ARM) return stacked(corner, d < 0 ? 1 : -1, a - ARM, desk.k, i, desk.size);
  const t = clamp((a - LIFTED) / (ARM - LIFTED), 0, 1);
  const e = out(t);
  const p = arm(desk.paper, corner, e);
  const s = lerp(1, desk.k, ease(Math.min(1, t * 1.25)));
  const flap = Math.sin(Math.PI * t);
  if (d < 0) {
    // Lifted by its bottom edge, the way you lift a note to see the one under it, then away it flaps.
    const l = clamp(a / LIFTED, 0, 1);
    return {
      x: p.x,
      y: p.y,
      s,
      rx: -l * 50 * (1 - e) - flap * 14,
      ry: flap * 18,
      rz: lerp(0, jitter(i) * 4, e) + flap * 5,
      z,
      o: 1,
      lift: Math.max(l * (1 - e), flap * 0.8),
    };
  }
  // Waiting under the note you draw on, peeking out a little, until it is its turn.
  const wait = clamp(a / LIFTED, 0, 1);
  return {
    x: p.x - wait * (1 - e) * desk.size * 0.018,
    y: p.y + wait * (1 - e) * desk.size * 0.012,
    s,
    rx: -flap * 16,
    ry: -flap * 20,
    rz: lerp(-wait * 2.5, jitter(i) * 4, e) - flap * 5,
    z,
    o: 1,
    lift: flap * 0.8,
  };
}

/** Onion view, at a whole frame distance: cards beside the note you draw on, the rest in the stacks. */
function onionAt(i: number, j: number, desk: Desk, count: number): Place {
  if (j === 0) return { x: desk.paper.x, y: desk.paper.y, s: 1, rx: 0, ry: 0, rz: 0, z: 1000, o: 1, lift: 0 };
  const out = j < 0;
  const a = Math.abs(j);
  if (a > count) return stacked(out ? desk.done : desk.next, out ? 1 : -1, a - count - 1, desk.k, i, desk.size);
  const spot = out ? desk.cardDone : desk.cardNext;
  // Further cards fan out behind the first, away from the middle.
  const away = out ? 1 : -1;
  const fan = a - 1;
  return {
    x: spot.x + away * fan * desk.size * desk.cardK * 0.14,
    y: spot.y - fan * desk.size * desk.cardK * 0.1,
    s: desk.cardK * (1 - fan * 0.06),
    rx: 0,
    ry: 0,
    rz: away * (1.5 + fan * 3) + jitter(i),
    z: 1000 - a * 10,
    o: 1 - fan * 0.18,
    lift: 0.25,
  };
}

function mix(a: Place, b: Place, t: number): Place {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    s: lerp(a.s, b.s, t),
    rx: lerp(a.rx, b.rx, t),
    ry: lerp(a.ry, b.ry, t),
    rz: lerp(a.rz, b.rz, t),
    z: Math.round(lerp(a.z, b.z, t)),
    o: lerp(a.o, b.o, t),
    lift: Math.max(lerp(a.lift, b.lift, t), Math.sin(Math.PI * t) * 0.6),
  };
}

/**
 * Where note `i` sits when the pad is at `pos` (the frame in the middle; fractional mid-move).
 * In onion view the cards float between their spots instead of flapping.
 */
export function placeNote(i: number, pos: number, desk: Desk, onion: { on: boolean; count: number }): Place {
  const d = i - pos;
  if (!onion.on) return flipPlace(i, d, desk);
  const lo = Math.floor(d);
  const t = d - lo;
  const a = onionAt(i, lo, desk, onion.count);
  if (t < 1e-6) return a;
  return mix(a, onionAt(i, lo + 1, desk, onion.count), t);
}

/** The CSS transform for a place (the note's element is `size` square, turning on its top edge). */
export function transformOf(p: Place, size: number): string {
  const tx = p.x - size / 2;
  const ty = p.y - (p.s * size) / 2;
  return `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) rotateZ(${p.rz.toFixed(2)}deg) rotateX(${p.rx.toFixed(2)}deg) rotateY(${p.ry.toFixed(2)}deg) scale(${p.s.toFixed(4)})`;
}

/** Notes worth drawing at `pos`: everything from the bottom of one stack to the bottom of the other. */
export function visibleRange(pos: number, count: number, onion: { on: boolean; count: number }): [number, number] {
  const reach = (onion.on ? onion.count + 1 : ARM) + STACK_DEPTH + 1;
  return [Math.max(0, Math.floor(pos - reach)), Math.min(count - 1, Math.ceil(pos + reach))];
}

/** Is a desk point on the note you draw on? */
export function onPaper(desk: Desk, x: number, y: number): boolean {
  const h = desk.size / 2;
  return Math.abs(x - desk.paper.x) <= h && Math.abs(y - desk.paper.y) <= h;
}
