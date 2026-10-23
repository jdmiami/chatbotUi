/**
 * Steady lines. Two kinds of help, used together:
 *  - Streamline: each new point moves only part of the way toward the pen (smooths a wobble).
 *  - Pulled string (lazy rope): the line is pulled along by a string of fixed length; the pen can
 *    wander inside the string's reach without the line moving at all, which turns a shaky hand into
 *    calm curves. The string shows on the canvas while you draw.
 */
import type { Pt } from '../canvas/sketch';

/** Streamline amount 0..1 → how far each point moves toward the pen (1 = all the way, raw). */
export function streamlineK(amount: number): number {
  const a = Math.min(1, Math.max(0, amount));
  return 1 - a * 0.85;
}

export function streamline(prev: Pt | null, raw: Pt, amount: number): Pt {
  if (!prev) return raw;
  const k = streamlineK(amount);
  return {
    ...raw,
    x: prev.x + (raw.x - prev.x) * k,
    y: prev.y + (raw.y - prev.y) * k,
    p: prev.p + (raw.p - prev.p) * Math.max(k, 0.35),
    tilt: prev.tilt + (raw.tilt - prev.tilt) * Math.max(k, 0.35),
  };
}

/**
 * The pulled string: the brush sits at `at`; when the pen goes further than `length` from it, the
 * brush is pulled straight toward the pen until it is exactly `length` behind. Returns the new brush
 * point, or null when the pen is still within reach (nothing to draw yet).
 */
export function pullString(at: Pt, pen: Pt, length: number): Pt | null {
  if (length <= 0) return pen;
  const dx = pen.x - at.x;
  const dy = pen.y - at.y;
  const d = Math.hypot(dx, dy);
  if (d <= length) return null;
  const k = (d - length) / d;
  return { ...pen, x: at.x + dx * k, y: at.y + dy * k };
}

/** Both helps in one, per stroke. */
export class Stabilizer {
  private brush: Pt | null = null;
  private smooth: Pt | null = null;

  /**
   * @param rope the string's length (canvas units, 0 = no string)
   * @param amount streamline 0..1
   */
  constructor(
    readonly rope: number,
    readonly amount: number,
  ) {}

  /** Where the string's two ends are now (to draw it), or null. */
  get anchor(): Pt | null {
    return this.brush;
  }

  /** A pen sample in; the points to add to the stroke out (none while the string is slack). */
  push(pen: Pt): Pt[] {
    if (!this.brush) {
      this.brush = pen;
      this.smooth = pen;
      return [pen];
    }
    const pulled = pullString(this.brush, pen, this.rope);
    if (!pulled) {
      // Keep the pressure live even while the string is slack.
      this.brush = { ...this.brush, p: pen.p, tilt: pen.tilt, az: pen.az, t: pen.t };
      return [];
    }
    this.brush = pulled;
    this.smooth = streamline(this.smooth, pulled, this.amount);
    return [this.smooth];
  }

  /** Points the same samples would give, without moving this one (the predicted tail). */
  peek(pens: Pt[]): Pt[] {
    const copy = new Stabilizer(this.rope, this.amount);
    copy.brush = this.brush;
    copy.smooth = this.smooth;
    return pens.flatMap((p) => copy.push(p));
  }

  /** The pen lifted: with no string, the line ends where the pen really is (streamline lags a bit). */
  finish(pen: Pt): Pt[] {
    if (this.rope > 0 || !this.smooth) return [];
    const d = Math.hypot(pen.x - this.smooth.x, pen.y - this.smooth.y);
    return d > 1e-6 ? [pen] : [];
  }
}
