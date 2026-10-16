import { expect, type Page, type TestInfo } from '@playwright/test';

/** Fresh app with the first-run sheet dismissed. Collects page errors so tests can assert none happened. */
export async function openOrbit(page: Page, opts: { keepIntro?: boolean } = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // The static preview has no web app: Orbit's sign-in check gets a 404 and falls back to demo mode.
    if (m.type() === 'error' && !m.text().includes('404 (Not Found)')) errors.push(`console: ${m.text()}`);
  });
  await page.goto('/');
  if (!opts.keepIntro) {
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  return errors;
}

export const isTablet = (testInfo: TestInfo) => testInfo.project.name.startsWith('ipad');

/** Launch an app from the home screen icon (accessible name "<App>. <description>"). */
export async function launchFromHome(page: Page, app: 'Terminal' | 'Code' | 'Antigravity' | 'Settings') {
  await page.getByRole('button', { name: new RegExp(`^${app}\\.`) }).click();
  await expect(page.locator(`.app-window[data-placement="full"], .app-window[data-placement^="split"]`).first()).toBeVisible();
}

export function dock(page: Page) {
  return page.getByRole('navigation', { name: 'Dock' });
}

export function appWindow(page: Page, id: 'terminal' | 'editor' | 'agent' | 'settings') {
  return page.locator(`.app-window[data-app="${id}"]`);
}

/** Assert nothing overflows the viewport horizontally (a common mobile layout bug). */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return document.documentElement.scrollWidth > w + 1 || document.body.scrollWidth > w + 1;
  });
  expect(overflow, 'page should not scroll horizontally').toBe(false);
}
