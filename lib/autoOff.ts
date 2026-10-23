import 'server-only';
import { AUTO_OFF, clampAutoOffMinutes } from '@/shared/autooff.js';

/**
 * The one auto-off rule, on the site's side. Every Runpod machine (the AI machine, its helper, every
 * speed, Live Draw's drawing machine, the Linux machine and its stand-in) turns itself off after
 * autoOffMinutes() without use. The site sends this number to each machine as IDLE_MINUTES when it
 * turns it on (lib/ai.ts, lib/canvas.ts, lib/runpod.ts), the watchdog uses it (lib/watchdog.ts), and every screen shows it (/api/status,
 * /api/ai). The timer the machines run is shared/autooff.js.
 *
 * Set AUTO_OFF_MINUTES in Vercel (10–60, default 60). The older AI_IDLE_MINUTES still works.
 */
export function autoOffMinutes(): number {
  return clampAutoOffMinutes(process.env.AUTO_OFF_MINUTES || process.env.AI_IDLE_MINUTES);
}

/** The "turning off soon" notice comes this many minutes before. */
export const WARN_MINUTES = AUTO_OFF.warnMinutes;
/** One "Keep on" tap adds this many minutes. */
export const KEEP_ON_MINUTES = AUTO_OFF.keepOnMinutes;
/** "Keep on" never holds a machine on longer than this from now. */
export const MAX_HOLD_MINUTES = AUTO_OFF.maxHoldMinutes;
/** The watchdog waits this long past the limit for the machine's own timer. */
export const GRACE_MINUTES = AUTO_OFF.graceMinutes;
/** The watchdog turns off a machine on this long that doesn't say how idle it is. */
export const BLIND_LIMIT_MINUTES = AUTO_OFF.blindMinutes;

/** The numbers the screens need, in one object (part of /api/status and /api/ai). */
export function autoOffInfo() {
  return { minutes: autoOffMinutes(), warnMinutes: WARN_MINUTES, keepOnMinutes: KEEP_ON_MINUTES, maxHoldMinutes: MAX_HOLD_MINUTES };
}
export type AutoOffInfo = ReturnType<typeof autoOffInfo>;

/** Minutes for a "Keep on" request: the usual step when not given, never more than the cap. */
export function keepOnMinutes(minutes: unknown): number {
  const n = Math.round(Number(minutes));
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_HOLD_MINUTES, Math.max(5, n)) : KEEP_ON_MINUTES;
}
