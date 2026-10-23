import { expect, type Page, type TestInfo } from '@playwright/test';

/** Fresh app with the first-run sheet dismissed. Collects page errors so tests can assert none happened. */
export async function openOrbit(page: Page, opts: { keepIntro?: boolean } = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // The static preview has no web app: Orbit's sign-in check gets a 404 and falls back to demo mode.
    if (m.type() === 'error' && !m.text().includes('404 (Not Found)')) errors.push(`console: ${m.text()}`);
  });
  // Layout tests measure settled screens: start with Motion off unless a test saved its own settings.
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1')) {
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true } }, version: 0 }));
    }
  });
  await page.goto('/');
  if (!opts.keepIntro) {
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  return errors;
}

export const isTablet = (testInfo: TestInfo) => testInfo.project.name.startsWith('ipad');

/** The Index's title for each app (Orbit 0.5's contents page, shell/o5/IndexMenu.tsx). */
const INDEX_TITLES = {
  ai: 'Talk',
  make: 'Make',
  livedraw: 'Live Draw',
  store: 'Store',
  soreal: 'soReal',
  lab: 'Lab',
  editor: 'Code',
  terminal: 'Terminal',
  agent: 'Antigravity',
  playground: 'Playground',
  vscode: 'VS Code',
  desktop: 'Linux desktop',
  windows: 'Windows PC',
  stats: 'Stats',
  settings: 'Settings',
} as const;
export type OrbitApp = keyof typeof INDEX_TITLES;

/** The line at the bottom of the screen ("Index"; inside an app, "Index. Swipe up to go home."). */
export function indexButton(page: Page) {
  return page.getByRole('button', { name: /^Index/ });
}

/** Open the Index (the full-screen contents page) from the line at the bottom. */
export async function openIndex(page: Page) {
  const index = page.getByRole('dialog', { name: 'Index' });
  if (!(await index.isVisible())) await indexButton(page).click();
  await expect(index).toBeVisible();
  return index;
}

/** Open an app from the Index (or leave it as it is if it is already on screen). */
export async function openApp(page: Page, id: OrbitApp) {
  const win = page.locator(`.app-window[data-app="${id}"]`);
  // On screen = placed full (or in split view); a window still fading out after another app took over is not.
  if ((await win.count()) && /^(full|split)/.test((await win.getAttribute('data-placement')) ?? '')) return win;
  const index = await openIndex(page);
  const title = INDEX_TITLES[id].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await index.locator('.o5-index-list').getByRole('button', { name: new RegExp(`^\\d+\\s+${title}\\b`) }).click();
  await expect(index).toHaveCount(0);
  await expect(win).toHaveAttribute('data-placement', /^(full|split)/);
  await expect(win).toBeVisible();
  return win;
}

/** Back to the home path, through the Index. */
export async function goHome(page: Page) {
  const index = await openIndex(page);
  await index.locator('.o5-index-list').getByRole('button', { name: /^00\s+Home/ }).click();
  await expect(index).toHaveCount(0);
  await expect(page.getByRole('main', { name: 'Home' })).toHaveAttribute('data-hidden', 'false');
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
