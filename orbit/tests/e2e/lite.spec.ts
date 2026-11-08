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

async function standIns(page: Page, opts: { on?: boolean; both?: boolean } = {}) {
  const calls: { path: string; body?: unknown }[] = [];
  let state = opts.on ? 'on' : 'off';
  let loaded = ['h3-max', 'qwen', 'edit', 'trellis2', 'style-ink', 's2v', 'vace', 'person-swap', 'rig'];
  let cloud = { id: 'c1', status: 'queued', kind: 'image', provider: 'cloudflare', position: 1 } as Record<string, unknown>;
  const line: string[] = [];
  const makers = () =>
    [
      { id: 'qwen', kind: 'image', name: 'Qwen Uncensored' },
      { id: 'anime', kind: 'image', name: 'Anime' },
      { id: 'h3-max', kind: 'video', name: 'H3 Max' },
      { id: 'ltx', kind: 'video', name: 'LTX 10Eros' },
      { id: 'edit', kind: 'edit', name: 'Edit with words' },
      { id: 'trellis2', kind: 'model3d', name: '3D object' },
      { id: 'style-ink', kind: 'style', name: 'Ink', for: 'qwen' },
      { id: 's2v', kind: 'video', name: 'Talking photo', needs: ['photo', 'audio'] },
      { id: 'vace', kind: 'videoedit', name: 'Edit a video', needs: ['video'], tasks: ['replace', 'restyle', 'extend', 'motion'] },
      { id: 'person-swap', kind: 'videoedit', name: 'Swap a person', needs: ['video', 'target', 'photo'] },
      { id: 'rig', kind: 'rig', name: 'Rig it', needs: ['model3d'] },
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
          ...(opts.both
            ? {
                default: 'gpuai',
                providers: [
                  { id: 'gpuai', label: 'GPU.ai', blurb: 'Pick any GPU. Pictures, videos and 3D with your makers (no chat).', fromPrice: 0.45 },
                  {
                    id: 'runpod',
                    label: 'Runpod',
                    blurb: 'Standard or Turbo. Your chat models and your makers.',
                    fromPrice: 0.59,
                    tiers: [
                      { id: 'standard', label: 'Standard', gpuName: 'A40 / A6000 48 GB', pricePerHour: 0.59, speed: 'normal speed' },
                      { id: 'turbo', label: 'Turbo', gpuName: 'H100 80 GB', pricePerHour: 2.89, speed: 'about 3–4× faster' },
                    ],
                  },
                ],
              }
            : {}),
          options: [
            { gpu: 'rtx_a6000', name: 'RTX A6000', memoryGb: 48, pricePerHour: 0.45, note: 'Everything: pictures and H3 Max videos', fits: 'yes' },
            { gpu: 'a40', name: 'A40', memoryGb: 48, pricePerHour: 0.61, note: 'Everything: pictures and H3 Max videos', fits: 'yes' },
          ],
        },
      });
    if (url.pathname === '/api/ai/token') return route.fulfill({ json: state === 'on' ? { url: MACHINE, token: 'tok', expiresIn: 3600 } : { url: null, token: null, expiresIn: 3600 } });
    if (url.pathname === '/api/orb/ai' && route.request().method() === 'GET')
      return route.fulfill({
        json: {
          configured: true,
          byProvider: [
            { id: 'nvidia', name: 'NVIDIA', models: { free: ['nv-mistralai/mistral-nemo-12b-instruct', 'mistralai/mistral-large-2-instruct', 'mistralai/mistral-7b-instruct-v0.3'] } },
            { id: 'groq', name: 'Groq', models: { free: ['llama-3.3-70b-versatile'] } },
          ],
        },
      });
    if (url.pathname === '/api/orb/ai') {
      const b = body as { task: string; messages: { role: string; content: string }[] };
      const sys = b.messages[0].content;
      const many = /You write (\d+) different prompts/.exec(sys);
      if (many) return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ prompts: Array.from({ length: Number(many[1]) }, (_, i) => `take ${i + 1}: a dancer in neon rain`) }) } }] } });
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
    if (url.pathname === '/api/make' && route.request().method() === 'POST') return route.fulfill({ json: cloud });
    if (url.pathname === '/api/make' && url.searchParams.get('id')) {
      cloud = { ...cloud, status: 'done', url: 'https://cdn.test/cloud.png', position: null };
      return route.fulfill({ json: cloud });
    }
    if (url.pathname === '/api/make') return route.fulfill({ json: { configured: true, image: [{ id: 'cloudflare', name: 'Cloudflare', price: 'about 1¢ a picture' }], video: [{ id: 'gpuai', name: 'H3 in the cloud', price: '5¢ a second' }] } });
    if (url.pathname === '/api/gallery' && route.request().method() === 'POST') return route.fulfill({ json: { ok: true, id: 'g9' } });
    if (url.pathname === '/api/gallery') return route.fulfill({ json: { configured: true, items: [{ id: 'st1', kind: 'image', prompt: 'a kept sunset', url: 'https://cdn.test/sunset.png' }] } });
    if (url.pathname.startsWith('/cdn')) return route.fulfill({ contentType: 'image/png', body: PNG });
    return route.fulfill({ status: 404, json: { error: 'not here' } });
  });
  await page.route('https://cdn.test/**', (route) => route.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route(`${MACHINE}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    if (url.pathname === '/_orbit/studio/uploads') {
      calls.push({ path: 'machine:/_orbit/studio/uploads', body: req.headers()['content-type'] });
      const kind = (req.headers()['content-type'] || '').startsWith('audio') ? 'audio' : 'video';
      return route.fulfill({ headers: cors, json: { id: kind === 'audio' ? 'aud1' : 'vid1', kind, size: 4 } });
    }
    const body = req.method() === 'POST' ? req.postDataJSON() : undefined;
    calls.push({ path: `machine:${url.pathname}`, body });
    if (url.pathname === '/_orbit/studio/characters') return route.fulfill({ headers: cors, json: { characters: [{ id: 'ch1', name: 'Mara', status: 'ready' }, { id: 'ch2', name: 'Draft', status: 'draft' }] } });
    if (url.pathname === '/_orbit/studio/makers') return route.fulfill({ headers: cors, json: { makers: makers() } });
    if (url.pathname === '/_orbit/studio/makers/load') {
      line.push((body as { id: string }).id);
      return route.fulfill({ headers: cors, json: { makers: makers() } });
    }
    if (url.pathname === '/_orbit/studio/jobs') {
      jobs += 1;
      return route.fulfill({ headers: cors, json: { ...job, id: `j${jobs}` } });
    }
    if (url.pathname === '/_orbit/studio/items')
      return route.fulfill({
        headers: cors,
        json: {
          items: [
            { id: 'pic9', kind: 'image', prompt: 'a red fox', url: '/_orbit/studio/file/pic9?t=x' },
            { id: 'vid9', kind: 'video', prompt: 'a dancer on a roof', url: '/_orbit/studio/file/vid9?t=x', thumbUrl: '/_orbit/studio/file/pic9?t=x' },
            { id: 'obj9', kind: 'model3d', prompt: 'a tiger figurine', url: '/_orbit/studio/file/obj9?t=x', thumbUrl: '/_orbit/studio/file/pic9?t=x' },
          ],
        },
      });
    if (url.pathname.endsWith('/cancel')) return route.fulfill({ headers: cors, json: { ok: true } });
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
  await expect(menu.getByRole('radio')).toHaveCount(3);
  await expect(menu.getByRole('radio', { name: /LTX 10Eros/ })).toContainText('tap to load');
  await menu.getByRole('radio', { name: /LTX 10Eros/ }).click();
  await expect.poll(() => calls.find((c) => c.path === 'machine:/_orbit/studio/makers/load')?.body).toEqual({ id: 'ltx', first: false });
  await menu.getByRole('radio', { name: /H3 Max/ }).click();

  // 3: Do it for me writes the words with the unfiltered NVIDIA writer you pick (Automatic until then).
  await page.getByRole('button', { name: 'Describe it →' }).click();
  const writer = page.getByLabel('Writer (NVIDIA, unfiltered)');
  await expect(writer).toHaveValue('');
  // NVIDIA's own writers only, and Automatic.
  await expect(writer.locator('option')).toHaveText(['Automatic · the best one answering', 'Mistral NeMo 12B · quick, loose', 'Mistral Large 2 · best writing, slower', 'Mistral 7B · quickest, simplest']);
  await writer.selectOption('mistralai/mistral-large-2-instruct');
  await page.screenshot({ path: info.outputPath('lite-writer.png') });
  await page.getByRole('button', { name: 'Do it for me' }).click();
  await expect(page.getByRole('textbox', { name: 'Describe it' })).toHaveValue(/red slip dress/);
  const asked = calls.find((c) => c.path === '/api/orb/ai' && c.body)!.body as { task: string; messages: { content: string }[] };
  expect(asked.task).toBe('free');
  expect(asked).toMatchObject({ model: 'mistralai/mistral-large-2-instruct', prefer: 'nvidia' });
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
  expect(eros).toMatchObject({ model: 'mistralai/mistral-large-2-instruct' });
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

test('fast Make: an edit from your own photo, a 3D object from a gallery picture, a style, and a job stopped', async ({ page }) => {
  const { calls } = await standIns(page, { on: true });
  await page.goto(`${SITE}/lite`);
  await expect(page.getByRole('radiogroup', { name: 'What to make' }).getByRole('radio')).toHaveCount(5);

  // An edit: your own photo (shrunk on the phone), then words.
  await page.getByRole('radio', { name: /An edit/ }).click();
  await expect(page.getByRole('radiogroup', { name: 'Maker' }).getByRole('radio', { name: /Edit with words/ })).toBeVisible();
  await page.getByRole('button', { name: 'Describe it →' }).click();
  await page.locator('#photo').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('img', { name: 'Your photo 1' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Describe it' }).fill('make it night');
  await page.getByRole('button', { name: 'Extras →' }).click();
  await expect(page.getByText('Nothing to set for an edit')).toBeVisible();
  await page.getByRole('button', { name: 'Make it →' }).click();
  await page.locator('.pane').getByRole('button', { name: 'Make it', exact: true }).click();
  await expect.poll(() => calls.find((c) => c.path === 'machine:/_orbit/studio/jobs')?.body).toMatchObject({ kind: 'image', maker: 'edit', prompt: 'make it night' });
  const sent = calls.find((c) => c.path === 'machine:/_orbit/studio/jobs')!.body as { images: string[] };
  expect(sent.images[0]).toMatch(/^data:image\/jpeg;base64,/);
  // It can be stopped while it waits.
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Stopped.')).toBeVisible();

  // A 3D object: a picture from the gallery, no words.
  await page.getByRole('button', { name: 'Step 1 of 5: What' }).click();
  await page.getByRole('radio', { name: /A 3D object/ }).click();
  await page.getByRole('button', { name: 'Describe it →' }).click();
  await expect(page.getByRole('textbox', { name: 'Describe it' })).toHaveCount(0);
  await page.getByRole('button', { name: 'From your gallery' }).click();
  await page.getByRole('button', { name: 'a red fox' }).click();
  await page.getByRole('button', { name: 'Use as my photo' }).click();
  await expect(page.getByRole('img', { name: 'Your photo 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Extras →' }).click();
  await page.getByRole('button', { name: 'Make it →' }).click();
  await page.locator('.pane').getByRole('button', { name: 'Make it', exact: true }).click();
  await expect
    .poll(() => calls.filter((c) => c.path === 'machine:/_orbit/studio/jobs').at(-1)?.body)
    .toMatchObject({ kind: 'model3d', maker: 'trellis2', prompt: '', fromItem: 'pic9' });
  await noSideScroll(page);
});

test('fast Make: a style for a picture is sent with it', async ({ page }) => {
  const { calls } = await standIns(page, { on: true });
  await page.goto(`${SITE}/lite`);
  await page.getByRole('radio', { name: /A picture/ }).click();
  await page.getByRole('button', { name: 'Describe it →' }).click();
  await page.getByRole('textbox', { name: 'Describe it' }).fill('a fox');
  await page.getByRole('button', { name: 'Extras →' }).click();
  await page.getByRole('group', { name: 'Style' }).getByRole('button', { name: 'Ink' }).click();
  await page.getByRole('button', { name: 'Make it →' }).click();
  await page.locator('.pane').getByRole('button', { name: 'Make it', exact: true }).click();
  await expect.poll(() => calls.find((c) => c.path === 'machine:/_orbit/studio/jobs')?.body).toMatchObject({ kind: 'image', maker: 'qwen', style: 'style-ink' });
});

const PNG_FILE = { name: 'me.png', mimeType: 'image/png', buffer: PNG };
const jobsSent = (calls: { path: string; body?: unknown }[]) => calls.filter((c) => c.path === 'machine:/_orbit/studio/jobs').map((c) => c.body as Record<string, unknown>);
async function toMake(page: Page) {
  await page.getByRole('button', { name: 'Extras →' }).click();
  await page.getByRole('button', { name: 'Make it →' }).click();
  await page.locator('.pane').getByRole('button', { name: 'Make it', exact: true }).click();
}

test('fast Make: work on a video (your own, restyled), then swap a person in a gallery video for a saved character', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { calls } = await standIns(page, { on: true });
  await page.goto(`${SITE}/lite`);
  await page.getByRole('radio', { name: /Work on a video/ }).click();
  const menu = page.getByRole('radiogroup', { name: 'Maker' });
  await expect(menu.getByRole('radio')).toHaveCount(2);
  await menu.getByRole('radio', { name: /Edit a video/ }).click();
  await page.getByRole('button', { name: 'Describe it →' }).click();
  // Your own video goes to the machine first.
  await page.locator('#vid').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fake') });
  await expect(page.getByText('clip.mp4')).toBeVisible();
  expect(calls.find((c) => c.path === 'machine:/_orbit/studio/uploads')?.body).toBe('video/mp4');
  await page.getByRole('group', { name: 'What to do' }).getByRole('button', { name: 'Restyle it' }).click();
  await page.getByRole('textbox', { name: 'Describe it' }).fill('make it a watercolour');
  await page.screenshot({ path: info.outputPath('lite-vedit.png') });
  await toMake(page);
  await expect.poll(() => jobsSent(calls)[0]).toEqual({ kind: 'video', maker: 'vace', prompt: 'make it a watercolour', videoUpload: 'vid1', task: 'restyle' });

  // Swap a person: a gallery video, who to replace, and a saved character instead of a photo.
  await page.getByRole('button', { name: 'Gallery' }).first().click();
  await page.getByRole('button', { name: 'a dancer on a roof' }).click();
  await page.getByRole('button', { name: 'Work on this video' }).click();
  await page.getByRole('radiogroup', { name: 'Maker' }).getByRole('radio', { name: /Swap a person/ }).click();
  await page.getByRole('button', { name: 'Describe it →' }).click();
  await expect(page.getByText('a dancer on a roof')).toBeVisible();
  await page.getByLabel('Who to replace').fill('the woman in the red coat');
  await page.getByRole('button', { name: 'Extras →' }).click();
  const chars = page.getByRole('group', { name: 'Character' });
  await expect(chars.getByRole('button')).toHaveText(['No character', 'Mara']);
  await chars.getByRole('button', { name: 'Mara' }).click();
  await page.getByRole('button', { name: 'Make it →' }).click();
  await page.locator('.pane').getByRole('button', { name: 'Make it', exact: true }).click();
  await expect.poll(() => jobsSent(calls)[1]).toEqual({ kind: 'video', maker: 'person-swap', prompt: '', character: 'ch1', videoItem: 'vid9', target: 'the woman in the red coat' });
  await noSideScroll(page);
  expect(errors).toEqual([]);
});

test('fast Make: a talking photo, and a video from a start and an end picture', async ({ page }) => {
  const { calls } = await standIns(page, { on: true });
  await page.goto(`${SITE}/lite`);
  await page.getByRole('radio', { name: /A video/ }).click();
  await page.getByRole('radiogroup', { name: 'Maker' }).getByRole('radio', { name: /Talking photo/ }).click();
  await page.getByRole('button', { name: 'Describe it →' }).click();
  await page.locator('#photo').setInputFiles(PNG_FILE);
  // As a person would: the photo is in before the recording is picked.
  await expect(page.getByRole('img', { name: 'Your photo 1' })).toBeVisible();
  await page.locator('#aud').setInputFiles({ name: 'song.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('fake') });
  await expect(page.getByText('song.mp3')).toBeVisible();
  // No end picture for a talking photo.
  await expect(page.getByText('End on a picture')).toHaveCount(0);
  await toMake(page);
  await expect.poll(() => jobsSent(calls)[0]).toMatchObject({ kind: 'video', maker: 's2v', audioUpload: 'aud1' });
  expect(String(jobsSent(calls)[0].image)).toMatch(/^data:image\/jpeg;base64,/);

  // H3 Max: start from your photo, end on a gallery picture.
  await page.getByRole('button', { name: 'Step 2 of 5: Maker' }).click();
  await page.getByRole('radiogroup', { name: 'Maker' }).getByRole('radio', { name: /H3 Max/ }).click();
  await page.getByRole('button', { name: 'Describe it →' }).click();
  await page.locator('.pane').getByRole('button', { name: 'From your gallery' }).last().click();
  await page.getByRole('button', { name: 'a red fox' }).click();
  await page.getByRole('button', { name: 'End on this picture' }).click();
  await expect(page.getByRole('img', { name: 'End picture' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Describe it' }).fill('she turns and walks into the sea');
  await toMake(page);
  await expect.poll(() => jobsSent(calls)[1]).toMatchObject({ kind: 'video', maker: 'h3-max', prompt: 'she turns and walks into the sea', toItem: 'pic9' });
  expect(String(jobsSent(calls)[1].image)).toMatch(/^data:image\/jpeg/);
  await noSideScroll(page);
});

test('fast Make: Batch writes many takes and puts them all in line', async ({ page }) => {
  const { calls } = await standIns(page, { on: true });
  await page.goto(`${SITE}/lite`);
  await page.getByRole('radio', { name: /A picture/ }).click();
  await page.getByRole('button', { name: 'Describe it →' }).click();
  await page.getByRole('textbox', { name: 'Describe it' }).fill('a dancer in neon rain');
  await page.getByRole('button', { name: 'Batch' }).click();
  await page.getByRole('group', { name: 'How many' }).getByRole('button', { name: '4' }).click();
  await page.getByRole('button', { name: 'Write 4 prompts' }).click();
  await expect(page.locator('.scene')).toHaveCount(4);
  await page.getByRole('button', { name: 'Make all 4' }).click();
  await expect.poll(() => jobsSent(calls).length).toBe(4);
  expect(jobsSent(calls).map((b) => b.prompt)).toEqual([1, 2, 3, 4].map((n) => `take ${n}: a dancer in neon rain`));
  const asked = calls.find((c) => c.path === '/api/orb/ai' && c.body)!.body as { task: string; messages: { content: string }[] };
  expect(asked.task).toBe('free');
  expect(asked.messages[0].content).toMatch(/fictional adult/);
});

test('fast Make: only your own makers: with the machine off nothing goes to a cloud maker, and the gallery still opens', async ({ page }) => {
  const { calls } = await standIns(page);
  await page.goto(`${SITE}/lite`);
  await page.getByRole('radio', { name: /A picture/ }).click();
  await page.getByRole('button', { name: 'Describe it →' }).click();
  await page.getByRole('textbox', { name: 'Describe it' }).fill('a fox at dawn');
  await page.getByRole('button', { name: 'Extras →' }).click();
  await page.getByRole('button', { name: 'Make it →' }).click();
  await expect(page.getByRole('button', { name: /cloud/i })).toHaveCount(0);
  await page.locator('.pane').getByRole('button', { name: 'Make it', exact: true }).click();
  await expect(page.getByText('Turn the AI machine on first')).toBeVisible();
  expect(calls.some((c) => c.path === '/api/make')).toBe(false);
  // The gallery from cloud storage, with the machine off.
  await page.getByRole('button', { name: 'Gallery' }).click();
  await page.getByRole('button', { name: 'a kept sunset' }).click();
  await expect(page.getByText('Turn the AI machine on to work on this one.')).toBeVisible();
  await noSideScroll(page);
});

test('fast Make: Rig it from a 3D object in the gallery', async ({ page }) => {
  const { calls } = await standIns(page, { on: true });
  await page.goto(`${SITE}/lite`);
  await expect(page.getByLabel('AI machine')).toContainText('on');
  await page.getByRole('button', { name: 'Gallery' }).click();
  await page.getByRole('button', { name: 'a tiger figurine' }).click();
  await page.getByRole('button', { name: 'Rig it' }).click();
  await expect.poll(() => jobsSent(calls)[0]).toEqual({ kind: 'model3d', maker: 'rig', prompt: '', fromItem: 'obj9' });
  await expect(page.getByText('Rigging it')).toBeVisible();
});

test('fast Make with Runpod and GPU.ai both set up: Turn on asks where first, then the speed; the choice is sent', async ({ page }, info) => {
  const { calls } = await standIns(page, { both: true });
  await page.goto(`${SITE}/lite`);
  await page.getByRole('button', { name: 'Turn on' }).click();
  const where = page.getByRole('dialog', { name: 'Where to run it' });
  await expect(where.getByRole('button', { name: /GPU\.ai/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(where.getByRole('button', { name: /Runpod/ })).toContainText('from $0.59/h');
  await expect(where).toContainText('One machine at a time');
  await noSideScroll(page);
  await page.screenshot({ path: info.outputPath('lite-where.png') });
  await where.getByRole('button', { name: /Runpod/ }).click();
  await where.getByRole('button', { name: 'Continue' }).click();
  const speed = page.getByRole('dialog', { name: 'Pick a speed' });
  await expect(speed.getByRole('button', { name: /Standard/ })).toHaveAttribute('aria-pressed', 'true');
  await speed.getByRole('button', { name: /Turbo/ }).click();
  await noSideScroll(page);
  await page.screenshot({ path: info.outputPath('lite-speed.png') });
  await speed.getByRole('button', { name: 'Turn on at Runpod' }).click();
  await expect.poll(() => calls.find((c) => c.path === '/api/ai' && c.body)?.body).toEqual({ action: 'start', provider: 'runpod', tier: 'turbo' });
  await expect(page.getByLabel('AI machine')).toContainText('on');
});

test('fast Make with both set up: GPU.ai goes on to its GPU list (Back returns) and is sent with its provider', async ({ page }) => {
  const { calls } = await standIns(page, { both: true });
  await page.goto(`${SITE}/lite`);
  await page.getByRole('button', { name: 'Turn on' }).click();
  const where = page.getByRole('dialog', { name: 'Where to run it' });
  await where.getByRole('button', { name: 'Continue' }).click();
  const gpus = page.getByRole('dialog', { name: 'Pick a GPU' });
  await expect(gpus.getByRole('button', { name: /A40/ })).toHaveAttribute('aria-pressed', 'true');
  await gpus.getByRole('button', { name: 'Back' }).click();
  await expect(where).toBeVisible();
  await where.getByRole('button', { name: 'Continue' }).click();
  await gpus.getByRole('button', { name: /RTX A6000/ }).click();
  await gpus.getByRole('button', { name: 'Turn on' }).click();
  await expect.poll(() => calls.find((c) => c.path === '/api/ai' && c.body)?.body).toEqual({ action: 'start', gpu: 'rtx_a6000', provider: 'gpuai' });
});
