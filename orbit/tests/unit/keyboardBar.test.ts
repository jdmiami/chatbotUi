/** iOS 26's floating bar above the iPhone keyboard: known from the iOS version, Home Screen too. */
import { describe, expect, it } from 'vitest';
import { hasFloatingKeyboardBar } from '../../src/hooks/useVisualViewport';

const SAFARI_26 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1';
// Added to the Home Screen: no "Version/…" and no "Safari/…".
const HOME_SCREEN_26 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const HOME_SCREEN_18 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15';

describe('the floating bar above the iPhone keyboard', () => {
  it('is there on iOS 26 in Safari and from the Home Screen; not on iOS 18 or an iPad', () => {
    expect(hasFloatingKeyboardBar(SAFARI_26)).toBe(true);
    expect(hasFloatingKeyboardBar(HOME_SCREEN_26)).toBe(true);
    expect(hasFloatingKeyboardBar(HOME_SCREEN_18)).toBe(false);
    expect(hasFloatingKeyboardBar(IPAD)).toBe(false);
  });
});
