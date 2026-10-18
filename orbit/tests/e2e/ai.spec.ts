import { expect, test, type Page } from '@playwright/test';
import { dock, expectNoHorizontalOverflow, openOrbit } from './helpers';
import { INSTALLED, expectTappable, mockAi, openAi, recordChats, sendText } from './aiMocks';

/**
 * AI app on iPhone / iPad viewports. The site's /api/ai endpoints and the AI machine's
 * OpenAI-compatible API are mocked (same origin, under /fake-ai), so this runs without a GPU.
 */

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
  // The maker store: built-ins installed; installing H3 Max downloads for two polls, then it is ready.
  const makers = [
    { id: 'qwen', kind: 'image', name: 'Qwen Uncensored', blurb: 'All-rounder.', for: null, twoImages: false, builtIn: true, wanted: true, installed: true, size: 17e9, percent: 100 },
    { id: 'krea-real', kind: 'image', name: 'Krea Real', blurb: 'Photoreal.', for: null, twoImages: false, builtIn: false, wanted: false, installed: false, size: 19e9, percent: 0 },
    { id: 'ltx', kind: 'video', name: 'LTX 10Eros', blurb: 'Video with sound.', for: null, twoImages: false, builtIn: true, wanted: true, installed: true, size: 43e9, percent: 100 },
    { id: 'h3-max', kind: 'video', name: 'H3 Max', blurb: 'Best motion.', for: null, twoImages: false, builtIn: false, wanted: false, installed: false, size: 51.5e9, percent: 0 },
    { id: 'edit', kind: 'edit', name: 'Edit with words', blurb: 'Change a picture.', for: null, twoImages: false, builtIn: true, wanted: true, installed: true, size: 17e9, percent: 100 },
    { id: 'outfit', kind: 'edit', name: 'Outfit swap', blurb: 'Swap outfits.', for: null, twoImages: true, builtIn: false, wanted: true, installed: true, size: 0.2e9, percent: 100 },
    { id: 'sharpen', kind: 'upscale', name: 'Sharpen 4×', blurb: 'Bigger and crisper.', for: null, twoImages: false, builtIn: false, wanted: false, installed: false, size: 67e6, percent: 0 },
    { id: 'style-darkbrush', kind: 'style', name: 'Dark brush', blurb: 'A look.', for: 'krea-real', twoImages: false, builtIn: false, wanted: false, installed: false, size: 0.47e9, percent: 0 },
  ];
  const makerCalls: string[] = [];
  let polls2 = 0;
  await page.route('**/fake-ai/_orbit/studio/makers', (route) => {
    const h3 = makers.find((m) => m.id === 'h3-max')!;
    if (h3.wanted && !h3.installed && ++polls2 > 1) Object.assign(h3, { installed: true, percent: 100 });
    return route.fulfill({ json: { makers } });
  });
  await page.route('**/fake-ai/_orbit/studio/makers/*', (route) => {
    const { id } = route.request().postDataJSON() as { id: string };
    const action = route.request().url().split('/').pop()!;
    makerCalls.push(`${action} ${id}`);
    const m = makers.find((x) => x.id === id)!;
    if (action === 'install') Object.assign(m, { wanted: true, percent: 40 });
    else Object.assign(m, { wanted: false, installed: false, percent: 0 });
    return route.fulfill({ json: { makers } });
  });
  return { items, requests, makers, makerCalls };
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
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'full', introSeen: true } }, version: 0 })),
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
    // With the box empty again the button becomes Stop (while answering) or Talk.
    await expect(page.getByRole('button', { name: 'Stop' }).or(page.getByRole('button', { name: 'Talk' }))).toBeVisible();
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
    // Pictures load lazily: bring the first one on screen (it is below the form on a landscape phone).
    await tile.scrollIntoViewIfNeeded();
    await expect(page.locator('.ai-tile img.ai-dev[data-loaded="true"]').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});

test.describe('AI app: chat powers', () => {
  test('photos and files go with the message; the model sees them', async ({ page }) => {
    await mockAi(page, 'on');
    const bodies = await recordChats(page);
    const errors = await openOrbit(page);
    await openAi(page);
    await page.locator('.ai-composer input[type=file]').setInputFiles([
      { name: 'cat.png', mimeType: 'image/png', buffer: PNG },
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Buy milk.\nCall Sam.') },
    ]);
    const chips = page.getByRole('list', { name: 'Attached' });
    await expect(chips.locator('li')).toHaveCount(2);
    await page.getByRole('textbox', { name: 'Message' }).fill('What is in these?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.ai-msg-assistant').last()).toContainText('Done.');
    await expect(page.locator('.ai-msg-user .ai-attached-img')).toHaveCount(1);
    await expect(page.locator('.ai-msg-user .ai-file-chip')).toContainText('notes.txt');
    const user = bodies[0].messages.find((m) => m.role === 'user')!;
    const parts = user.content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(parts[0].text).toContain('File: notes.txt');
    expect(parts[0].text).toContain('Call Sam.');
    expect(parts[0].text).toContain('What is in these?');
    expect(parts[1].image_url!.url).toMatch(/^data:image\/jpeg;base64,/);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('edit a message to replace the replies after it; branch into a new chat', async ({ page }) => {
    await mockAi(page, 'on');
    const bodies = await recordChats(page);
    await openOrbit(page);
    await openAi(page);
    await sendText(page, 'First try');
    await sendText(page, 'Second question');
    await expect(page.locator('.ai-msg')).toHaveCount(4);

    await page.locator('.ai-msg-user').first().getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByText(/Editing your message/)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('First try');
    await sendText(page, 'Better first try');
    await expect(page.locator('.ai-msg')).toHaveCount(2);
    await expect(page.locator('.ai-user-text')).toHaveText(['Better first try']);
    expect(bodies[2].messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['Better first try']);

    await page.locator('.ai-msg-assistant').first().getByRole('button', { name: 'Branch' }).click();
    await expect(page.getByText('Branched into a new chat.')).toBeVisible();
    await expect(page.locator('.ai-msg')).toHaveCount(2);
  });

  test('compare two models on the same question, and pick the answer to keep', async ({ page }) => {
    await mockAi(page, 'on');
    const bodies = await recordChats(page);
    await openOrbit(page);
    await openAi(page);
    await sendText(page, 'Which is better?');
    await page.locator('.ai-msg-assistant').getByRole('button', { name: 'Compare' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose a model' });
    await picker.getByRole('button', { name: /^qwen3\.6:35b/ }).click();
    const tabs = page.getByRole('tablist', { name: 'Answers from different models' });
    await expect(tabs.getByRole('tab')).toHaveCount(2);
    await expect(tabs.getByRole('tab', { selected: true })).toContainText('qwen3.6:35b');
    await expect(page.locator('.ai-msg-assistant .ai-msg-from')).toContainText('qwen3.6:35b');
    expect(bodies[1].model).toBe('qwen3.6:35b');
    expect(bodies[1].messages.at(-1)).toMatchObject({ role: 'user', content: 'Which is better?' });
    await tabs.getByRole('tab').first().click();
    await expect(tabs.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    await expectNoHorizontalOverflow(page);
  });

  test('canvas: rework a reply and put it back in the chat', async ({ page }) => {
    await mockAi(page, 'on');
    await recordChats(page, 'A long first draft about the sea.');
    await openOrbit(page);
    await openAi(page);
    await page.getByRole('textbox', { name: 'Message' }).fill('Write about the sea');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.ai-msg-assistant').last()).toContainText('first draft');
    await page.locator('.ai-msg-assistant').getByRole('button', { name: 'Canvas' }).click();
    const doc = page.getByRole('textbox', { name: 'Document' });
    await expect(doc).toHaveValue('A long first draft about the sea.');
    await recordChats(page, 'Short sea poem.');
    await page.getByRole('button', { name: 'Shorter' }).click();
    await expect(doc).toHaveValue('Short sea poem.');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(doc).toHaveValue('A long first draft about the sea.');
    await doc.fill('My own edit.');
    await page.getByRole('button', { name: 'Put back in chat' }).click();
    await expect(page.locator('.ai-msg-assistant').last()).toContainText('My own edit.');
  });

  test('personas and memory shape every chat', async ({ page }) => {
    await mockAi(page, 'on');
    const bodies = await recordChats(page);
    await openOrbit(page);
    await openAi(page);
    await page.getByRole('button', { name: 'Personas & memory' }).click();
    const sheet = page.getByRole('dialog', { name: 'Personas & memory' });
    await sheet.getByRole('radio', { name: /^Coder/ }).click();
    await sheet.getByRole('textbox', { name: 'Something to remember' }).fill('My name is Johnny');
    await sheet.getByRole('button', { name: 'Remember' }).click();
    await expect(sheet.getByText('My name is Johnny')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Coder' })).toBeVisible();
    await sendText(page, 'Hi');
    const system = bodies[0].messages[0];
    expect(system.role).toBe('system');
    expect(String(system.content)).toContain('senior software engineer');
    expect(String(system.content)).toContain('My name is Johnny');
    // Remember straight from a message.
    await page.locator('.ai-msg-user').getByRole('button', { name: 'Remember' }).click();
    await expect(page.getByText('Remembered for future chats.')).toBeVisible();
  });

  test('picture from chat: the image maker answers in the conversation', async ({ page }) => {
    await mockAi(page, 'on');
    const studio = await mockStudio(page);
    await openOrbit(page);
    await openAi(page);
    await page.getByRole('button', { name: 'Picture' }).click();
    await page.getByRole('textbox', { name: 'Message' }).fill('a lighthouse at dusk');
    await page.getByRole('button', { name: 'Make picture' }).click();
    const pic = page.locator('.ai-picture img');
    await expect(pic).toBeVisible({ timeout: 10_000 });
    await expect(pic).toHaveAttribute('alt', 'a lighthouse at dusk');
    expect(studio.requests[0]).toMatchObject({ kind: 'image', prompt: 'a lighthouse at dusk' });
    await expect(page.locator('.ai-msg-assistant').getByRole('link', { name: 'Save' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('AI app: web search', () => {
  test('search the web first: results go to the model and the reply lists its sources', async ({ page }) => {
    await mockAi(page, 'on');
    const bodies = await recordChats(page);
    const queries: string[] = [];
    await page.route('**/fake-ai/_orbit/search**', (route) => {
      queries.push(new URL(route.request().url()).searchParams.get('q') ?? '');
      return route.fulfill({
        json: {
          query: 'x',
          results: [
            { title: 'Miami weather', url: 'https://www.weather.example/miami', snippet: 'Sunny', text: 'Sunny and 31 °C today in Miami.' },
            { title: 'Forecast', url: 'https://forecast.example/fl', snippet: 'Hot week' },
          ],
        },
      });
    });
    await openOrbit(page);
    await openAi(page);
    const web = page.getByRole('button', { name: 'Search the web' });
    await web.click();
    await expect(web).toHaveAttribute('aria-pressed', 'true');
    await sendText(page, 'Weather in Miami today?');
    expect(queries).toEqual(['Weather in Miami today?']);
    const user = bodies[0].messages.at(-1)!;
    expect(String(user.content)).toContain('[1] Miami weather');
    expect(String(user.content)).toContain('Sunny and 31 °C');
    expect(String(user.content)).toMatch(/My message:\nWeather in Miami today\?$/);
    const sources = page.getByRole('list', { name: 'Sources' });
    await expect(sources.getByRole('link')).toHaveCount(2);
    await expect(sources.getByRole('link').first()).toHaveAttribute('href', 'https://www.weather.example/miami');
    await expect(sources).toContainText('weather.example');
    // The saved chat keeps your words only.
    await expect(page.locator('.ai-user-text')).toHaveText(['Weather in Miami today?']);
    await expectNoHorizontalOverflow(page);
  });
});


test.describe('AI app: maker store', () => {
  test('install a new video maker, pick it, and the job uses it', async ({ page }) => {
    await mockAi(page, 'on');
    const studio = await mockStudio(page);
    await openOrbit(page);
    await openCreate(page);
    await page.getByRole('group', { name: 'What to make' }).getByRole('button', { name: 'Video' }).click();
    await page.getByRole('button', { name: 'Makers' }).click();
    const sheet = page.getByRole('dialog', { name: 'Makers' });
    await expect(sheet.getByRole('region', { name: 'Video' })).toContainText('H3 Max');
    await sheet.getByRole('button', { name: /^Install H3 Max, 52 GB$/ }).click();
    expect(studio.makerCalls).toEqual(['install h3-max']);
    await expect(sheet.getByText('40%')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press('Escape');
    const picks = page.getByRole('radiogroup', { name: 'Maker' });
    await picks.getByRole('radio', { name: /H3 Max/ }).click();
    await expect(picks.getByRole('radio', { name: /H3 Max/ })).toHaveAttribute('aria-checked', 'true');
    // Ready once the download finishes (the next refresh).
    await page.getByRole('textbox', { name: 'Describe it' }).fill('neon rain on a city street, synth music');
    const make = page.getByRole('button', { name: 'Make video' });
    await expect(make).toBeEnabled({ timeout: 12_000 });
    await make.click();
    await expect.poll(() => studio.requests.length).toBe(1);
    expect(studio.requests[0]).toMatchObject({ kind: 'video', maker: 'h3-max', prompt: 'neon rain on a city street, synth music' });
  });

  test('edit a picture from the gallery with words; outfit swap asks for two pictures', async ({ page }) => {
    await mockAi(page, 'on');
    const studio = await mockStudio(page);
    await openOrbit(page);
    await openCreate(page);
    await page.getByRole('button', { name: /^Image: a red fox in snow/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('group', { name: 'What to make' }).getByRole('button', { name: 'Edit', pressed: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Picture to edit' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Describe it' }).fill('make it night with a full moon');
    await page.getByRole('button', { name: /^Edit$/ }).last().click();
    await expect.poll(() => studio.requests.length).toBe(1);
    expect(studio.requests[0]).toMatchObject({ kind: 'image', maker: 'edit', fromItem: 'img1', prompt: 'make it night with a full moon', images: [] });

    await page.getByRole('radiogroup', { name: 'Maker' }).getByRole('radio', { name: 'Outfit swap' }).click();
    await expect(page.getByText('Add the person first, then the outfit.')).toBeVisible();
    await page.getByRole('textbox', { name: 'Describe it' }).fill('Dress the person in image 1 in the jacket from image 2.');
    const go = page.getByRole('button', { name: /^Edit$/ }).last();
    await expect(go).toBeDisabled();
    await page.locator('.ai-edit-photos input[type=file]').setInputFiles({ name: 'jacket.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('img', { name: 'The outfit' })).toBeVisible();
    await expect(go).toBeEnabled();
    await expect(page.getByText('Edits take under a minute.')).toBeVisible();
    await go.click();
    await expect.poll(() => studio.requests.length).toBe(2);
    expect(studio.requests[1]).toMatchObject({ maker: 'outfit', fromItem: 'img1' });
    expect((studio.requests[1].images as string[]).length).toBe(1);
    await expectNoHorizontalOverflow(page);
  });
});
