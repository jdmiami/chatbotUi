import type { MotionPref } from '../state/shell';

/** How much Orbit animates. Full = springs, morphs, tilt, blur; Lite = short fades and moves; Off = none. */
export type MotionLevel = 'full' | 'lite' | 'off';

const PROBE_KEY = 'orbit:motion:probe:v1';
const PROBE_TTL = 7 * 24 * 3600 * 1000;

export function resolveLevel(pref: MotionPref, osReduce: boolean, probe: 'full' | 'lite'): MotionLevel {
  if (pref === 'reduce') return 'off';
  if (pref === 'full') return 'full';
  if (pref === 'lite') return 'lite';
  return osReduce ? 'off' : probe;
}

/** Last measured result, if still fresh. */
export function cachedProbe(): 'full' | 'lite' | null {
  try {
    const raw = JSON.parse(localStorage.getItem(PROBE_KEY) ?? 'null') as { level: 'full' | 'lite'; at: number } | null;
    if (raw && (raw.level === 'full' || raw.level === 'lite') && Date.now() - raw.at < PROBE_TTL) return raw.level;
  } catch {
    /* storage blocked */
  }
  return null;
}

/**
 * Safari can't tell a page about Low Power Mode or the device's speed, so measure instead: count
 * how many frames the screen actually draws in about half a second. Older or throttled devices
 * (Low Power Mode caps iPhones at 30 fps) land in Lite.
 */
export function measureFrames(ms = 550): Promise<'full' | 'lite'> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') return resolve('full');
    const times: number[] = [];
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      times.push(t);
      if (t - start < ms) return requestAnimationFrame(tick);
      // Drop the first frames (page still loading), then use the median gap.
      const gaps = times
        .slice(3)
        .map((v, i, a) => (i ? v - a[i - 1] : 0))
        .slice(1)
        .sort((a, b) => a - b);
      const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 16;
      resolve(median > 24 ? 'lite' : 'full');
    };
    requestAnimationFrame(tick);
  });
}

export function rememberProbe(level: 'full' | 'lite') {
  try {
    localStorage.setItem(PROBE_KEY, JSON.stringify({ level, at: Date.now() }));
  } catch {
    /* storage blocked */
  }
}
