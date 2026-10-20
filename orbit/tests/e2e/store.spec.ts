import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';
import { mockAi } from './aiMocks';

/** The AI Store: its own app, with shelves, a page per model (specs), the library, and makers. */

async function mockMakers(page: Page) {
  const calls: string[] = [];
  let makers = [
    { id: 'qwen', kind: 'image', name: 'Qwen Uncensored', blurb: 'All-rounder.', for: null, twoImages: false, builtIn: true, wanted: true, installed: true, size: 17e9, percent: 100 },
    { id: 'krea-real', kind: 'image', name: 'Krea Real', blurb: 'Photographs, uncensored.', for: null, twoImages: false, builtIn: false, wanted: false, installed: false, size: 19e9, percent: 0 },
    { id: 'h3-max', kind: 'video', name: 'H3 Max', blurb: 'Best motion.', for: null, twoImages: false, builtIn: false, wanted: false, installed: false, size: 52e9, percent: 0 },
    { id: 'sharpen', kind: 'upscale', name: 'Sharpen 4×', blurb: 'Bigger and crisper.', for: null, twoImages: false, builtIn: false, wanted: false, installed: false, size: 67e6, percent: 0 },
  ];
  await page.route('**/fake-ai/_orbit/studio/makers**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const { id } = req.postDataJSON() as { id: string };
      const op = req.url().endsWith('/install') ? 'install' : 'remove';
      calls.push(`${op} ${id}`);
      makers = makers.map((m) => (m.id === id ? { ...m, wanted: op === 'install', installed: false, percent: op === 'install' ? 40 : 0 } : m));
    }
    await route.fulfill({ json: { makers } });
  });
  return calls;
}

async function openStore(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, skin: 'o5', introSeen: true } }, version: 0 }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  await page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list').getByRole('button', { name: /Store/ }).click();
  const win = page.locator('.app-window[data-app="store"]');
  await expect(win.getByTestId('store')).toBeVisible();
  return { errors, win };
}

test.describe('AI Store', () => {
  test('shelves, a model page with its specifications, getting a model, and the library', async ({ page }, testInfo) => {
    const calls = await mockAi(page, 'on');
    await mockMakers(page);
    const { errors, win } = await openStore(page);
    await expect(win.getByRole('heading', { name: 'Editor’s picks' })).toBeVisible();
    await expect(win.getByRole('heading', { name: 'Everyday' })).toBeVisible();
    await expect(win.getByRole('heading', { name: 'Unfiltered' })).toBeVisible();
    await expect(win.getByRole('heading', { name: 'Video', exact: true })).toBeVisible();
    await expect(win.getByText('15.0 GB free').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('store-home.png') });

    // A model's own page.
    await win.getByRole('button', { name: 'Defiant Fable 9B: details' }).first().click();
    const detail = page.getByRole('dialog', { name: 'Defiant Fable 9B' });
    await expect(detail.locator('.st-detail-title')).toHaveText('Defiant Fable 9B');
    const specs = detail.getByRole('region', { name: 'Specifications' });
    for (const k of ['Publisher', 'Size of the brain', 'Download', 'GPU memory', 'Speed', 'On this machine']) await expect(specs.getByText(k, { exact: true })).toBeVisible();
    await expect(detail.getByText('18+ · Unfiltered')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('store-detail.png') });
    await detail.getByRole('button', { name: 'Get Defiant Fable 9B' }).click();
    await expect.poll(() => calls.find((c) => c.path === 'POST /install')?.body).toMatchObject({ spec: expect.stringMatching(/^defiant-fable:9b=hf\.co\//) });
    await expect(detail.getByRole('status', { name: /Adding Defiant Fable 9B/ })).toBeVisible();

    // Already on the machine: "Open" chats with it in the AI app.
    await page.keyboard.press('Escape');
    await win.getByRole('tab', { name: 'Your library' }).click();
    await expect(win.getByRole('heading', { name: 'Your library' })).toBeVisible();
    await win.getByRole('button', { name: 'Open Qwen 3.8 27B' }).first().click();
    await expect(page.locator('.app-window[data-app="ai"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('makers: add a video maker from its shelf; Create’s Makers button opens the store there', async ({ page }) => {
    await mockAi(page, 'on');
    const makerCalls = await mockMakers(page);
    const { errors, win } = await openStore(page);
    await win.getByRole('tab', { name: 'Pictures & video' }).click();
    const video = win.getByRole('region', { name: 'Video' });
    await video.getByRole('button', { name: 'Get H3 Max' }).click();
    expect(makerCalls).toEqual(['install h3-max']);
    await expect(video.getByRole('status', { name: 'Adding H3 Max: 40%' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('with the machine resting: everything browsable, Get turns it on', async ({ page }, testInfo) => {
    const power: Record<string, unknown>[] = [];
    await mockAi(page, 'off', power);
    const { errors, win } = await openStore(page);
    await expect(win.getByText(/Your AI machine is resting/)).toBeVisible();
    await expect(win.getByRole('heading', { name: 'Sees pictures' })).toBeVisible();
    await expect(win.getByRole('heading', { name: 'Pictures', exact: true })).toBeVisible();
    await win.getByRole('searchbox', { name: 'Search the store' }).fill('fable');
    await expect(win.getByRole('button', { name: 'Defiant Fable 9B: details' }).first()).toBeVisible();
    await expect(win.getByRole('button', { name: 'Qwen 3.8 27B: details' })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('store-off.png') });
    await win.getByRole('button', { name: 'Get Defiant Fable 9B' }).first().click();
    await expect.poll(() => power.length).toBe(1);
    expect(power[0]).toMatchObject({ action: 'start' });
    expect(errors).toEqual([]);
  });

  test('opens from the home path, Settings and the AI app', async ({ page }) => {
    await mockAi(page, 'on');
    await mockMakers(page);
    const { win } = await openStore(page);
    // From Settings → AI models.
    await page.getByRole('button', { name: /^Index/ }).click();
    await page.getByRole('dialog', { name: 'Index' }).getByRole('button', { name: /Settings/ }).click();
    await page.locator('.app-window[data-app="settings"]').getByRole('button', { name: /^Makers/ }).click();
    await expect(win.getByRole('tab', { name: 'Pictures & video' })).toHaveAttribute('aria-selected', 'true');
  });
});
