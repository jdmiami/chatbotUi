import type { Transition } from 'motion/react';
import type { MotionLevel } from './level';

/** Spring "personalities" shared by every animation, so the whole app moves the same way. */
export const SPRING = {
  /** Quick and tight: buttons, small pops. */
  snappy: { type: 'spring', stiffness: 520, damping: 32, mass: 0.7 },
  /** Playful overshoot: things that arrive (messages, icons, sheets). */
  bouncy: { type: 'spring', stiffness: 380, damping: 19, mass: 0.85 },
  /** Soft and slow: big surfaces (app windows, backgrounds). */
  gentle: { type: 'spring', stiffness: 210, damping: 26, mass: 1 },
} as const satisfies Record<string, Transition>;

export type SpringName = keyof typeof SPRING;

/** The transition for a spring at the current level: Lite swaps the spring for a short ease, Off for none. */
export function transitionFor(level: MotionLevel, name: SpringName = 'bouncy'): Transition {
  if (level === 'off') return { duration: 0 };
  if (level === 'lite') return { type: 'tween', duration: 0.18, ease: [0.2, 0.8, 0.2, 1] };
  return SPRING[name];
}
