import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, openOrbit } from './helpers';
import { mockAi, openMakeApp } from './aiMocks';

/**
 * The serverless AI machine: with the AI machine off, Make still makes pictures and videos with your
 * own makers on a pay-per-second GPU (the site's /api/make/serverless), says what it costs, follows
 * the job, and tells you it is in your Gallery when done. Uploads and makers the serverless machine
 * doesn't have still need the AI machine.
 */

async function mockServerless(page: Page, { ready = true, wanted = ['krea-real'] as string[] } = {}) {
  const started: Record<string, unknown>[] = [];
  let polls = 0;
  await page.route('**/api/make/serverless**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'POST') {
      started.push((route.request().postDataJSON() as { job: Record<string, unknown> }).job);
      return route.fulfill({ json: { id: 'rp-job-1', status: 'queued', progress: 0, detail: 'Waiting for a GPU' } });
    }
    if (method === 'DELETE') return route.fulfill({ json: { ok: true } });
    if (url.searchParams.get('id')) {
      polls++;
      if (polls === 1) return route.fulfill({ json: { id: 'rp-job-1', status: 'running', progress: 0, detail: 'Starting the maker (starting)', notes: [] } });
      if (polls === 2) return route.fulfill({ json: { id: 'rp-job-1', status: 'running', progress: 55, etaSeconds: 20, notes: [] } });
      return route.fulfill({ json: { id: 'rp-job-1', status: 'done', progress: 100, job: { id: 'g1', status: 'done', prompt: 'a red fox in snow', item: { id: 'it1', kind: 'image', url: '/x' } }, ranSeconds: 48 } });
    }
    return route.fulfill({ json: { configured: true, ready, pricePerHour: { from: 1.22, to: 1.75 }, wanted } });
  });
  return { started, polls: () => polls };
}

const nav = (win: ReturnType<Page['locator']>) => win.getByRole('navigation', { name: 'Make, step by step' });

test('with the AI machine off, Make makes it on a pay-per-second GPU, says the price, follows it, and it lands in the Gallery', async ({ page }) => {
  await mockAi(page, 'off');
  const sl = await mockServerless(page);
  const errors = await openOrbit(page);
  const win = await openMakeApp(page);
  await win.getByRole('radiogroup', { name: 'What to make' }).getByRole('radio', { name: /^A picture/ }).click();
  // The built-in maker is always on the serverless machine.
  await win.getByRole('radiogroup', { name: 'Maker' }).getByRole('radio', { name: /^Qwen/ }).click();
  await expect(win.locator('.mk-pane')).toHaveCount(1);
  await win.getByRole('textbox', { name: 'Describe it' }).fill('a red fox in snow');
  await nav(win).getByRole('button', { name: /^Step 5 of/ }).click();
  const status = win.getByRole('status').filter({ hasText: /pay-per-second GPU/ });
  await expect(status).toContainText('about $0.02–0.03 a minute of GPU time, only while it works');
  const make = win.getByRole('button', { name: 'Make image' });
  await expect(make).toBeEnabled();
  await make.click();
  await expect.poll(() => sl.started.length).toBe(1);
  expect(sl.started[0]).toMatchObject({ kind: 'image', maker: 'qwen', prompt: 'a red fox in snow' });
  const list = win.getByRole('list', { name: 'In progress' });
  await expect(list).toContainText('a red fox in snow');
  await expect(list).toContainText('Made on a pay-per-second GPU');
  await expect(list).toContainText('Starting the maker');
  await expect(page.getByText('Done. It is in your Gallery.')).toBeVisible({ timeout: 15_000 });
  await expect(list).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('a maker not on the serverless machine, and an uploaded video, still need the AI machine', async ({ page }) => {
  await mockAi(page, 'off');
  await mockServerless(page, { wanted: [] });
  await openOrbit(page);
  // With the machine off, Make lists the makers it last saw on it: Krea Real was installed there once.
  await page.evaluate(() =>
    localStorage.setItem(
      'orbit:studio:makers',
      JSON.stringify([
        { id: 'qwen', kind: 'image', name: 'Qwen Uncensored', blurb: 'All-rounder.', for: null, builtIn: true, wanted: true, installed: true, percent: 100 },
        { id: 'krea-real', kind: 'image', name: 'Krea Real', blurb: 'Photoreal.', for: null, builtIn: false, wanted: true, installed: true, percent: 100 },
      ]),
    ),
  );
  const win = await openMakeApp(page);
  await win.getByRole('radiogroup', { name: 'What to make' }).getByRole('radio', { name: /^A picture/ }).click();
  // Krea Real is not among the makers added on the AI machine as the site knows them (`wanted` from storage): no serverless for it.
  await win.getByRole('radiogroup', { name: 'Maker' }).getByRole('radio', { name: /^Krea Real/ }).click();
  await expect(win.locator('.mk-pane')).toHaveCount(1);
  await win.getByRole('textbox', { name: 'Describe it' }).fill('a lighthouse');
  await nav(win).getByRole('button', { name: /^Step 5 of/ }).click();
  await expect(win.getByRole('status').filter({ hasText: /AI machine/ })).toContainText('This maker needs your AI machine on');
  await expect(win.getByRole('button', { name: 'Make image' })).toBeDisabled();
});

test('with no serverless machine set up, Make still asks for the AI machine', async ({ page }) => {
  await mockAi(page, 'off');
  await page.route('**/api/make/serverless**', (route) => route.fulfill({ json: { configured: false, ready: false, pricePerHour: { from: 1.22, to: 1.75 }, wanted: [] } }));
  await openOrbit(page);
  const win = await openMakeApp(page);
  await win.getByRole('radiogroup', { name: 'What to make' }).getByRole('radio', { name: /^A picture/ }).click();
  await win.getByRole('radiogroup', { name: 'Maker' }).getByRole('radio', { name: /^Qwen/ }).click();
  await win.getByRole('textbox', { name: 'Describe it' }).fill('a red fox');
  await nav(win).getByRole('button', { name: /^Step 5 of/ }).click();
  await expect(win.getByRole('status').filter({ hasText: /AI machine/ })).toContainText('Turn on your AI machine to make images and videos.');
  await expect(win.getByRole('button', { name: 'Make image' })).toBeDisabled();
});
