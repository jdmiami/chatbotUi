/**
 * The orb's physics. Everything here is plain math (no DOM), so it is unit-tested and runs the same
 * on every device. Units: CSS pixels and seconds.
 *
 * The feel is built from four ideas used by the best touch interfaces:
 *  1. Springs described by `response` (how long a move takes) and `dampingRatio` (1 = no overshoot,
 *     lower = more bounce), converted to stiffness/damping for a unit mass. Each job has its own
 *     spring, so following, dragging and settling each feel deliberate.
 *  2. Momentum projection: when you let go, where the orb would coast to under friction decides
 *     where it lands, so a flick sends it across the screen and a gentle release barely moves it.
 *  3. Rubber-banding: past the screen edge it resists more the further you pull, like a scroll view.
 *  4. Squash and stretch that keeps its volume: it stretches along its speed and wobbles back on a
 *     soft, bouncy spring, which is what makes it read as a real, slightly liquid object.
 */

export interface Spring {
  stiffness: number;
  damping: number;
}

/** Apple-style spring: `response` seconds, `dampingRatio` 0…1+ (unit mass). */
export function spring(response: number, dampingRatio: number): Spring {
  const w = (2 * Math.PI) / response;
  return { stiffness: w * w, damping: 2 * dampingRatio * w };
}

/**
 * The springs, tuned on a 120 Hz iPhone and a 60 Hz iPad:
 *  - track:   under the finger. Fast enough to feel 1:1, a touch of weight so it doesn't jitter.
 *  - follow:  drifting to what matters on the page. Unhurried, settles without fuss.
 *  - land:    after a fling, into its parking spot. One small visible bounce, like a puck on felt.
 *  - press:   sinking under a press (depth/scale). Quick and a little springy.
 *  - jelly:   squash/stretch recovery. Loose, so the wobble shows for a beat.
 *  - summon:  a shake brings it to the middle with energy, then it calms.
 */
export const SPRINGS = {
  track: spring(0.09, 0.92),
  follow: spring(0.62, 0.86),
  land: spring(0.42, 0.68),
  press: spring(0.16, 0.58),
  jelly: spring(0.32, 0.38),
  summon: spring(0.5, 0.55),
} as const;

/** UIScrollView's normal deceleration rate (per millisecond). */
export const DECELERATION = 0.998;

/** Where something moving at `velocity` (px/s) would coast to with `rate` friction (Apple's formula). */
export function project(velocity: number, rate = DECELERATION): number {
  return ((velocity / 1000) * rate) / (1 - rate);
}

/**
 * Rubber band: `overshoot` px past an edge shows as this many px (never more than `dimension`).
 * c = 0.55 is the iOS constant.
 */
export function rubberBand(overshoot: number, dimension: number, c = 0.55): number {
  if (overshoot <= 0 || dimension <= 0) return Math.max(0, overshoot);
  return (1 - 1 / ((overshoot * c) / dimension + 1)) * dimension;
}

/** Keep `v` inside [min, max], rubber-banding whatever is outside. */
export function rubberClamp(v: number, min: number, max: number, dimension: number): number {
  if (v < min) return min - rubberBand(min - v, dimension);
  if (v > max) return max + rubberBand(v - max, dimension);
  return v;
}

/** One spring-driven value with velocity. Semi-implicit Euler at 240 Hz substeps: stable at any frame rate. */
export class SpringValue {
  value: number;
  velocity = 0;
  target: number;
  spring: Spring;

  constructor(value: number, spring: Spring) {
    this.value = value;
    this.target = value;
    this.spring = spring;
  }

  step(dt: number) {
    for (let left = Math.min(dt, 0.064); left > 1e-6; left -= 1 / 240) {
      const h = Math.min(1 / 240, left);
      const a = -this.spring.stiffness * (this.value - this.target) - this.spring.damping * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
  }

  /** Close enough to rest that nothing would visibly change. */
  resting(eps = 0.05) {
    return Math.abs(this.value - this.target) < eps && Math.abs(this.velocity) < eps * 20;
  }

  /** Jump without animation. */
  set(v: number) {
    this.value = v;
    this.target = v;
    this.velocity = 0;
  }
}

/**
 * Finger velocity from the last ~100 ms of samples (least-squares slope), which ignores the jitter
 * of a single frame and the slow-down of the last one before lift-off.
 */
export class VelocityTracker {
  private samples: { t: number; x: number; y: number }[] = [];
  constructor(private windowMs = 100) {}

  add(t: number, x: number, y: number) {
    this.samples.push({ t, x, y });
    const cut = t - this.windowMs;
    while (this.samples.length > 2 && this.samples[0].t < cut) this.samples.shift();
  }

  reset() {
    this.samples = [];
  }

  /** px/s */
  velocity(): { x: number; y: number } {
    const s = this.samples;
    if (s.length < 2) return { x: 0, y: 0 };
    const t0 = s[0].t;
    let st = 0, sx = 0, sy = 0, stt = 0, stx = 0, sty = 0;
    for (const p of s) {
      const t = (p.t - t0) / 1000;
      st += t;
      sx += p.x;
      sy += p.y;
      stt += t * t;
      stx += t * p.x;
      sty += t * p.y;
    }
    const n = s.length;
    const den = n * stt - st * st;
    if (den < 1e-9) return { x: 0, y: 0 };
    return { x: (n * stx - st * sx) / den, y: (n * sty - st * sy) / den };
  }
}

/**
 * Squash and stretch from a velocity: longer along the motion, thinner across it, area kept.
 * Returns the stretch (≥ 1) and the angle (radians) of the motion.
 */
export function stretchFor(vx: number, vy: number, max = 0.22): { stretch: number; angle: number } {
  const speed = Math.hypot(vx, vy);
  const stretch = 1 + Math.min(max, speed / 5200);
  return { stretch, angle: Math.atan2(vy, vx) };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where to rest after a fling: project the momentum, clamp to the safe area, then snap to the
 * nearest side (left or right edge), keeping the height you threw it to. A throw hard enough
 * off the bottom tucks it away.
 */
export function landing(
  pos: { x: number; y: number },
  vel: { x: number; y: number },
  bounds: Rect,
  size: number,
): { x: number; y: number; tuck: boolean } {
  const px = pos.x + project(vel.x);
  const py = pos.y + project(vel.y);
  const r = size / 2;
  const minX = bounds.x + r, maxX = bounds.x + bounds.w - r;
  const minY = bounds.y + r, maxY = bounds.y + bounds.h - r;
  const tuck = vel.y > 2400 && py > maxY + size;
  const y = Math.max(minY, Math.min(maxY, py));
  const x = px < bounds.x + bounds.w / 2 ? minX : maxX;
  return { x, y, tuck };
}

/**
 * Shake detector for the motion sensor: three strong, direction-reversing jolts within ~800 ms.
 * Feed it accelerations (m/s², gravity excluded); it returns true once per shake.
 */
export class ShakeDetector {
  private peaks: { t: number; sign: number }[] = [];
  private lastShake = -Infinity;
  constructor(
    private threshold = 13,
    private needed = 3,
    private windowMs = 800,
    private cooldownMs = 1200,
  ) {}

  push(t: number, ax: number, ay: number, az = 0): boolean {
    const mag = Math.hypot(ax, ay, az);
    if (mag < this.threshold) return false;
    const main = Math.abs(ax) >= Math.abs(ay) ? ax : ay;
    const sign = Math.sign(main) || 1;
    const last = this.peaks[this.peaks.length - 1];
    if (!last || last.sign !== sign) this.peaks.push({ t, sign });
    this.peaks = this.peaks.filter((p) => t - p.t <= this.windowMs);
    if (this.peaks.length >= this.needed && t - this.lastShake > this.cooldownMs) {
      this.lastShake = t;
      this.peaks = [];
      return true;
    }
    return false;
  }
}

/** A hold is a deep press when it goes past this force (0…1), or lasts this long without moving. */
export const DEEP_PRESS = { force: 0.55, holdMs: 420, slopPx: 8 } as const;
