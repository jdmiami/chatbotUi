import { expect, test } from '@playwright/test';

// Orbit added to an iPhone's Home Screen (iOS 26): its user agent has no Safari version, yet iOS
// floats its AutoFill and hide-keyboard bar over the page above the keyboard. Orbit keeps clear of it.
const HOME_SCREEN_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

test('Home Screen iPhone: the keyboard and the bar iOS floats above it are both kept clear', async ({ page }, info) => {
  test.skip(!/iphone-portrait/.test(info.project.name), 'the iPhone, upright');
  await page.addInitScript((ua) => {
    Object.defineProperty(navigator, 'userAgent', { get: () => ua });
    const vv = new EventTarget() as EventTarget & { height: number; width: number; offsetTop: number; offsetLeft: number; scale: number };
    vv.height = window.innerHeight;
    vv.width = window.innerWidth;
    vv.offsetTop = 0;
    vv.offsetLeft = 0;
    vv.scale = 1;
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
    (window as unknown as { keyboardUp: (h: number) => void }).keyboardUp = (h: number) => {
      vv.height = window.innerHeight - h;
      vv.dispatchEvent(new Event('resize'));
    };
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, introSeen: true } }, version: 0 }));
  }, HOME_SCREEN_UA);
  await page.goto('/');
  const inset = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset').trim());
  const height = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim());
  await expect.poll(inset).toBe('0px');
  const full = await page.evaluate(() => window.innerHeight);
  await page.evaluate(() => (window as unknown as { keyboardUp: (h: number) => void }).keyboardUp(336));
  await expect.poll(inset).toBe(`${336 + 76}px`);
  await expect.poll(height).toBe(`${full - 336 - 76}px`);
  await page.evaluate(() => (window as unknown as { keyboardUp: (h: number) => void }).keyboardUp(0));
  await expect.poll(inset).toBe('0px');
});
