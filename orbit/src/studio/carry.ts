/**
 * "The orb carries it": between two steps the old sheet shrinks into the orb, as if it were picked
 * up, and the next one grows out of it where the orb set it down. Only the middle of the screen
 * moves; the bars stay where they are.
 */
import type { MotionLevel } from '../motion/level';

/** Where the orb is now (its centre), or the middle-top of the stage when it is hidden or off. */
export function orbPoint(fallback: HTMLElement | null): { x: number; y: number } {
  const orb = document.querySelector('.orb-layer:not([data-hidden]) .orb-cursor');
  const r = orb?.getBoundingClientRect();
  if (r && r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  const s = fallback?.getBoundingClientRect();
  return s ? { x: s.left + s.width / 2, y: s.top + 40 } : { x: innerWidth / 2, y: 80 };
}

function originIn(el: HTMLElement, p: { x: number; y: number }) {
  const r = el.getBoundingClientRect();
  return `${p.x - r.left}px ${p.y - r.top}px`;
}

/** The old sheet goes into the orb. Resolves when it is gone (at once with motion off). */
export function carryOut(el: HTMLElement | null, level: MotionLevel): Promise<void> {
  if (!el || level === 'off' || !el.animate) return Promise.resolve();
  el.style.transformOrigin = originIn(el, orbPoint(el));
  const a = el.animate(
    [
      { transform: 'scale(1) rotate(0deg)', opacity: 1, filter: 'blur(0px)' },
      { transform: 'scale(0.86) rotate(-1.5deg)', opacity: 0.85, filter: 'blur(0px)', offset: 0.35 },
      { transform: 'scale(0.08) rotate(4deg)', opacity: 0, filter: 'blur(6px)' },
    ],
    { duration: level === 'lite' ? 240 : 420, easing: 'cubic-bezier(.55,0,.75,.2)', fill: 'forwards' },
  );
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

/** The new sheet comes out of the orb and settles with a little give. */
export function carryIn(el: HTMLElement | null, level: MotionLevel) {
  if (!el || level === 'off' || !el.animate) return;
  el.style.transformOrigin = originIn(el, orbPoint(el));
  el.animate(
    [
      { transform: 'scale(0.1) rotate(-3deg)', opacity: 0, filter: 'blur(6px)' },
      { transform: 'scale(1.025) rotate(0.3deg)', opacity: 1, filter: 'blur(0px)', offset: 0.7 },
      { transform: 'scale(1) rotate(0deg)', opacity: 1, filter: 'blur(0px)' },
    ],
    { duration: level === 'lite' ? 260 : 560, easing: 'cubic-bezier(.2,.8,.2,1)' },
  );
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
