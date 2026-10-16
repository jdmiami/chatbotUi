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
      'data: [DONE]',
    ].join('\n\n') + '\n\n'
  );
}

const TIERS = [
  { id: 'standard', label: 'Standard', gpuName: 'A40 48 GB', pricePerHour: 0.59, idleMinutes: 30, speed: 'normal speed' },
  { id: 'turbo', label: 'Turbo', gpuName: 'H100 80 GB', pricePerHour: 3.99, idleMinutes: 10, speed: 'about 4–6× faster' },
];

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
    const picker = page.locator('.app-window[data-app="ai"] .ai-model select');
    await expect(picker.locator('option')).toHaveCount(MODELS.length);
    await picker.selectOption('qwen3.8-obliterated:27b');

    const box = page.getByRole('textbox', { name: 'Message' });
    await box.fill('Show me some code');
    // Touch devices: Return adds a new line, the Send button sends.
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Done.')).toBeVisible();
    await expect(page.getByText('Thinking', { exact: true })).toBeVisible();
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
