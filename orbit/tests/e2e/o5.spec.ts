import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, openOrbit } from './helpers';
import { mockAi } from './aiMocks';

/** Orbit 0.5: the optional look. The path home, the index, the line at the bottom, tucked headers. */

async function turnOn(page: Page) {
  await page.getByRole('button', { name: /^Settings\./ }).click();
  const look = page.getByRole('group', { name: 'Look' });
  await look.scrollIntoViewIfNeeded();
  await look.getByRole('button', { name: 'Orbit 0.5' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'o5');
}

async function expectTappable(page: Page, scope: string) {
  const boxes = await page.locator(`${scope} :is(button, a):visible`).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label') || el.textContent?.trim() || '?', w: r.width, h: r.height, x: r.x, right: r.right };
    }),
  );
  const vw = page.viewportSize()!.width;
  for (const b of boxes) {
    if (b.right < 0 || b.x > vw) continue; // off-screen pages of the path
    expect(Math.min(b.w, b.h), `${b.name} is big enough to tap`).toBeGreaterThanOrEqual(44);
  }
}

test.describe('Orbit 0.5', () => {
  test('MagStyle is the only look: a saved classic look moves over, and there is no switch back', async ({ browser }) => {
    // A browser without the test suite's classic flag: what people get.
    const ctx = await browser.newContext({ reducedMotion: 'reduce', storageState: { cookies: [], origins: [] } });
    await ctx.addInitScript(() =>
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, skin: 'classic', introSeen: true } }, version: 0 })),
    );
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'o5');
    await page.getByRole('button', { name: /^Index/ }).click();
    const index = page.getByRole('dialog', { name: 'Index' });
    await expect(index.getByRole('button', { name: 'Classic look' })).toHaveCount(0);
    await index.locator('.o5-index-list').getByRole('button', { name: /Settings/ }).click();
    await expect(page.locator('.app-window[data-app="settings"]')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Look' })).toHaveCount(0);
    await ctx.close();
  });

  test('switch it on in Settings: the path replaces the icons and the dock', async ({ page }) => {
    await mockAi(page, 'off');
    const errors = await openOrbit(page);
    await turnOn(page);
    // Back home through the index.
    await page.getByRole('button', { name: /^Index/ }).click();
    const index = page.getByRole('dialog', { name: 'Index' });
    await index.getByRole('button', { name: /Home/ }).click();
    await expect(index).toHaveCount(0);
    const home = page.getByRole('main', { name: 'Home' });
    await expect(home.getByRole('heading', { level: 1 })).toHaveText(/^Good (morning|afternoon|evening|night)\.$/);
    await expect(home).toContainText('your AI machine is resting');
    await expect(page.getByRole('navigation', { name: 'Dock' })).toHaveCount(0);
    for (const t of ['Continue', 'Talk', 'Make', 'Build', 'Tune']) await expect(home.getByRole('heading', { name: t })).toBeAttached();
    await expectNoHorizontalOverflow(page);
    await expectTappable(page, '.o5-path');
    expect(errors).toEqual([]);
  });

  test('walk the path: Begin scrolls to chapter one, a chapter link opens the app, the line goes home', async ({ page }) => {
    await mockAi(page, 'on');
    const errors = await openOrbit(page);
    await turnOn(page);
    await page.getByRole('button', { name: /^Index/ }).click();
    await page.getByRole('dialog', { name: 'Index' }).getByRole('button', { name: /Home/ }).click();
    await page.getByRole('button', { name: 'Begin' }).click();
    await expect(page.getByRole('heading', { name: 'Continue' })).toBeInViewport();
    // Settings is still open from switching the look: it is the thing to continue.
    await page.getByRole('main', { name: 'Home' }).getByRole('button', { name: /^Settings/ }).first().click();
    await expect(page.locator('.app-window[data-app="settings"]')).toBeVisible();

    await page.getByRole('button', { name: /^Index/ }).click();
    const index = page.getByRole('dialog', { name: 'Index' });
    await expect(index.getByRole('region', { name: 'Open now' })).toContainText('Settings');
    await expectTappable(page, '.o5-index');
    await expectNoHorizontalOverflow(page);
    await index.getByRole('button', { name: /Talk/ }).click();
    await expect(page.locator('.app-window[data-app="ai"] .ai-composer')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('headers tuck away while scrolling down and come back scrolling up', async ({ page }) => {
    await mockAi(page, 'on');
    await openOrbit(page);
    await turnOn(page);
    const win = page.locator('.app-window[data-app="settings"]');
    const scroller = win.locator('.st-scroll');
    // Something scrolling by itself leaves the header alone…
    await scroller.evaluate((el) => el.scrollBy(0, 400));
    await expect(win).not.toHaveAttribute('data-chrome', 'hidden');
    await scroller.evaluate((el) => el.scrollTo(0, 0));
    // …your own scrolling tucks it away, and scrolling back brings it back.
    const box = (await scroller.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 400);
    await expect(win).toHaveAttribute('data-chrome', 'hidden');
    await page.mouse.wheel(0, -300);
    await expect(win).toHaveAttribute('data-chrome', 'shown');
  });

  test('the classic look comes back from the index', async ({ page }) => {
    await mockAi(page, 'off');
    await openOrbit(page);
    await turnOn(page);
    await page.getByRole('button', { name: /^Index/ }).click();
    await page.getByRole('dialog', { name: 'Index' }).getByRole('button', { name: 'Classic look' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'classic');
    await expect(page.getByRole('navigation', { name: 'Dock' })).toBeVisible();
  });

  test('full motion: pages carry their depth as they scroll', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockAi(page, 'off');
    await page.addInitScript(() =>
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'full', motionPicked: true, skin: 'o5', introSeen: true } }, version: 0 })),
    );
    await page.goto('/');
    const path = page.getByRole('main', { name: 'Home' });
    const talk = page.locator('#o5-talk');
    await expect.poll(() => talk.evaluate((el) => Number(el.style.getPropertyValue('--p')))).toBeGreaterThan(0.5);
    await path.evaluate((el) => el.scrollTo(0, (document.getElementById('o5-talk') as HTMLElement).offsetTop));
    await expect.poll(() => talk.evaluate((el) => Math.abs(Number(el.style.getPropertyValue('--p'))))).toBeLessThan(0.2);
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
    expect(errors).toEqual([]);
  });

  test('the index asks before closing an app with unsaved work, and keeps keyboard focus inside', async ({ page }) => {
    await mockAi(page, 'off');
    await openOrbit(page);
    await turnOn(page);
    await page.getByRole('button', { name: /^Index/ }).click();
    await page.getByRole('dialog', { name: 'Index' }).getByRole('button', { name: /Code/ }).click();
    const editor = page.locator('.app-window[data-app="editor"] .cm-content');
    await editor.click();
    await page.keyboard.type('x');
    await page.getByRole('button', { name: /^Index/ }).click();
    const index = page.getByRole('dialog', { name: 'Index' });
    await expect(index.getByRole('region', { name: 'Open now' })).toContainText('unsaved');
    // Tab never leaves the index.
    for (let i = 0; i < 30; i++) await page.keyboard.press('Tab');
    expect(await index.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await index.getByRole('button', { name: 'Close Code' }).click();
    const ask = page.getByRole('dialog', { name: 'Close Code?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.app-window[data-app="editor"]')).toHaveCount(1);
    await index.getByRole('button', { name: 'Close Code' }).click();
    await page.getByRole('dialog', { name: 'Close Code?' }).getByRole('button', { name: 'Discard and close' }).click();
    await expect(page.locator('.app-window[data-app="editor"]')).toHaveCount(0);
  });
});
