import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

// The page comes from the site's own file (lib/liteMake.ts, outside Orbit's package): compiled here.
const source = readFileSync(fileURLToPath(new URL('../../../lib/liteMake.ts', import.meta.url)), 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'cjs' }).code;
const mod = { exports: {} as { liteMakePage?: () => string } };
new Function('module', 'exports', compiled)(mod, mod.exports);
const liteMakePage = mod.exports.liteMakePage!;

/**
 * The fast Make page (/lite): plain HTML, no Orbit. Served here from a stand-in site and AI machine
 * (every answer below is made up), on iPhone and iPad.
 */
const SITE = 'https://site.test';
const MACHINE = 'https://machine.test';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function standIns(page: Page, opts: { on?: boolean } = {}) {
  const calls: { path: string; body?: unknown }[] = [];
  let state = opts.on ? 'on' : 'off';
  let loaded = ['h3-max', 'qwen'];
  const line: string[] = [];
  const makers = () =>
    [
      { id: 'qwen', kind: 'image', name: 'Qwen Uncensored' },
      { id: 'anime', kind: 'image', name: 'Anime' },
      { id: 'h3-max', kind: 'video', name: 'H3 Max' },
      { id: 'ltx', kind: 'video', name: 'LTX 10Eros' },
    ].map((m) =>
      loaded.includes(m.id)
        ? { ...m, installed: true, wanted: true, percent: 100 }
        : line.includes(m.id)
          ? { ...m, installed: false, wanted: true, percent: 0, line: line.indexOf(m.id) + 1 }
          : { ...m, installed: false, wanted: false, percent: 0, loadable: true },
    );
  let job = { id: 'j1', status: 'queued', progress: 0, position: 1, etaSeconds: 120, item: null as null | Record<string, string> };
  let jobs = 0;
  await page.route(`${SITE}/**`, async (route) => {
    const url = new URL(route.request().url());
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
    calls.push({ path: url.pathname, body });
    if (url.pathname === '/lite') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: liteMakePage() });
    if (url.pathname === '/api/ai' && route.request().method() === 'POST') {
      if ((body as { action: string }).action === 'start') state = 'on';
      if ((body as { action: string }).action === 'stop') state = 'off';
    }
    if (url.pathname === '/api/ai') return route.fulfill({ json: { state, costPerHour: state === 'on' ? 0.45 : 0, pickGpu: true } });
    if (url.pathname === '/api/ai/gpus')
      return route.fulfill({
        json: {
          recommended: 'a40',
          options: [
            { gpu: 'rtx_a6000', name: 'RTX A6000', memoryGb: 48, pricePerHour: 0.45, note: 'Everything: pictures and H3 Max videos', fits: 'yes' },
            { gpu: 'a40', name: 'A40', memoryGb: 48, pricePerHour: 0.61, note: 'Everything: pictures and H3 Max videos', fits: 'yes' },
          ],
        },
      });
    if (url.pathname === '/api/ai/token') return route.fulfill({ json: state === 'on' ? { url: MACHINE, token: 'tok', expiresIn: 3600 } : { url: null, token: null, expiresIn: 3600 } });
    if (url.pathname === '/api/orb/ai') {
      const b = body as { task: string; messages: { role: string; content: string }[] };
      const sys = b.messages[0].content;
      const content = sys.includes('You are Eros')
        ? 'Here you go: ' +
          JSON.stringify({
            title: 'Blackout',
            characters: 'Mara, 34, tall, black bob; Theo, 38, broad, grey stubble',
            scenes: [1, 2, 3].map((n) => ({ story: `Scene ${n} of the lift.`, prompt: `scene ${n} prompt: Mara and Theo in a dark lift` })),
          })
        : 'A tall woman in her thirties in a red slip dress, neon rain behind her, slow push-in.';
      return route.fulfill({ json: { choices: [{ message: { content } }] } });
    }
    return route.fulfill({ status: 404, json: { error: 'not here' } });
  });
  await page.route(`${MACHINE}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const body = req.method() === 'POST' ? req.postDataJSON() : undefined;
    calls.push({ path: `machine:${url.pathname}`, body });
    if (url.pathname === '/_orbit/studio/makers') return route.fulfill({ headers: cors, json: { makers: makers() } });
    if (url.pathname === '/_orbit/studio/makers/load') {
      line.push((body as { id: string }).id);
      return route.fulfill({ headers: cors, json: { makers: makers() } });
    }
    if (url.pathname === '/_orbit/studio/jobs') {
      jobs += 1;
      return route.fulfill({ headers: cors, json: { ...job, id: `j${jobs}` } });
    }
    if (url.pathname.startsWith('/_orbit/studio/jobs/')) {
      job = { ...job, status: 'done', progress: 100, position: 0, item: { id: 'v1', kind: 'video', url: '/_orbit/studio/file/v1?t=x' } };
      return route.fulfill({ headers: cors, json: job });
    }
    if (url.pathname.startsWith('/_orbit/studio/file/')) return route.fulfill({ headers: cors, contentType: 'image/png', body: PNG });
    return route.fulfill({ status: 404, headers: cors, json: { error: 'not here' } });
  });
  return { calls, loaded: (ids: string[]) => (loaded = ids) };
}

async function noSideScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
}

test('fast Make: turn on with a GPU picked, a video maker put in line, words written, an Eros story, made', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { calls } = await standIns(page);
  await page.goto(`${SITE}/lite`);
  // One plain page: no Orbit, no orb, nothing else to load.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What will it be?');
  await expect(page.locator('script[src]')).toHaveCount(0);
  await expect(page.getByLabel('AI machine')).toContainText('off');

  // Turn on: every GPU first, the suggested one picked; another can be.
  await page.getByRole('button', { name: 'Turn on' }).click();
  const sheet = page.getByRole('dialog', { name: 'Pick a GPU' });
  await expect(sheet.getByRole('button', { name: /A40/ })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: /RTX A6000/ }).click();
  await sheet.getByRole('button', { name: 'Turn on' }).click();
  await expect.poll(() => calls.find((c) => c.path === '/api/ai' && c.body)?.body).toEqual({ action: 'start', gpu: 'rtx_a6000' });
  await expect(page.getByLabel('AI machine')).toContainText('on');

  // 1: a video. 2: every video maker; one not loaded joins the line.
  await page.getByRole('radio', { name: /A video/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Who makes it');
  const menu = page.getByRole('radiogroup', { name: 'Maker' });
  await expect(menu.getByRole('radio')).toHaveCount(2);
  await expect(menu.getByRole('radio', { name: /LTX 10Eros/ })).toContainText('tap to load');
  await menu.getByRole('radio', { name: /LTX 10Eros/ }).click();
  await expect.poll(() => calls.find((c) => c.path === 'machine:/_orbit/studio/makers/load')?.body).toEqual({ id: 'ltx', first: false });
  await menu.getByRole('radio', { name: /H3 Max/ }).click();

  // 3: Do it for me writes the words with the unfiltered NVIDIA writer.
  await page.getByRole('button', { name: 'Describe it →' }).click();
  await page.getByRole('button', { name: 'Do it for me' }).click();
  await expect(page.getByRole('textbox', { name: 'Describe it' })).toHaveValue(/red slip dress/);
  const asked = calls.find((c) => c.path === '/api/orb/ai')!.body as { task: string; messages: { content: string }[] };
  expect(asked.task).toBe('free');
  expect(asked.messages[0].content).toMatch(/fictional adult, clearly over 18\. Never a real, famous/);

  // Eros: an idea, how hot, how many scenes; each scene's prompt can be used.
  await page.getByRole('button', { name: 'Eros story writer' }).click();
  await page.getByLabel('The idea').fill('Two strangers stuck in a lift during a blackout');
  await page.getByRole('group', { name: 'How hot' }).getByRole('button', { name: 'Explicit' }).click();
  await page.getByRole('group', { name: 'Scenes' }).getByRole('button', { name: '3' }).click();
  await page.getByRole('button', { name: 'Write the story' }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'Blackout' })).toBeVisible();
  await expect(page.locator('.scene')).toHaveCount(3);
  const eros = calls.filter((c) => c.path === '/api/orb/ai').at(-1)!.body as { messages: { content: string }[] };
  expect(eros.messages[0].content).toMatch(/You are Eros.*fully explicit.*exactly 3 scenes/);
  await page.screenshot({ path: info.outputPath('lite-eros.png') });
  await page.locator('.scene').nth(1).getByRole('button', { name: 'Use this prompt' }).click();
  await expect(page.getByRole('textbox', { name: 'Describe it' })).toHaveValue('scene 2 prompt: Mara and Theo in a dark lift');

  // 4: 10 seconds. 5: made, and shown.
  await page.getByRole('button', { name: 'Extras →' }).click();
  await page.getByRole('group', { name: 'Length' }).getByRole('button', { name: '10 seconds' }).click();
  await page.getByRole('button', { name: 'Make it →' }).click();
  await page.locator('.pane').getByRole('button', { name: 'Make it', exact: true }).click();
  await expect
    .poll(() => calls.find((c) => c.path === 'machine:/_orbit/studio/jobs')?.body)
    .toEqual({ kind: 'video', maker: 'h3-max', prompt: 'scene 2 prompt: Mara and Theo in a dark lift', size: 'portrait', seconds: 10 });
  await expect(page.locator('.out video')).toHaveAttribute('src', `${MACHINE}/_orbit/studio/file/v1?t=x`, { timeout: 10_000 });
  await noSideScroll(page);
  await page.screenshot({ path: info.outputPath('lite-made.png') });
  expect(errors).toEqual([]);
});

test('fast Make: every Eros scene goes in the queue at once', async ({ page }) => {
  const { calls } = await standIns(page, { on: true });
  await page.goto(`${SITE}/lite`);
  await page.getByRole('radio', { name: /A picture/ }).click();
  await page.getByRole('button', { name: 'Describe it →' }).click();
  await page.getByRole('button', { name: 'Eros story writer' }).click();
  await page.getByRole('button', { name: 'Write the story' }).click();
  await expect(page.locator('.scene')).toHaveCount(3);
  await page.getByRole('button', { name: 'Make all 3 scenes' }).click();
  await expect(page.getByText('3 of 3 scenes are in the queue')).toBeVisible();
  const sent = calls.filter((c) => c.path === 'machine:/_orbit/studio/jobs').map((c) => (c.body as { prompt: string; kind: string }).prompt);
  expect(sent).toEqual(['scene 1 prompt: Mara and Theo in a dark lift', 'scene 2 prompt: Mara and Theo in a dark lift', 'scene 3 prompt: Mara and Theo in a dark lift']);
  await noSideScroll(page);
});
