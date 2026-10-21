import { AUTO_OFF, autoOffSentence } from '../../../shared/autooff.js';

/**
 * The one auto-off rule, for Orbit's screens. Every machine turns itself off after the same number of
 * minutes unused; the site sends that number (/api/status, /api/ai) and these screens show it. The
 * shared default (shared/autooff.js) only fills in until the site answers.
 */
export { AUTO_OFF, autoOffSentence };

/** The first real minutes given (the machine's own timer, then the site's rule), else the shared default. */
export function autoOffMinutesOf(...candidates: (number | null | undefined)[]): number {
  for (const c of candidates) if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c;
  return AUTO_OFF.defaultMinutes;
}

/** "turns itself off in 24 min if unused", or held on by "Keep on". */
export function untilText(offAt: string | null | undefined, now: number, heldUntil?: string | null): string | null {
  if (!offAt) return null;
  const min = Math.round((Date.parse(offAt) - now) / 60_000);
  if (min <= 0) return 'turning itself off now';
  if (heldUntil && Date.parse(heldUntil) >= Date.parse(offAt)) return `kept on: turns itself off in ${min} min`;
  return `turns itself off in ${min} min if unused`;
}
