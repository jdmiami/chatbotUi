import type { MotionLevel } from './level';

/**
 * Springs in Apple's terms (docs/05-motion.md §3): `response` is roughly how long the motion takes in
 * seconds, `damping` 1 means no overshoot and lower means more bounce. Converted to the physics
 * Motion uses: stiffness = (2π / response)², friction = 4π · damping / response, mass 1.
 */
export function ios(response: number, damping: number) {
  return { type: 'spring' as const, stiffness: (2 * Math.PI / response) ** 2, damping: (4 * Math.PI * damping) / response, mass: 1 };
}

export const SPRING = {
  /** Presses, toggles, small controls. */
  snappy: ios(0.3, 0.86),
  /** Large areas fading or leaving. */
  smooth: ios(0.5, 1),
  /** App windows opening and closing (SwiftUI's default spring). */
  default: ios(0.55, 0.825),
  /** Sheets, cards and messages arriving. */
  bouncy: ios(0.5, 0.7),
  /** The status pill, icons popping in. */
  playful: ios(0.45, 0.58),
  /** Anything let go mid-drag (starts with the finger's speed). */
  flick: ios(0.4, 0.8),
};

export type SpringName = keyof typeof SPRING;

/** The transition for a spring at the current level: Lite is a short ease, Off a quick cross-fade. */
export function transitionFor(level: MotionLevel, name: SpringName = 'bouncy') {
  if (level === 'off') return { duration: 0.15, ease: 'easeOut' as const };
  if (level === 'lite') return { type: 'tween' as const, duration: 0.18, ease: [0.2, 0.8, 0.2, 1] as const };
  return SPRING[name];
}
