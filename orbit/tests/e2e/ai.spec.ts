import { expect, test, type Page } from '@playwright/test';
import { dock, expectNoHorizontalOverflow, openOrbit } from './helpers';

/**
 * AI app on iPhone / iPad viewports. The site's /api/ai endpoints and the AI machine's
 * OpenAI-compatible API are mocked (same origin, under /fake-ai), so this runs without a GPU.
 */

const MODELS = ['qwen3.6:35b', 'qwen3.8-obliterated:27b', 'qwen3.8:27b'];
const LONG_LINE = `const data = [${Array.from({ length: 60 }, (_, i) => `"item-${i}"`).join(', ')}];`;
const REPLY = `Here is the answer.\n\n\`\`\`js\n${LONG_LINE}\nconsole.log(data.length);\n\`\`\`\n\nDone.`;

function sse(text: string) {
  const parts = text.match(/[\s\S]{1,24}/g) ?? [];
  return (
    [
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'Thinking about it.' } }] })}`,
      ...parts.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}`),
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 80 } })}`,
      'data: [DONE]',
    ].join('\n\n') + '\n\n'
  );
}

const TIERS = [
  { id: 'standard', label: 'Standard', gpuName: 'A40 48 GB', pricePerHour: 0.59, idleMinutes: 30, speed: 'normal speed' },
  { id: 'turbo', label: 'Turbo', gpuName: 'H100 80 GB', pricePerHour: 3.99, idleMinutes: 10, speed: 'about 4–6× faster' },
];

const INSTALLED = [
  { name: 'qwen3.6:35b', size: 22.6e9, loaded: false, vision: true, tools: true, thinking: true, family: 'qwen35moe', params: '35.5B', quant: 'Q4_K_M' },
  { name: 'qwen3.8-obliterated:27b', size: 23.4e9, loaded: false, vision: true, tools: true, thinking: true, family: 'qwen35', params: '27.3B', quant: 'Q6_K' },
  { name: 'qwen3.8:27b', size: 17.7e9, loaded: true, vision: true, tools: true, thinking: true, family: 'qwen35', params: '27.3B', quant: 'Q4_K_M' },
];

/** The AI machine's model store, with installs that take three seconds. */
async function mockStore(page: Page) {
  const installed = INSTALLED.map((m) => ({ ...m }));
  const pulls: { name: string; status: string; percent: number; error: null; done: boolean; at: number }[] = [];
  const calls: { path: string; body?: unknown }[] = [];
  const featured = [
    { spec: 'qwen3.8:27b', title: 'Qwen 3.8 27B', blurb: 'Best all-rounder.', tags: ['general'], size: 17.7e9 },
    { spec: 'defiant-fable:9b=hf.co/x/y:Q6_K', title: 'Defiant Fable 9B', blurb: 'Small, fast storyteller.', tags: ['uncensored', 'fast'], size: 9.5e9 },
  ];
  const nameOf = (spec: string) => spec.split('=')[0];
  await page.route('**/fake-ai/_orbit/models**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/_orbit\/models/, '');
    const body = req.method() === 'POST' ? req.postDataJSON() : undefined;
    calls.push({ path: `${req.method()} ${path}${url.search}`, body });
    if (req.method() === 'GET' && path === '') {
      for (const p of pulls) {
        p.percent = Math.min(100, Math.floor(((Date.now() - p.at) / 3000) * 100));
        if (p.percent >= 100 && !installed.some((m) => m.name === p.name)) {
          installed.push({ ...INSTALLED[0], name: p.name, loaded: false, size: 9.5e9 });
        }
      }
      const live = pulls.filter((p) => p.percent < 100);
      pulls.splice(0, pulls.length, ...live);
      return route.fulfill({
        json: { installed, pulls: pulls.map(({ at: _, ...p }) => p), disk: { total: 150e9, free: 15e9 } },
      });
    }
    if (path === '/featured') {
      return route.fulfill({ json: { models: featured.map((m) => ({ ...m, name: nameOf(m.spec), installed: installed.some((i) => i.name === nameOf(m.spec)) })) } });
    }
    if (path === '/search') return route.fulfill({ json: { results: [{ repo: 'org/Cool-Model-GGUF', downloads: 12000, likes: 300, updatedAt: null }] } });
    if (path === '/files') {
      return route.fulfill({
        json: { files: [{ quant: 'Q4_K_M', file: 'a.gguf', size: 9e9 }, { quant: 'Q8_0', file: 'b.gguf', size: 16e9 }] },
      });
    }
    if (path === '/install') {
      const b = body as { spec?: string; repo?: string; quant?: string };
      const name = b.spec ? nameOf(b.spec) : `cool-model:${b.quant!.toLowerCase()}`;
      pulls.push({ name, status: 'pulling', percent: 0, error: null, done: false, at: Date.now() });
      return route.fulfill({ status: 202, json: { name } });
    }
    if (path === '/load' || path === '/dismiss') return route.fulfill({ json: { ok: true } });
    if (req.method() === 'DELETE') {
      const name = decodeURIComponent(path.slice(1));
      installed.splice(installed.findIndex((m) => m.name === name), 1);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: { error: 'nope' } });
  });
  return calls;
}

async function mockAi(page: Page, initial: 'off' | 'on', powerCalls: Record<string, unknown>[] = []) {
  let state: string = initial;
  let tier = 'standard';
  await page.route('**/api/ai', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { tier?: string };
      powerCalls.push(body);
      state = 'on';
      tier = body.tier ?? tier;
    }
    await route.fulfill({
      json: {
        state,
        costPerHour: state === 'on' ? TIERS.find((t) => t.id === tier)!.pricePerHour : null,
        models: state === 'on' ? MODELS : [],
        idle: state === 'on' ? { limitMinutes: 30, idleMinutes: 0 } : null,
        tier,
        tiers: TIERS,
      },
    });
  });
  await page.route('**/api/ai/token', (route) =>
    route.fulfill({ json: { url: new URL('/fake-ai', page.url()).href, token: 'test', expiresIn: 3600 } }),
  );
  await page.route('**/fake-ai/v1/models', (route) => route.fulfill({ json: { data: MODELS.map((id) => ({ id })) } }));
  await page.route('**/fake-ai/v1/chat/completions', (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(REPLY) }),
  );
  return mockStore(page);
}

async function openAi(page: Page) {
  // After a reload Orbit reopens the app that was open.
  const win = page.locator('.app-window[data-app="ai"]');
  const icon = page.getByRole('button', { name: /^AI\./ });
  await expect(win.or(icon).first()).toBeVisible();
  if (!(await win.isVisible())) await icon.click();
  await expect(win.locator('.ai-composer')).toBeVisible();
  await expect(page.locator('.app-window[data-app="ai"]')).toBeVisible();
}

/** Every visible button in the AI window is on screen and at least `min` px tall and wide. */
async function expectTappable(page: Page, min = 44) {
  const boxes = await page.locator('.app-window[data-app="ai"] button:visible').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label') || el.textContent?.trim() || '?', x: r.x, right: r.right, w: r.width, h: r.height };
    }),
  );
  const vw = page.viewportSize()!.width;
  for (const b of boxes) {
    expect(b.x, `${b.name} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(b.right, `${b.name} ends on screen`).toBeLessThanOrEqual(vw + 1);
    expect(Math.min(b.w, b.h), `${b.name} is big enough to tap`).toBeGreaterThanOrEqual(min);
  }
}

test.describe('AI app', () => {
  test('off: turn-on banner fits the screen and turns the machine on at the chosen speed', async ({ page }) => {
    const powerCalls: Record<string, unknown>[] = [];
    await mockAi(page, 'off', powerCalls);
    const errors = await openOrbit(page);
    await openAi(page);
    const banner = page.getByRole('status').filter({ hasText: 'Your AI machine is off' });
    await expect(banner).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);
    await page.getByRole('group', { name: 'Speed' }).getByRole('button', { name: /Turbo/ }).click();
    await expect(banner).toContainText('$3.99/h');
    await expect(banner).toContainText('10 minutes unused');
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByText('Your AI machine: Ready · Turbo')).toBeVisible();
    expect(powerCalls[0]).toMatchObject({ action: 'start', tier: 'turbo' });
    await expect(banner).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('chat: send, streamed reply, wide code stays inside the screen', async ({ page }, testInfo) => {
    await mockAi(page, 'on');
    const errors = await openOrbit(page);
    await openAi(page);
    const chip = page.getByRole('button', { name: /^Model: .*Change model$/ });
    await expect(chip).toBeEnabled();
    await chip.click();
    const picker = page.getByRole('dialog', { name: 'Choose a model' });
    await expect(picker.locator('.ai-model-row')).toHaveCount(INSTALLED.length);
    await expect(picker.getByRole('button', { pressed: true })).toHaveCount(1);
    await expect(picker.getByText('in the GPU now')).toBeVisible();
    await picker.getByRole('button', { name: /^qwen3\.8-obliterated:27b/ }).click();
    await expect(picker).toHaveCount(0);
    await expect(chip).toHaveAccessibleName('Model: qwen3.8-obliterated:27b. Change model');

    const box = page.getByRole('textbox', { name: 'Message' });
    await box.fill('Show me some code');
    // Touch devices: Return adds a new line, the Send button sends.
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Done.')).toBeVisible();
    await expect(page.getByText(/^Thought for \d+s$|^Thinking$/)).toBeVisible();
    await expect(page.getByText(/\d+ tokens\/s/)).toBeVisible();
    await expect(page.locator('.ai-msg-from').last()).toContainText('qwen3.8-obliterated:27b');
    await expect(box).toHaveValue('');

    await expectNoHorizontalOverflow(page);
    // The wide code line scrolls inside its own block, not the page.
    const code = page.locator('.ai-msg-assistant pre').first();
    await expect(code).toBeVisible();
    const fits = await code.evaluate((el) => el.getBoundingClientRect().right <= document.documentElement.clientWidth + 1);
    expect(fits, 'code block fits the screen').toBe(true);

    // The composer is fully on screen and not covered by the dock.
    const composer = await page.locator('.ai-composer').boundingBox();
    const dockBox = await dock(page).boundingBox();
    const vh = page.viewportSize()!.height;
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(vh + 1);
    if (dockBox) expect(composer!.y + composer!.height, 'composer above the dock').toBeLessThanOrEqual(dockBox.y + 1);

    await expectTappable(page);
    await expect(page.getByRole('button', { name: 'Again' })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('ai-chat.png') });
    expect(errors).toEqual([]);
  });

  test('chats list: sheet on narrow screens, sidebar on wide ones; survives reload', async ({ page }) => {
    await mockAi(page, 'on');
    await openOrbit(page);
    await openAi(page);
    await page.getByRole('textbox', { name: 'Message' }).fill('First question');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Done.')).toBeVisible();

    const sidebar = page.locator('.ai-side');
    if (await sidebar.isVisible()) {
      await expect(sidebar.getByRole('button', { name: /^First question/ })).toBeVisible();
    } else {
      await page.getByRole('button', { name: 'Chats' }).click();
      const sheet = page.getByRole('dialog', { name: 'Chats' });
      await expect(sheet.getByRole('button', { name: /^First question/ })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await sheet.getByRole('button', { name: 'New chat' }).click();
      await expect(sheet).toHaveCount(0);
    }

    await page.reload();
    await openAi(page);
    if (await page.locator('.ai-side').isVisible()) {
      await expect(page.locator('.ai-side').getByRole('button', { name: /^First question/ })).toBeVisible();
    } else {
      await page.getByRole('button', { name: 'Chats' }).click();
      await expect(page.getByRole('dialog', { name: 'Chats' }).getByRole('button', { name: /^First question/ })).toBeVisible();
    }
  });

  test('empty chat: suggestions fill the message box', async ({ page }) => {
    await mockAi(page, 'on');
    await openOrbit(page);
    await openAi(page);
    await expect(page.getByRole('heading', { name: 'What can I help with?' })).toBeVisible();
    await page.getByRole('button', { name: 'Write code' }).click();
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(/Python script/);
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);
  });

  test('model store: featured install, search a model and pick its size, delete', async ({ page }, testInfo) => {
    const calls = await mockAi(page, 'on');
    const errors = await openOrbit(page);
    await openAi(page);
    await page.getByRole('button', { name: 'Model store' }).click();
    const store = page.getByRole('dialog', { name: 'Model store' });
    await expect(store.getByText('15.0 GB free')).toBeVisible();
    await expect(store.getByText('Installed', { exact: true })).toBeVisible();
    await store.getByRole('button', { name: 'Install Defiant Fable 9B' }).click();
    await expect(store.getByRole('status', { name: 'Installing defiant-fable:9b' })).toBeVisible();
    await expect(store.getByText('Installed', { exact: true })).toHaveCount(2, { timeout: 10_000 });
    expect(calls.find((c) => c.path === 'POST /install')?.body).toEqual({ spec: 'defiant-fable:9b=hf.co/x/y:Q6_K' });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('ai-store.png') });

    await store.getByRole('button', { name: 'Search' }).click();
    await store.getByRole('searchbox', { name: 'Search models' }).fill('cool');
    await store.getByRole('button', { name: 'Search', exact: true }).last().click();
    await store.getByRole('button', { name: /^org\/Cool-Model-GGUF/ }).click();
    await expect(store.getByText('Q8_0')).toBeVisible();
    // 16 GB doesn't fit in 15 GB free.
    await expect(store.getByRole('button', { name: 'Install Q8_0' })).toBeDisabled();
    await store.getByRole('button', { name: 'Install Q4_K_M' }).click();
    await expect.poll(() => calls.filter((c) => c.path === 'POST /install').pop()?.body).toEqual({ repo: 'org/Cool-Model-GGUF', quant: 'Q4_K_M' });

    await store.getByRole('button', { name: /^Installed/ }).click();
    await store.getByRole('button', { name: 'Delete qwen3.6:35b' }).click();
    await page.getByRole('dialog', { name: 'Delete qwen3.6:35b?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(store.getByRole('button', { name: 'Delete qwen3.6:35b' })).toHaveCount(0);
    expect(calls.some((c) => c.path === 'DELETE /qwen3.6%3A35b')).toBe(true);
    await expectTappable(page);
    expect(errors).toEqual([]);
  });
});

// ---- Create: image and video maker

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const READY = { ready: true, downloaded: true, percent: 100 };

async function mockStudio(page: Page) {
  const items = [
    { id: 'img1', kind: 'image', prompt: 'a red fox in snow', width: 1328, height: 1328, createdAt: '2026-10-16T10:00:00Z', url: '/_orbit/studio/file/img1?t=tok' },
    { id: 'vid1', kind: 'video', prompt: 'waves at sunset', width: 1280, height: 720, seconds: 5, createdAt: '2026-10-16T09:00:00Z', url: '/_orbit/studio/file/vid1?t=tok' },
  ];
  const requests: Record<string, unknown>[] = [];
  const polls: Record<string, number> = {};
  await page.route('**/fake-ai/_orbit/studio', (route) =>
    route.fulfill({ json: { setup: 'running', running: true, image: READY, video: READY, downloading: null, downloadError: null, jobs: [] } }),
  );
  await page.route('**/fake-ai/_orbit/studio/items', (route) => route.fulfill({ json: { items } }));
  await page.route('**/fake-ai/_orbit/studio/items/*', (route) => {
    const id = route.request().url().split('/').pop()!;
    items.splice(items.findIndex((i) => i.id === id), 1);
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/fake-ai/_orbit/studio/file/**', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: PNG }));
  await page.route('**/fake-ai/_orbit/studio/jobs', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    if (/naked child/.test(String(body.prompt))) {
      return route.fulfill({ status: 422, json: { error: "This can't be made: sexual content involving minors is never allowed.", blocked: true } });
    }
    const id = `job${requests.length}`;
    return route.fulfill({ json: { id, kind: body.kind, prompt: body.prompt, status: 'queued', progress: 0, error: null, createdAt: new Date().toISOString(), item: null } });
  });
  await page.route('**/fake-ai/_orbit/studio/jobs/*', (route) => {
    const id = route.request().url().split('/').pop()!;
    polls[id] = (polls[id] ?? 0) + 1;
    const req = requests[Number(id.slice(3)) - 1];
    if (polls[id] < 2) {
      return route.fulfill({ json: { id, kind: req.kind, prompt: req.prompt, status: 'running', progress: 40, error: null, createdAt: '', item: null } });
    }
    const item = { id: `new${id}`, kind: req.kind, prompt: req.prompt, createdAt: new Date().toISOString(), url: `/_orbit/studio/file/new${id}?t=tok` };
    if (!items.some((i) => i.id === item.id)) items.unshift(item as (typeof items)[number]);
    return route.fulfill({ json: { id, kind: req.kind, prompt: req.prompt, status: 'done', progress: 100, error: null, createdAt: '', item } });
  });
  return { items, requests };
}

async function openCreate(page: Page) {
  await openAi(page);
  await page.getByRole('group', { name: 'Chat or create' }).getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.ai-create')).toBeVisible();
}

test.describe('AI app: Create', () => {
  test('make an image: progress, then it lands in the gallery; fits and is tappable', async ({ page }, testInfo) => {
    await mockAi(page, 'on');
    const studio = await mockStudio(page);
    const errors = await openOrbit(page);
    await openCreate(page);
    const gallery = page.getByRole('list', { name: 'Your creations' });
    await expect(gallery.getByRole('listitem')).toHaveCount(2);

    await page.getByRole('textbox', { name: 'Describe it' }).fill('a lighthouse in a storm');
    await page.getByRole('group', { name: 'Shape' }).getByRole('button', { name: 'Portrait' }).click();
    await page.getByRole('button', { name: 'Make image' }).click();
    await expect(page.getByRole('list', { name: 'In progress' })).toBeVisible();
    await expect(gallery.getByRole('listitem')).toHaveCount(3, { timeout: 10_000 });
    await expect(page.getByRole('list', { name: 'In progress' })).toHaveCount(0);
    expect(studio.requests[0]).toMatchObject({ kind: 'image', prompt: 'a lighthouse in a storm', size: 'portrait' });

    await expectNoHorizontalOverflow(page);
    await expectTappable(page);
    await page.screenshot({ path: testInfo.outputPath('ai-create.png') });
    expect(errors).toEqual([]);
  });

  test('video from a photo: the request carries the picture, length and shape', async ({ page }) => {
    await mockAi(page, 'on');
    const studio = await mockStudio(page);
    await openOrbit(page);
    await openCreate(page);
    await page.getByRole('group', { name: 'What to make' }).getByRole('button', { name: 'Video' }).click();
    await page.locator('.ai-create input[type="file"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('img', { name: 'Starting photo' })).toBeVisible();
    await page.getByRole('group', { name: 'Length' }).getByRole('button', { name: '8 s' }).click();
    await page.getByRole('group', { name: 'Shape' }).getByRole('button', { name: 'Portrait' }).click();
    await page.getByRole('textbox', { name: 'Describe it' }).fill('she turns and waves');
    await page.getByRole('button', { name: 'Make video' }).click();
    await expect.poll(() => studio.requests.length).toBe(1);
    const req = studio.requests[0];
    expect(req).toMatchObject({ kind: 'video', prompt: 'she turns and waves', size: 'portrait', seconds: 8 });
    expect(String(req.image)).toMatch(/^data:image\/jpeg;base64,/);
    await expectNoHorizontalOverflow(page);
  });

  test('viewer: full size with Save, Use prompt, Make it move, and Delete', async ({ page }) => {
    await mockAi(page, 'on');
    await mockStudio(page);
    await openOrbit(page);
    await openCreate(page);
    await page.getByRole('button', { name: 'Image: a red fox in snow' }).click();
    const sheet = page.getByRole('dialog', { name: 'Image' });
    await expect(sheet.getByRole('img', { name: 'a red fox in snow' })).toBeVisible();
    const save = sheet.getByRole('link', { name: 'Save' });
    await expect(save).toHaveAttribute('href', /\/fake-ai\/_orbit\/studio\/file\/img1\?t=tok&download=1$/);
    await expectNoHorizontalOverflow(page);
    await sheet.getByRole('button', { name: 'Make it move' }).click();
    await expect(page.getByRole('img', { name: 'Starting photo' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'What to make' }).getByRole('button', { name: 'Video' })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Video: waves at sunset' }).click();
    await page.getByRole('dialog', { name: 'Video' }).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog', { name: 'Delete this?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: 'Video: waves at sunset' })).toHaveCount(0);
  });

  test('a refused prompt shows why', async ({ page }) => {
    await mockAi(page, 'on');
    await mockStudio(page);
    await openOrbit(page);
    await openCreate(page);
    await page.getByRole('textbox', { name: 'Describe it' }).fill('naked child');
    await page.getByRole('button', { name: 'Make image' }).click();
    await expect(page.getByText('sexual content involving minors is never allowed')).toBeVisible();
  });
});

// ---- Full motion: the chat's personality

test.describe('AI app with full motion', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('messages pop in, the send button launches, the orb reacts to typing, pictures develop', async ({ page }, testInfo) => {
    await page.addInitScript(() =>
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { motion: 'full', introSeen: true } }, version: 0 })),
    );
    await mockAi(page, 'on');
    await mockStudio(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await openAi(page);

    // The orb swells while you type.
    const hello = page.locator('.ai-hello');
    await expect(hello).toHaveAttribute('data-typing', 'false');
    // On Full motion the orb is the GPU liquid sphere (the CSS orb is the fallback).
    await expect(page.locator('canvas.ai-orb-gpu[data-live="true"]')).toHaveCount(1);
    await page.getByRole('textbox', { name: 'Message' }).fill('Hello there');
    await expect(hello).toHaveAttribute('data-typing', 'true');

    const send = page.getByRole('button', { name: 'Send' });
    await send.click();
    await expect(send.or(page.getByRole('button', { name: 'Stop' }))).toBeVisible();
    const user = page.locator('.ai-msg-user').first();
    expect(await user.evaluate((el) => getComputedStyle(el).animationName)).toBe('mo-pop-right');
    await expect(page.getByText('Done.')).toBeVisible();
    expect(await page.locator('.ai-msg-assistant').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('mo-pop-left');
    await expectNoHorizontalOverflow(page);
    // The open animation has finished: no leftover transform, the window fills the screen.
    await expect.poll(() => page.locator('.app-window[data-app="ai"]').evaluate((el) => getComputedStyle(el).transform), { timeout: 4000 }).toBe('none');
    expect(await page.locator('.app-window[data-app="ai"]').evaluate((el) => Math.round(el.getBoundingClientRect().left))).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('ai-chat-full-motion.png') });

    // Create: pictures start undeveloped and sharpen once loaded; tiles bounce in.
    await page.getByRole('button', { name: 'Create' }).click();
    const tile = page.locator('.ai-gallery li').first();
    await expect(tile).toBeVisible();
    expect(await tile.evaluate((el) => getComputedStyle(el).animationName)).toBe('mo-icon-pop');
    await expect(page.locator('.ai-tile img.ai-dev[data-loaded="true"]').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});
