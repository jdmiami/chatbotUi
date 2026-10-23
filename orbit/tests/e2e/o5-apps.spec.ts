import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';

/** Orbit 0.5 in Settings, Antigravity, Terminal and Code: contents pages, chapters, and headers that keep only what matters. */

async function openO5(page: Page, entry: RegExp, app: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, introSeen: true } }, version: 0 }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  await page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list').getByRole('button', { name: entry }).click();
  const win = page.locator(`.app-window[data-app="${app}"]`);
  await expect(win).toBeVisible();
  return { errors, win };
}

test.describe('Orbit 0.5: the other apps', () => {
  test('settings: a contents page that walks to each numbered chapter', async ({ page }) => {
    const { errors, win } = await openO5(page, /Settings/, 'settings');
    const chapters = win.getByRole('navigation', { name: 'Chapters' });
    await expect(chapters.getByRole('button')).toHaveCount(11);
    await chapters.getByRole('button', { name: /Data & storage/ }).click();
    await expect(win.getByRole('heading', { name: 'Data & storage' })).toBeInViewport();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('antigravity: the sessions read like a contents page', async ({ page }) => {
    const { errors, win } = await openO5(page, /Antigravity/, 'agent');
    if ((await win.locator('.ag-root').getAttribute('data-compact')) === 'true') await expect(win.getByRole('heading', { name: 'Your sessions' })).toBeVisible();
    await expect(win.locator('.ag-session').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('terminal: copy and paste live in More; the header keeps the keyboard', async ({ page }) => {
    const { errors, win } = await openO5(page, /Terminal/, 'terminal');
    const header = win.locator('.app-header');
    await expect(header.getByRole('button', { name: 'Keyboard' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Copy selection' })).toHaveCount(0);
    await header.getByRole('button', { name: 'More terminal options' }).click();
    const sheet = page.getByRole('dialog', { name: 'Terminal options' });
    for (const name of ['Copy selection', 'Paste', /Show history/]) await expect(sheet.getByRole('button', { name, exact: true })).toBeVisible();
    await sheet.getByRole('button', { name: /Show history/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('code: one Save (in the tools), and the file tabs step aside while typing', async ({ page }) => {
    const { errors, win } = await openO5(page, /^\d+ Code /, 'editor');
    await expect(win.locator('.app-header').getByRole('button', { name: 'Save file' })).toBeHidden();
    await expect(win.getByRole('button', { name: /^Save/ }).first()).toBeVisible();
    await page.locator('.shell').evaluate((el) => el.setAttribute('data-keyboard', 'true'));
    await expect(win.locator('.ed-tabs')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('a magazine: each app opens on its chapter page, apps turn like pages, and a running head says where you are', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() =>
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'full', motionPicked: true, introSeen: true } }, version: 0 })),
    );
    await page.goto('/');
    const open = async (entry: RegExp) => {
      await page.getByRole('button', { name: /^Index/ }).click();
      await page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list').getByRole('button', { name: entry }).click();
    };
    await open(/Terminal/);
    const term = page.locator('.app-window[data-app="terminal"]');
    const opener = term.locator('.o5-opener');
    await expect(opener).toContainText(/Chapter \d+/);
    await expect(opener).toContainText('Terminal');
    // It lifts away by itself and never takes a tap.
    await expect(opener).toHaveCount(0, { timeout: 3000 });

    // Straight from one app to another: a page turn, and the next chapter's page.
    await open(/Settings/);
    const settings = page.locator('.app-window[data-app="settings"]');
    await expect(settings.locator('.o5-opener')).toContainText('Settings');
    await expect(settings.locator('.o5-opener')).toHaveCount(0, { timeout: 3000 });

    // Reading down the page tucks the header away; the running head takes its place.
    const runhead = settings.locator('.o5-runhead');
    await expect(runhead).toHaveText(/Orbit · \d+ · Settings/i);
    await expect(runhead).toHaveCSS('opacity', '0');
    await settings.hover();
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 260);
      await page.waitForTimeout(80);
    }
    await expect(settings).toHaveAttribute('data-chrome', 'hidden');
    await expect(runhead).toHaveCSS('opacity', '1');
    expect(errors).toEqual([]);
  });

  test('everything is an app: Playground, VS Code and the desktops open on their own page, each with its icon', async ({ page }) => {
    await page.route('**/api/status', (route) =>
      route.fulfill({ json: { machines: [{ id: 'ai', state: 'off', costPerHour: 0.44 }, { id: 'linux', state: 'on', costPerHour: 0.08 }], desktops: ['linux'] } }),
    );
    const { errors } = await openO5(page, /^\d+ Playground /, 'playground');
    const index = async () => {
      await page.getByRole('button', { name: /^Index/ }).click();
      return page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list');
    };
    const pg = page.locator('.app-window[data-app="playground"]');
    await expect(pg.getByRole('heading', { name: 'Playground' })).toBeVisible();
    await expect(pg.locator('svg.app-art[data-app="playground"]')).toBeVisible();
    await expect(pg).toContainText('AI machine');
    await expect(pg).toContainText('Resting');
    await expect(pg.getByRole('link', { name: 'In a new tab' })).toHaveAttribute('href', '/ai');

    // The Index lists every app with its drawing.
    const list = await index();
    for (const id of ['ai', 'soreal', 'editor', 'terminal', 'agent', 'playground', 'vscode', 'desktop', 'windows', 'settings']) {
      await expect(list.locator(`svg.app-art[data-app="${id}"]`)).toHaveCount(1);
    }
    await list.getByRole('button', { name: /^\d+ VS Code / }).click();
    const vs = page.locator('.app-window[data-app="vscode"]');
    await expect(vs.getByRole('heading', { name: 'VS Code' })).toBeVisible();
    await expect(vs).toContainText('On · $0.08/h');
    await expect(vs.getByRole('link', { name: 'In a new tab' })).toHaveAttribute('href', '/code');

    // Windows isn't set up here: it says so, and won't try to open.
    await (await index()).getByRole('button', { name: /^\d+ Windows PC / }).click();
    const win = page.locator('.app-window[data-app="windows"]');
    await expect(win).toContainText('Not set up yet');
    await expect(win.getByRole('button', { name: /Open Windows PC/ })).toBeDisabled();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});
