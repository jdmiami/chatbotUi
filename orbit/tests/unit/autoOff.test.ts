/** The one auto-off rule on Orbit's screens: the site's number first, the shared default only until it answers. */
import { describe, expect, it } from 'vitest';
import { AUTO_OFF, autoOffMinutesOf, autoOffSentence, untilText } from '../../src/services/autoOff';

describe('auto-off words', () => {
  it('uses the first real number, else the shared default', () => {
    expect(autoOffMinutesOf(undefined, null, 30)).toBe(30);
    expect(autoOffMinutesOf(45, 30)).toBe(45);
    expect(autoOffMinutesOf(0, undefined)).toBe(AUTO_OFF.defaultMinutes);
    expect(AUTO_OFF.defaultMinutes).toBe(60);
  });

  it('says it plainly', () => {
    expect(autoOffSentence(60)).toBe('Turns itself off after 60 minutes unused.');
    const now = Date.UTC(2030, 0, 1);
    const at = (min: number) => new Date(now + min * 60_000).toISOString();
    expect(untilText(at(24), now)).toBe('turns itself off in 24 min if unused');
    expect(untilText(at(54), now, at(54))).toBe('kept on: turns itself off in 54 min');
    expect(untilText(at(0), now)).toBe('turning itself off now');
    expect(untilText(null, now)).toBeNull();
  });
});
