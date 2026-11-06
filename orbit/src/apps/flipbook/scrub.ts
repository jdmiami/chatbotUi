/**
 * Moving the pad with a thumb. The pad follows the thumb exactly (one frame per `perFrame` px), so a
 * slow drag lifts the note slowly. Letting go:
 *  - a page only partly lifted springs back to the note you were on (peeking never loses your place);
 *  - every whole page you moved past stays turned;
 *  - a quick flick turns one more page, or a few for a fast one.
 */

/** Which way the thumb moves the pad: up or right turns forward (papers travel up the right arm). */
export function dragFrames(dx: number, dy: number, axis: 'x' | 'y', perFrame: number): number {
  return (axis === 'x' ? dx : -dy) / perFrame;
}

/** The axis a drag is locked to, once it has moved far enough to tell (null until then). */
export function lockAxis(dx: number, dy: number, slop = 8): 'x' | 'y' | null {
  if (Math.hypot(dx, dy) < slop) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

/** Past the first and last note the pad gives a little, then stops (a rubber band). */
export function rubber(pos: number, max: number): number {
  if (pos < 0) return -0.35 * (1 - 1 / (1 - pos));
  if (pos > max) return max + 0.35 * (1 - 1 / (1 + pos - max));
  return pos;
}

/** Fast enough to count as a flick, in frames per second. */
const FLICK = 3;

/**
 * Where the pad comes to rest when the thumb lets go.
 * @param start the frame the drag began on
 * @param pos where the pad is now (fractional)
 * @param v speed in frames per second (+ forward)
 * @param max the last note's index
 */
export function settle(start: number, pos: number, v: number, max: number): number {
  const moved = pos - start;
  let target = start + Math.trunc(moved);
  if (Math.abs(v) >= FLICK && (Math.sign(v) === Math.sign(moved) || Math.abs(moved) < 0.05)) {
    target = start + Math.trunc(moved) + Math.sign(v) * Math.max(1, Math.round(Math.abs(v) * 0.12));
  }
  return Math.min(max, Math.max(0, Math.round(target)));
}

/** Speed from recent samples (time ms, position frames), over about the last 100 ms. */
export function velocity(samples: readonly { t: number; p: number }[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (const s of samples) if (last.t - s.t <= 100) {
    first = s;
    break;
  }
  const dt = (last.t - first.t) / 1000;
  return dt > 0.005 ? (last.p - first.p) / dt : 0;
}

/**
 * One step of the spring that carries the pad to rest (critically damped: no wobble past the
 * note, so it never looks like it is about to turn a page it won't).
 */
export function springStep(x: number, v: number, target: number, dt: number, stiffness = 170): { x: number; v: number } {
  const w = Math.sqrt(stiffness);
  const a = -stiffness * (x - target) - 2 * w * v;
  const nv = v + a * dt;
  return { x: x + nv * dt, v: nv };
}

export const atRest = (x: number, v: number, target: number) => Math.abs(x - target) < 0.002 && Math.abs(v) < 0.02;
