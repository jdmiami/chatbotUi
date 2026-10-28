import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, indexButton, openApp, openOrbit, expectNotValue, expectValue } from './helpers';
import { INSTALLED, aiMenu, closeMakeGallery, expectTappable, makeStep, mockAi, openAi, openMakeApp, openMakeGallery, recordChats, sendText, setShowNsfw, showTools, typeAndSend } from './aiMocks';

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
    // One auto-off rule for every speed: Turbo no longer has its own.
    await expect(banner).toContainText('Turns itself off after 60 minutes unused.');
    await page.getByRole('group', { name: 'Speed' }).getByRole('button', { name: /Turbo/ }).click();
    await expect(banner).toContainText('$2.89/h');
    await expect(banner).toContainText('Turns itself off after 60 minutes unused.');
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByRole('button', { name: /^Your AI: Ready/ })).toBeVisible();
    expect(powerCalls[0]).toMatchObject({ action: 'start', tier: 'turbo' });
    await expect(banner).toHaveCount(0);
    // The AI's menu (the orb at the top) says it is on, at Turbo's price.
    await expect(await aiMenu(page)).toContainText('Ready · $2.89/h');
    expect(errors).toEqual([]);
  });

  test('chat: send, streamed reply, wide code stays inside the screen', async ({ page }, testInfo) => {
    await mockAi(page, 'on');
    const errors = await openOrbit(page);
    await openAi(page);
    // The model lives in the AI's menu (the orb at the top).
    const menu = await aiMenu(page);
    const chip = menu.getByRole('button', { name: /^Model / });
    await expect(chip).toBeEnabled();
    await chip.click();
    const picker = page.getByRole('dialog', { name: 'Choose a model' });
    await expect(picker.locator('.ai-model-row')).toHaveCount(INSTALLED.length);
    await expect(picker.getByRole('button', { pressed: true })).toHaveCount(1);
    await expect(picker.getByText('in the GPU now')).toBeVisible();
    await picker.getByRole('button', { name: /^qwen3\.8-obliterated:27b/ }).click();
    await expect(picker).toHaveCount(0);
    await aiMenu(page);
    await expect(chip).toHaveAccessibleName(/^Model qwen3\.8-obliterated:27b/);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    const box = page.getByRole('textbox', { name: 'Message' });
    await box.fill('Show me some code');
    // Touch devices: Return adds a new line, the Send button sends.
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Done.')).toBeVisible();
    await expect(page.getByText(/^Thought for \d+s$|^Thinking$/)).toBeVisible();
    await expect(page.getByText(/\d+ tokens\/s/)).toBeVisible();
    await expect(page.locator('.ai-msg-from').last()).toContainText('qwen3.8-obliterated:27b');
    await expectValue(box, '');

    await expectNoHorizontalOverflow(page);
    // The wide code line scrolls inside its own block, not the page.
    const code = page.locator('.ai-msg-assistant pre').first();
    await expect(code).toBeVisible();
    const fits = await code.evaluate((el) => el.getBoundingClientRect().right <= document.documentElement.clientWidth + 1);
    expect(fits, 'code block fits the screen').toBe(true);

    // The composer is fully on screen and not covered by the line at the bottom.
    const composer = await page.locator('.ai-composer').boundingBox();
    const line = await page.locator('.o5-handle-line').boundingBox();
    const vh = page.viewportSize()!.height;
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(vh + 1);
    if (line) expect(composer!.y + composer!.height, 'composer above the line').toBeLessThanOrEqual(line.y + 1);

    await expectTappable(page);
    await expect(page.getByRole('button', { name: 'Again' })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('ai-chat.png') });
    expect(errors).toEqual([]);
  });

  test('machine off: chats are answered in the cloud; Settings picks which cloud goes first', async ({ page }) => {
    await mockAi(page, 'off');
    const sent: { task: string; prefer?: string; last: string }[] = [];
    const providers = [{ id: 'nvidia', name: 'NVIDIA' }, { id: 'groq', name: 'Groq' }];
    await page.route(/\/api\/orb\/ai(\?.*)?$/, async (route) => {
      const prefer = new URL(route.request().url()).searchParams.get('prefer');
      if (route.request().method() === 'GET') {
        const list = prefer ? [...providers].sort((a) => (a.id === prefer ? -1 : 0)) : providers;
        return route.fulfill({ json: { configured: true, providers: list, models: {} } });
      }
      const body = route.request().postDataJSON() as { task: string; prefer?: string; messages: { content: string }[] };
      sent.push({ task: body.task, prefer: body.prefer, last: String(body.messages[body.messages.length - 1].content) });
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello from the cloud.' } }] })}\n\ndata: [DONE]\n\n`;
      return route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-orb-model': 'test', 'x-orb-provider': 'nvidia' }, body: sse });
    });
    const errors = await openOrbit(page);
    await openAi(page);
    const win = page.locator('.app-window[data-app="ai"]');
    const box = win.getByRole('textbox', { name: 'Message' });
    await expect(box).toHaveAttribute('placeholder', 'Message your model…');
    await box.fill('hi there');
    await win.getByRole('button', { name: 'Send' }).click();
    await expect(win.locator('.ai-msg-assistant').last()).toContainText('Hello from the cloud.');
    expect(sent[0]).toEqual({ task: 'chat', prefer: undefined, last: 'hi there' });

    // Settings: put the backup first; the next chat asks for it.
    await openApp(page, 'settings');
    const first = page.locator('.app-window[data-app="settings"]').getByRole('group', { name: 'Cloud AI to try first' });
    await first.scrollIntoViewIfNeeded();
    await first.getByRole('button', { name: 'Groq' }).click();
    await expect(first.getByRole('button', { name: 'Groq' })).toHaveAttribute('aria-pressed', 'true');
    await openApp(page, 'ai');
    await box.fill('again');
    await win.getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toMatchObject({ task: 'chat', prefer: 'groq' });
    expect(errors).toEqual([]);
  });

  test('chats list: a sheet from the AI menu; survives reload', async ({ page }) => {
    await mockAi(page, 'on');
    await openOrbit(page);
    await openAi(page);
    await typeAndSend(page, 'First question');
    await expect(page.getByText('Done.')).toBeVisible();

    await aiMenu(page, 'Conversations');
    const sheet = page.getByRole('dialog', { name: 'Chats' });
    await expect(sheet.getByRole('button', { name: /^First question/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await sheet.getByRole('button', { name: 'New chat' }).click();
    await expect(sheet).toHaveCount(0);

    await page.reload();
    await openAi(page);
    await aiMenu(page, 'Conversations');
    await expect(page.getByRole('dialog', { name: 'Chats' }).getByRole('button', { name: /^First question/ })).toBeVisible();
  });

  test('empty chat: suggestions fill the message box', async ({ page }) => {
    await mockAi(page, 'on');
    await openOrbit(page);
    await openAi(page);
    await expect(page.getByRole('heading', { name: 'What can I help with?' })).toBeVisible();
    await page.getByRole('button', { name: 'Write code' }).click();
    await expectValue(page.getByRole('textbox', { name: 'Message' }), /Python script/);
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);
  });
});

// ---- Create: image and video maker

/** "What will it be?" in Make: a picture, a video, an edit, or a video edit. */
const KINDS = { image: /^A picture/, video: /^A video/, edit: /^An edit/, vedit: /^Edit a video/ } as const;
const kindRadio = (page: Page, kind: keyof typeof KINDS) =>
  page.locator('.app-window[data-app="make"]').getByRole('radiogroup', { name: 'What to make' }).getByRole('radio', { name: KINDS[kind] });
/** Make is a walk-through: "What" is its first step; picking one moves on to the maker. */
async function pickKind(page: Page, kind: keyof typeof KINDS) {
  await makeStep(page, 'What');
  await kindRadio(page, kind).click();
  await makeStep(page, 'Maker & style');
}
/** The maker step with its list of makers. */
async function makerPicks(page: Page) {
  await makeStep(page, 'Maker & style');
  return page.locator('.app-window[data-app="make"]').getByRole('radiogroup', { name: 'Maker' });
}
/** Pick a maker on the maker step (the next step slides in). */
async function pickMaker(page: Page, name: string | RegExp) {
  await (await makerPicks(page)).getByRole('radio', { name }).click();
  // The pick is approved and the next step slides in.
  await expect(page.locator('.app-window[data-app="make"]').getByRole('navigation', { name: 'Make, step by step' }).getByRole('button', { name: /: Maker & style$/ })).not.toHaveAttribute('aria-current', 'step');
}
/** Write the words on the "Describe it" step. */
async function describe(page: Page, text: string) {
  await makeStep(page, 'Describe it');
  await page.getByRole('textbox', { name: 'Describe it' }).fill(text);
}
/** The Make button on the last step. */
async function makeButton(page: Page, name: string | RegExp) {
  await makeStep(page, 'Check & make');
  return page.locator('.app-window[data-app="make"]').getByRole('button', { name, exact: typeof name === 'string' });
}

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
  // An AI machine without the meme lab (tests that want it add their own route).
  await page.route('**/fake-ai/_orbit/studio/lab**', (route) => route.fulfill({ status: 404, json: { error: 'Not found' } }));
  await page.route('**/fake-ai/_orbit/studio/jobs', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    if (/naked child/.test(String(body.prompt))) {
      return route.fulfill({ status: 422, json: { error: "This can't be made: sexual content involving minors is never allowed.", blocked: true } });
    }
    // Swap a person refuses children (the AI machine's rule, studio.js).
    if (body.maker === 'person-swap' && /\b(kid|child|girl|boy|teen\w*)\b/.test(String(body.target))) {
      return route.fulfill({ status: 422, json: { error: "Swap a person only works with adults: it can't swap a child or a teenager, in the video or from a photo.", blocked: true } });
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
    // The video makers, already on the machine.
    { id: 'ltx-25', kind: 'video', name: 'LTX-2.5', blurb: 'Newest LTX.', for: null, twoImages: false, accepts: ['photo', 'endPhoto', 'video'], needs: [], gated: true, needsToken: false, builtIn: false, wanted: true, installed: true, size: 39.7e9, percent: 100 },
    { id: 's2v', kind: 'video', name: 'Talking photo', blurb: 'A photo and a voice.', for: null, twoImages: false, needs: ['photo', 'audio'], builtIn: false, wanted: true, installed: true, size: 25e9, percent: 100 },
    { id: 'vace', kind: 'videoedit', name: 'Wan VACE', blurb: 'Edit a video.', for: null, twoImages: false, needs: ['video'], tasks: ['replace', 'restyle', 'extend', 'motion'], builtIn: false, wanted: true, installed: true, size: 43.7e9, percent: 100 },
    { id: 'video-erase', kind: 'videoedit', name: 'Erase from video', blurb: 'Remove a thing.', for: null, twoImages: false, needs: ['video', 'target'], builtIn: false, wanted: true, installed: true, size: 43.7e9, percent: 100 },
    { id: 'person-swap', kind: 'videoedit', name: 'Swap a person', blurb: 'Put someone from your photo in place of a person in your video.', for: null, twoImages: false, needs: ['video', 'target', 'photo'], accepts: ['facePhoto'], builtIn: false, wanted: true, installed: true, size: 23.7e9, percent: 100 },
    { id: 'video-sharpen', kind: 'videoedit', name: 'Sharpen video', blurb: 'Twice as large.', for: null, twoImages: false, needs: ['video'], builtIn: false, wanted: true, installed: true, size: 4e9, percent: 100 },
  ];
  const makerCalls: string[] = [];
  // Videos and sounds sent for the video makers (the raw file, its type as content-type).
  const uploads: { type: string; size: number }[] = [];
  await page.route('**/fake-ai/_orbit/studio/uploads', async (route) => {
    const req = route.request();
    const type = (await req.headerValue('content-type')) || '';
    uploads.push({ type, size: req.postDataBuffer()?.length ?? 0 });
    return route.fulfill({ json: { id: `u${type.startsWith('audio') ? 'aud' : 'vid'}${uploads.length}`, kind: type.startsWith('audio') ? 'audio' : 'video', size: 10 } });
  });
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
  return { items, requests, makers, makerCalls, uploads };
}

async function openCreate(page: Page) {
  await openMakeApp(page);
}

test.describe('AI app: Create', () => {
  test('lab: watch what it makes, cancel it, set topics, reorder and add ideas, keep a video', async ({ page }, testInfo) => {
    await mockAi(page, 'on');
    const studio = await mockStudio(page);
    const rec = (id: string, title: string, score: number | null, status: string) => ({
      id, title, score, status, url: `/_orbit/studio/file/${id}?t=tok`, prompt: `${title} prompt`, caption: `${title} caption`, hashtags: ['#comedy', '#fyp'], seconds: 5,
      createdAt: '2026-10-20T10:00:00Z', why: score ? 'Hook lands in the first second.' : 'No chat model is installed to judge it.',
    });
    const idea = (id: string, title: string, topic: string | null = null, yours = false) => ({ id, title, prompt: `${title} prompt`, topic, yours });
    const lab = {
      enabled: true, topics: ['office life'] as string[], quietMinutes: 0, readyScore: 75, minutesPerVideo: 6, minutesLeft: 48, madeLastHour: 2, lastError: null as string | null,
      making: { title: 'Grandma discovers bubble tea', topic: null, prompt: 'x', job: { id: 'lab9', kind: 'video', prompt: 'x', status: 'running', progress: 42, etaSeconds: 180, error: null, createdAt: '', item: null } } as unknown,
      queue: [idea('q1', 'The goose clocks in', 'office life'), idea('q2', 'Printer betrayal', 'office life'), idea('q3', 'Reply-all disaster', 'office life')],
      records: [rec('m1', 'The goose has a 9-to-5', 62, 'judged'), rec('m2', 'Nobody: … the capybara:', 91, 'ready')],
    };
    const calls: string[] = [];
    await page.route('**/fake-ai/_orbit/studio/lab**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const p = url.pathname.replace(/.*\/_orbit\/studio/, '');
      calls.push(`${method} ${p}`);
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      if (method === 'POST' && p === '/lab') {
        if (typeof body.enabled === 'boolean') lab.enabled = body.enabled;
        if (Array.isArray(body.topics)) lab.topics = body.topics as string[];
      }
      if (p === '/lab/cancel') lab.making = null;
      if (p === '/lab/queue' && method === 'POST') lab.queue.unshift(idea('q9', String(body.prompt), null, true));
      const q = /^\/lab\/queue\/(\w+)(\/next)?$/.exec(p);
      if (q && method === 'DELETE') lab.queue = lab.queue.filter((x) => x.id !== q[1]);
      if (q && q[2]) lab.queue.unshift(...lab.queue.splice(lab.queue.findIndex((x) => x.id === q[1]), 1));
      const keep = /^\/lab\/(\w+)\/keep$/.exec(p);
      if (keep) {
        const r = lab.records.find((x) => x.id === keep[1])!;
        lab.records = lab.records.filter((x) => x.id !== keep[1]);
        studio.items.unshift({ id: r.id, kind: 'video', prompt: r.prompt, width: 704, height: 1280, seconds: 5, createdAt: r.createdAt, url: r.url });
      }
      return route.fulfill({ json: lab });
    });
    const errors = await openOrbit(page);
    const section = (await openApp(page, 'lab')).getByRole('region', { name: 'Lab' });

    const now = section.getByRole('status', { name: 'Making now' });
    await expect(now).toContainText('Grandma discovers bubble tea');
    await expect(now).toContainText('about 3 min left');
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('lab.png') });
    await now.getByRole('button', { name: 'Cancel' }).click();
    await expect(section.getByText('Starting the next one as soon as the machine is free.')).toBeVisible();
    expect(calls).toContain('POST /lab/cancel');

    await section.getByRole('textbox', { name: 'New topic' }).fill('my cat Luna');
    await section.getByRole('textbox', { name: 'New topic' }).press('Enter');
    await expect(section.getByRole('list', { name: 'Topics' }).getByRole('listitem')).toHaveCount(2);
    await section.getByRole('button', { name: 'Remove topic office life' }).click();
    await expect(section.getByRole('list', { name: 'Topics' }).getByRole('listitem')).toHaveCount(1);
    expect(lab.topics).toEqual(['my cat Luna']);

    const upNext = section.getByRole('list', { name: 'Up next' });
    await expect(upNext.getByRole('listitem')).toHaveCount(3);
    await upNext.getByRole('button', { name: 'Make Reply-all disaster next' }).click();
    await expect(upNext.getByRole('listitem').first()).toContainText('Reply-all disaster');
    await upNext.getByRole('button', { name: 'Remove Printer betrayal' }).click();
    await expect(upNext.getByRole('listitem')).toHaveCount(2);
    await section.getByRole('textbox', { name: 'Your own idea' }).fill('A cat sees a cucumber and leaps');
    await section.getByRole('textbox', { name: 'Your own idea' }).press('Enter');
    await expect(upNext.getByRole('listitem').first()).toContainText('Your idea, made as written');

    // The Lab gallery is the Make gallery: tiles, best first; a tap opens the viewer with the score.
    const gallery = section.getByRole('list', { name: 'Lab movies, best first' });
    await expect(gallery.getByRole('listitem').first()).toContainText('91');
    await gallery.getByRole('button', { name: 'Video: Nobody: … the capybara:' }).click();
    const viewer = page.getByRole('dialog', { name: 'Lab movie' });
    await expect(viewer.getByRole('region', { name: 'Scouting report' })).toContainText('Ready to post');
    await viewer.getByRole('button', { name: 'Keep in my gallery' }).click();
    await expect(viewer).toHaveCount(0);
    await expect(gallery.getByRole('listitem')).toHaveCount(1);
    expect(calls).toContain('POST /lab/m2/keep');

    await section.getByRole('switch', { name: 'Make comedy movies while the machine is on' }).click();
    await expect.poll(() => lab.enabled).toBe(false);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('make an image: progress, then it lands in the gallery; fits and is tappable', async ({ page }, testInfo) => {
    await mockAi(page, 'on');
    const studio = await mockStudio(page);
    const errors = await openOrbit(page);
    await openCreate(page);
    const gallery = page.getByRole('list', { name: 'Your creations' });
    await openMakeGallery(page);
    await expect(gallery.getByRole('listitem')).toHaveCount(2);
    await closeMakeGallery(page);

    await describe(page, 'a lighthouse in a storm');
    await makeStep(page, 'Extras');
    await page.getByRole('group', { name: 'Shape' }).getByRole('button', { name: 'Portrait' }).click();
    await (await makeButton(page, 'Make image')).click();
    await expect(page.getByRole('list', { name: 'In progress' })).toBeVisible();
    await openMakeGallery(page);
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
    await pickKind(page, 'video');
    await makeStep(page, 'Extras');
    await page.locator('.ai-create input[type="file"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('img', { name: 'Starting photo' })).toBeVisible();
    await page.getByRole('group', { name: 'Length' }).getByRole('button', { name: '8 s' }).click();
    await page.getByRole('group', { name: 'Shape' }).getByRole('button', { name: 'Portrait' }).click();
    await describe(page, 'she turns and waves');
    await (await makeButton(page, 'Make video')).click();
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
    await openMakeGallery(page);
    await page.getByRole('button', { name: 'Image: a red fox in snow' }).click();
    const sheet = page.getByRole('dialog', { name: 'Image' });
    await expect(sheet.getByRole('img', { name: 'a red fox in snow' })).toBeVisible();
    const save = sheet.getByRole('link', { name: 'Save' });
    await expect(save).toHaveAttribute('href', /\/fake-ai\/_orbit\/studio\/file\/img1\?t=tok&download=1$/);
    await expectNoHorizontalOverflow(page);
    await sheet.getByRole('button', { name: 'Make it move' }).click();
    // Back in the steps, on the words: say how it should move.
    await expect(page.getByRole('textbox', { name: 'Describe it' })).toBeVisible();
    await makeStep(page, 'Extras');
    await expect(page.getByRole('img', { name: 'Starting photo' })).toBeVisible();
    await makeStep(page, 'What');
    await expect(kindRadio(page, 'video')).toHaveAttribute('aria-checked', 'true');

    await openMakeGallery(page);
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
    await describe(page, 'naked child');
    await (await makeButton(page, 'Make image')).click();
    await expect(page.getByText('sexual content involving minors is never allowed')).toBeVisible();
  });

  const twoItems = {
    items: [
      { id: 'flag1', kind: 'image', prompt: 'a quiet portrait by the window', nsfw: true, width: 1328, height: 1328, createdAt: '2026-10-16T10:00:00Z', url: '/_orbit/studio/file/flag1?t=tok' },
      { id: 'safe1', kind: 'image', prompt: 'a red fox in snow', nsfw: false, width: 1328, height: 1328, createdAt: '2026-10-16T09:00:00Z', url: '/_orbit/studio/file/safe1?t=tok' },
    ],
  };

  test('NSFW: a picture the AI machine flagged is hidden until "Show NSFW" is on, then blurred until held', async ({ page }) => {
    await mockAi(page, 'on');
    await mockStudio(page);
    await page.route('**/fake-ai/_orbit/studio/items', (route) => route.fulfill({ json: twoItems }));
    await openOrbit(page);
    await openCreate(page);
    await openMakeGallery(page);
    const win = page.locator('.app-window[data-app="make"]');
    const fox = win.getByRole('button', { name: 'Image: a red fox in snow' });
    const portrait = win.getByRole('button', { name: 'Image: a quiet portrait by the window' });
    await expect(fox).toBeVisible();
    await expect(portrait).toHaveCount(0);
    // The switch lives in Settings, not in the gallery.
    await expect(win.getByRole('switch', { name: 'Show NSFW' })).toHaveCount(0);
    await setShowNsfw(page, true);
    await expect(portrait).toBeVisible();
    // The second layer: blurred, the fox isn't.
    expect(await portrait.evaluate((el) => getComputedStyle(el).filter)).toContain('blur');
    expect(await fox.evaluate((el) => getComputedStyle(el).filter)).toBe('none');
    const tile = win.locator('.ai-gallery .censor');
    await expect(tile).toHaveCount(1);
    await expect(tile).toContainText('NSFW');
    // Hold to see; let go and it blurs again; a hold doesn't open it.
    await tile.scrollIntoViewIfNeeded();
    const tb = (await tile.boundingBox())!;
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.mouse.down();
    await expect(tile).toHaveAttribute('data-revealed', '');
    expect(await portrait.evaluate((el) => getComputedStyle(el).filter)).toBe('none');
    await page.mouse.up();
    await expect(tile).not.toHaveAttribute('data-revealed', '');
    await expect(win.getByRole('dialog')).toHaveCount(0);
    // A tap opens it, blurred there too.
    await portrait.click();
    await expect(win.getByRole('switch', { name: 'NSFW', exact: true })).toBeChecked();
    await expect(win.locator('.ai-viewer-media.censor')).toBeVisible();
    await page.keyboard.press('Escape');
    // Off again: hidden again.
    await setShowNsfw(page, false);
    await expect(portrait).toHaveCount(0);
    await expectTappable(page);
    // Left on, it still doesn't outlive the visit: opening Orbit again starts hidden.
    await setShowNsfw(page, true);
    await expect(portrait).toBeVisible();
    await page.reload();
    // A fresh visit: the switch is off again.
    await expect(win.or(indexButton(page)).first()).toBeVisible();
    await openMakeApp(page);
    await openMakeGallery(page);
    await expect(portrait).toHaveCount(0);
  });

  test('NSFW: hold a picture to hide it; with "Show NSFW" on, the viewer switch unhides one; both saved on the AI machine', async ({ page }) => {
    await mockAi(page, 'on');
    await mockStudio(page);
    await page.route('**/fake-ai/_orbit/studio/items', (route) => route.fulfill({ json: twoItems }));
    const marks: { id: string; nsfw: unknown }[] = [];
    await page.route(/\/fake-ai\/_orbit\/studio\/items\/[^/]+\/nsfw$/, async (route) => {
      const id = route.request().url().split('/').slice(-2)[0];
      marks.push({ id, nsfw: route.request().postDataJSON().nsfw });
      await route.fulfill({ json: { ok: true } });
    });
    await openOrbit(page);
    await openCreate(page);
    await openMakeGallery(page);
    const win = page.locator('.app-window[data-app="make"]');
    const fox = win.getByRole('button', { name: 'Image: a red fox in snow' });
    const portrait = win.getByRole('button', { name: 'Image: a quiet portrait by the window' });

    // The fox slipped through: hold it and it hides (the hold doesn't open it).
    await fox.scrollIntoViewIfNeeded();
    const box = (await fox.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(fox).toHaveCount(0, { timeout: 3000 });
    await page.mouse.up();
    await expect(win.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => marks).toContainEqual({ id: 'safe1', nsfw: true });
    await expect(win.getByText(/NSFW results are hidden/)).toBeVisible();

    // Show NSFW: both show. The portrait was flagged by mistake: open it, turn off "NSFW".
    await setShowNsfw(page, true);
    await expect(fox).toBeVisible();
    await portrait.click();
    const sw = win.getByRole('switch', { name: 'NSFW', exact: true });
    await expect(sw).toBeChecked();
    await sw.click();
    await expect(sw).not.toBeChecked();
    await expect.poll(() => marks).toContainEqual({ id: 'flag1', nsfw: false });
    await page.keyboard.press('Escape');

    // Hide again: the portrait stays (not NSFW now), the fox hides.
    await setShowNsfw(page, false);
    await expect(portrait).toBeVisible();
    await expect(fox).toHaveCount(0);
  });

  test('Make gallery: reloading it (a new picture lands, coming back to Make) keeps the same files and tiles', async ({ page }) => {
    await mockAi(page, 'on');
    await mockStudio(page);
    // A fresh signed link for every file on every listing, like the real machine.
    let n = 0;
    await page.route('**/fake-ai/_orbit/studio/items', (route) => {
      n++;
      return route.fulfill({
        json: {
          items: [
            { id: 'img1', kind: 'image', prompt: 'a red fox in snow', width: 1328, height: 1328, createdAt: '2026-10-16T10:00:00Z', url: `/_orbit/studio/file/img1?t=tok${n}` },
            { id: 'vid1', kind: 'video', prompt: 'waves at sunset', width: 1280, height: 720, seconds: 5, createdAt: '2026-10-16T09:00:00Z', url: `/_orbit/studio/file/vid1?t=tok${n}`, thumbUrl: `/_orbit/studio/thumb/vid1?t=tok${n}` },
          ],
        },
      });
    });
    await page.route('**/fake-ai/_orbit/studio/thumb/**', (route) =>
      route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') }),
    );
    await openOrbit(page);
    await openCreate(page);
    await openMakeGallery(page);
    const win = page.locator('.app-window[data-app="make"]');
    const fox = win.getByRole('button', { name: 'Image: a red fox in snow' });
    await expect(fox).toBeVisible();
    const img = () => fox.locator('img').getAttribute('src');
    // A video tile is its thumbnail (no video plays in the grid).
    const vid = () => win.getByRole('button', { name: 'Video: waves at sunset' }).locator('img').getAttribute('src');
    const [img0, vid0] = [await img(), await vid()];
    await win.locator('.ai-gallery li').first().evaluate((el) => el.setAttribute('data-probe', 'kept'));
    const before = n;
    // Go to the AI app and back: the gallery is listed again.
    await openApp(page, 'ai');
    await openApp(page, 'make');
    await expect.poll(() => n).toBeGreaterThan(before);
    await page.waitForTimeout(500);
    expect(await img()).toBe(img0);
    expect(await vid()).toBe(vid0);
    // Same tile, not a rebuilt one.
    await expect(win.locator('.ai-gallery li[data-probe="kept"]')).toHaveCount(1);
  });

  test('NSFW: a new NSFW picture is hidden as soon as it lands; Show NSFW shows it blurred', async ({ page }) => {
    await mockAi(page, 'on');
    await mockStudio(page);
    await openOrbit(page);
    await openCreate(page);
    const win = page.locator('.app-window[data-app="make"]');
    await describe(page, 'a topless woman on a beach');
    await (await makeButton(page, 'Make image')).click();
    await openMakeGallery(page);
    const made = win.getByRole('button', { name: 'Image: a topless woman on a beach' });
    // The fox and the sunset still show; the new one doesn't.
    await expect(win.getByRole('button', { name: 'Image: a red fox in snow' })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    await expect(made).toHaveCount(0);
    await setShowNsfw(page, true);
    await expect(made).toBeVisible({ timeout: 10_000 });
    expect(await made.evaluate((el) => getComputedStyle(el).filter)).toContain('blur');
  });
});

// ---- Full motion: the chat's personality

test.describe('AI app with full motion', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('messages come up out of the page, the send button launches, the orb reacts to typing, pictures develop', async ({ page }, testInfo) => {
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
    // Orbit 0.5: messages rise out of the page and sink away at the top edge as they scroll.
    expect(await user.evaluate((el) => getComputedStyle(el).animationName)).toBe('o5-depth');
    await expect(page.getByText('Done.')).toBeVisible();
    expect(await page.locator('.ai-msg-assistant').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('o5-depth');
    await expectNoHorizontalOverflow(page);
    // The open animation has finished: no leftover transform, the window fills the screen.
    await expect.poll(() => page.locator('.app-window[data-app="ai"]').evaluate((el) => getComputedStyle(el).transform), { timeout: 4000 }).toBe('none');
    expect(await page.locator('.app-window[data-app="ai"]').evaluate((el) => Math.round(el.getBoundingClientRect().left))).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('ai-chat-full-motion.png') });

    // Make: pictures start undeveloped and sharpen once loaded; tiles bounce in.
    await openMakeApp(page);
    await openMakeGallery(page);
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
    await typeAndSend(page, 'What is in these?');
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

    // Your message's actions show once you tap it.
    await page.locator('.ai-msg-user .ai-user-text').first().click();
    await page.locator('.ai-msg-user').first().getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByText(/Editing your message/)).toBeVisible();
    await expectValue(page.getByRole('textbox', { name: 'Message' }), 'First try');
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
    await typeAndSend(page, 'Write about the sea');
    await expect(page.locator('.ai-msg-assistant').last()).toContainText('first draft');
    await page.locator('.ai-msg-assistant').getByRole('button', { name: 'Canvas' }).click();
    const doc = page.getByRole('textbox', { name: 'Document' });
    await expectValue(doc, 'A long first draft about the sea.');
    await recordChats(page, 'Short sea poem.');
    await page.getByRole('button', { name: 'Shorter' }).click();
    await expectValue(doc, 'Short sea poem.');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expectValue(doc, 'A long first draft about the sea.');
    await doc.fill('My own edit.');
    await page.getByRole('button', { name: 'Put back in chat' }).click();
    await expect(page.locator('.ai-msg-assistant').last()).toContainText('My own edit.');
  });

  test('personas and memory shape every chat', async ({ page }) => {
    await mockAi(page, 'on');
    const bodies = await recordChats(page);
    await openOrbit(page);
    await openAi(page);
    await aiMenu(page, 'Personas & memory');
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
    // Remember straight from a message (tap it for its actions).
    await page.locator('.ai-msg-user .ai-user-text').click();
    await page.locator('.ai-msg-user').getByRole('button', { name: 'Remember' }).click();
    await expect(page.getByText('Remembered for future chats.')).toBeVisible();
  });

  test('picture from chat: the image maker answers in the conversation', async ({ page }) => {
    await mockAi(page, 'on');
    const studio = await mockStudio(page);
    await openOrbit(page);
    await openAi(page);
    await showTools(page);
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
    await showTools(page);
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
  test('makers stay put while Make and the Store refresh (no reloading, no reordering, no flicker)', async ({ page }) => {
    await mockAi(page, 'on');
    const studio = await mockStudio(page);
    let calls = 0;
    // Every refresh answers with fresh objects (as the real machine does), one maker still downloading.
    await page.route('**/fake-ai/_orbit/studio/makers', (route) => {
      calls++;
      const list = studio.makers.map((m) => ({ ...m }));
      const dl = list.find((m) => !m.installed);
      if (dl) Object.assign(dl, { wanted: true, percent: Math.min(99, 10 + calls) });
      return route.fulfill({ json: { makers: list } });
    });
    await openOrbit(page);
    await openMakeApp(page);
    const picks = await makerPicks(page);
    await expect(picks.getByRole('radio').first()).toBeVisible();
    await page.waitForTimeout(600);
    const names = async () => picks.getByRole('radio').allTextContents();
    const before = await names();
    await picks.getByRole('radio').evaluateAll((els) => els.forEach((el) => el.setAttribute('data-probe', 'kept')));
    const seen = calls;
    await expect.poll(() => calls, { timeout: 15_000 }).toBeGreaterThan(seen + 1);
    await page.waitForTimeout(300);
    // The same chips, in the same order: only the download percent moves.
    expect((await names()).map((t) => t.replace(/\d+%/, '%'))).toEqual(before.map((t) => t.replace(/\d+%/, '%')));
    await expect(picks.locator('[role="radio"]:not([data-probe="kept"])')).toHaveCount(0);
  });

  test('a download that is not moving says why: in line, out of disk space, saving, or paused with the machine off', async ({ page }) => {
    await mockAi(page, 'on');
    const studio = await mockStudio(page);
    Object.assign(studio.makers.find((m) => m.id === 'h3-max')!, { wanted: true, percent: 40, status: 'waiting', waitingFor: 'wan2.2_i2v_high_noise.safetensors' });
    Object.assign(studio.makers.find((m) => m.id === 'krea-real')!, { wanted: true, percent: 12, status: 'disk', problem: 'Not enough disk space for krea.safetensors (3 GB free, needs about 21 GB). Remove a maker or a chat model you don\'t use.' });
    Object.assign(studio.makers.find((m) => m.id === 'sharpen')!, { wanted: true, percent: 100, status: 'saving' });
    // These downloads stay where they are (the shared mock finishes H3 Max on its second listing).
    await page.route('**/fake-ai/_orbit/studio/makers', (route) => route.fulfill({ json: { makers: studio.makers } }));
    await openOrbit(page);
    await openCreate(page);
    // Video: H3 Max is in line behind another file, and the note says which.
    await pickKind(page, 'video');
    const picks = page.getByRole('radiogroup', { name: 'Maker' });
    await expect(picks.getByRole('radio', { name: /H3 Max/ })).toContainText('40% · in line');
    await pickMaker(page, /H3 Max/);
    // The step says why (and so does the check before making).
    await makeStep(page, 'Maker & style');
    await expect(page.getByText('H3 Max is 40% done, waiting for wan2.2_i2v_high_noise.safetensors to finish first')).toBeVisible();
    await makeStep(page, 'Check & make');
    await expect(page.getByText('H3 Max is 40% done, waiting for wan2.2_i2v_high_noise.safetensors to finish first')).toBeVisible();
    // Image: Krea Real can't fit on the disk, and says so.
    await pickKind(page, 'image');
    await expect(picks.getByRole('radio', { name: /Krea Real/ })).toContainText('Disk full');
    await pickMaker(page, /Krea Real/);
    await makeStep(page, 'Maker & style');
    await expect(page.getByText(/Not enough disk space for krea\.safetensors \(3 GB free/)).toBeVisible();
    // The Store says the same.
    await page.getByRole('button', { name: 'Makers', exact: true }).click();
    const store = page.locator('.app-window[data-app="store"]');
    await expect(store.getByRole('status', { name: 'Adding Krea Real: Disk full' }).first()).toBeVisible();
    await expect(store.getByText('100% · saving').first()).toBeVisible();
  });

  test('install a new video maker, pick it, and the job uses it', async ({ page }) => {
    await mockAi(page, 'on');
    const studio = await mockStudio(page);
    await openOrbit(page);
    await openCreate(page);
    await pickKind(page, 'video');
    // Makers live in the Store app now.
    await page.getByRole('button', { name: 'Makers', exact: true }).click();
    const store = page.locator('.app-window[data-app="store"]');
    const video = store.getByRole('region', { name: 'Video', exact: true });
    await expect(video).toContainText('H3 Max');
    await video.getByRole('button', { name: 'Get H3 Max', exact: true }).click();
    expect(studio.makerCalls).toEqual(['install h3-max']);
    await expect(video.getByText('40%')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await openMakeApp(page);
    const picks = await makerPicks(page);
    await pickMaker(page, /H3 Max/);
    await makeStep(page, 'Maker & style');
    await expect(picks.getByRole('radio', { name: /H3 Max/ })).toHaveAttribute('aria-checked', 'true');
    // Ready once the download finishes (the next refresh).
    await describe(page, 'neon rain on a city street, synth music');
    const make = await makeButton(page, 'Make video');
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
    await openMakeGallery(page);
    await page.getByRole('button', { name: /^Image: a red fox in snow/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Edit' }).click();
    // Straight to the words.
    await page.getByRole('textbox', { name: 'Describe it' }).fill('make it night with a full moon');
    await makeStep(page, 'What');
    await expect(kindRadio(page, 'edit')).toHaveAttribute('aria-checked', 'true');
    await makeStep(page, 'Extras');
    await expect(page.getByRole('img', { name: 'Picture to edit' })).toBeVisible();
    await (await makeButton(page, 'Edit')).click();
    await expect.poll(() => studio.requests.length).toBe(1);
    expect(studio.requests[0]).toMatchObject({ kind: 'image', maker: 'edit', fromItem: 'img1', prompt: 'make it night with a full moon', images: [] });

    await pickMaker(page, 'Outfit swap');
    await describe(page, 'Dress the person in image 1 in the jacket from image 2.');
    const go = await makeButton(page, 'Edit');
    await expect(page.getByText('Add the person first, then the outfit.')).toBeVisible();
    await expect(go).toBeDisabled();
    await makeStep(page, 'Extras');
    await page.locator('.ai-edit-photos input[type=file]').setInputFiles({ name: 'jacket.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('img', { name: 'The outfit' })).toBeVisible();
    await makeStep(page, 'Check & make');
    await expect(go).toBeEnabled();
    await expect(page.getByText('Edits take under a minute.')).toBeVisible();
    await go.click();
    await expect.poll(() => studio.requests.length).toBe(2);
    expect(studio.requests[1]).toMatchObject({ maker: 'outfit', fromItem: 'img1' });
    expect((studio.requests[1].images as string[]).length).toBe(1);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('AI app: video makers', () => {
  const MP4 = Buffer.from('fake mp4 bytes');
  const M4A = Buffer.from('fake m4a bytes');

  test('a gallery video: Edit this video replaces a thing named in words', async ({ page }, testInfo) => {
    await mockAi(page, 'on');
    const studio = await mockStudio(page);
    const errors = await openOrbit(page);
    await openCreate(page);
    await openMakeGallery(page);
    await page.getByRole('button', { name: 'Video: waves at sunset' }).click();
    const sheet = page.getByRole('dialog', { name: 'Video' });
    for (const name of ['Edit this video', 'Erase from video', 'Sharpen video']) await expect(sheet.getByRole('button', { name })).toBeVisible();
    await sheet.getByRole('button', { name: 'Edit this video' }).click();
    // Back to the maker step, to pick what to do.
    await expect(page.getByRole('radiogroup', { name: 'What to do' })).toBeVisible();
    await makeStep(page, 'What');
    await expect(kindRadio(page, 'vedit')).toHaveAttribute('aria-checked', 'true');
    await makeStep(page, 'Extras');
    await expect(page.locator('video[aria-label="Video to work on"]')).toBeVisible();
    const make = await makeButton(page, 'Edit video');
    await expect(make).toBeDisabled();
    await makeStep(page, 'Describe it');
    await page.getByRole('textbox', { name: 'What to replace' }).fill('the boat');
    await page.getByRole('textbox', { name: 'Describe it' }).fill('a giant whale');
    await makeStep(page, 'Check & make');
    await expect(make).toBeEnabled();
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);
    await page.screenshot({ path: testInfo.outputPath('video-edit.png') });
    await make.click();
    await expect.poll(() => studio.requests.length).toBe(1);
    expect(studio.requests[0]).toMatchObject({ kind: 'video', maker: 'vace', videoItem: 'vid1', task: 'replace', target: 'the boat', prompt: 'a giant whale' });

    // Restyle needs no words naming a thing; Move a photo needs a photo.
    const tasks = page.getByRole('radiogroup', { name: 'What to do' });
    await makeStep(page, 'Maker & style');
    await tasks.getByRole('radio', { name: 'Restyle' }).click();
    await makeStep(page, 'Describe it');
    await expect(page.getByRole('textbox', { name: 'What to replace' })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Describe it' }).fill('a watercolour painting');
    await makeStep(page, 'Check & make');
    await make.click();
    await expect.poll(() => studio.requests.length).toBe(2);
    expect(studio.requests[1]).toMatchObject({ maker: 'vace', task: 'restyle', videoItem: 'vid1' });
    expect(studio.requests[1].target).toBeUndefined();
    await makeStep(page, 'Maker & style');
    await tasks.getByRole('radio', { name: 'Move a photo' }).click();
    await makeStep(page, 'Check & make');
    await expect(make).toBeDisabled();
    await makeStep(page, 'Extras');
    await page.locator('input[aria-label="Picture for the video edit"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('img', { name: 'Who should move' })).toBeVisible();
    await makeStep(page, 'Check & make');
    await make.click();
    await expect.poll(() => studio.requests.length).toBe(3);
    expect(studio.requests[2]).toMatchObject({ maker: 'vace', task: 'motion' });
    expect(String(studio.requests[2].image)).toMatch(/^data:image\/jpeg;base64,/);
    expect(errors).toEqual([]);
  });

  test('erase from an uploaded video, and sharpen a gallery video', async ({ page }) => {
    await mockAi(page, 'on');
    const studio = await mockStudio(page);
    await openOrbit(page);
    await openCreate(page);
    await pickKind(page, 'vedit');
    await pickMaker(page, 'Erase from video');
    await makeStep(page, 'Extras');
    await page.locator('input[aria-label="Video file"]').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: MP4 });
    await expect(page.locator('video[aria-label="Video to work on"]')).toBeVisible();
    expect(studio.uploads).toEqual([{ type: 'video/mp4', size: MP4.length }]);
    await makeStep(page, 'Describe it');
    await expect(page.getByRole('textbox', { name: 'Describe it' })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'What to erase' }).fill('the watermark in the corner');
    await (await makeButton(page, 'Erase it')).click();
    await expect.poll(() => studio.requests.length).toBe(1);
    expect(studio.requests[0]).toMatchObject({ kind: 'video', maker: 'video-erase', videoUpload: 'uvid1', target: 'the watermark in the corner', prompt: '' });
    await expectNoHorizontalOverflow(page);

    await openMakeGallery(page);
    await page.getByRole('button', { name: 'Video: waves at sunset' }).click();
    await page.getByRole('dialog', { name: 'Video' }).getByRole('button', { name: 'Sharpen video' }).click();
    // No words needed: straight to the check, and the describe step is left out.
    await expect(page.locator('.app-window[data-app="make"]').getByRole('navigation', { name: 'Make, step by step' }).getByRole('button')).toHaveCount(4);
    await (await makeButton(page, 'Sharpen video')).click();
    await expect.poll(() => studio.requests.length).toBe(2);
    expect(studio.requests[1]).toMatchObject({ kind: 'video', maker: 'video-sharpen', videoItem: 'vid1' });
  });

  test('swap a person: the video, who to replace (talk or fill), the new person’s photo and a face close-up', async ({ page }, testInfo) => {
    await mockAi(page, 'on');
    const studio = await mockStudio(page);
    const errors = await openOrbit(page);
    await openCreate(page);
    // Screenshots of each step (MAKE_SHOTS_DIR: also kept in that folder, from the iPhone run).
    const shot = async (name: string) => {
      const dir = process.env.MAKE_SHOTS_DIR;
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
      if (dir && testInfo.project.name === 'iphone-portrait') await page.screenshot({ path: `${dir}/${name}.png` });
    };
    const win = page.locator('.app-window[data-app="make"]');
    const dots = win.getByRole('navigation', { name: 'Make, step by step' }).getByRole('button');
    await pickKind(page, 'vedit');
    await expect((await makerPicks(page)).getByRole('radio', { name: 'Swap a person' })).toBeVisible();
    await (await makerPicks(page)).getByRole('radio', { name: 'Swap a person' }).click();
    // Straight on to the video: it gets a step of its own, and the others are named for what they hold.
    await expect(dots.filter({ hasText: 'The video' })).toHaveAttribute('aria-current', 'step');
    await expect(dots).toHaveText(['01What', '02Maker & style', '03The video', '04Who to replace', '05The new person', '06Check & make']);
    await makeStep(page, 'Maker & style');
    await expect(win.getByText('Put someone from your photo in place of a person in your video.')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'What to do' })).toHaveCount(0);
    await shot('swap-1-maker');

    await makeStep(page, 'The video');
    await expect(win.getByText('The person to replace should be in its first frame.', { exact: false })).toBeVisible();
    await shot('swap-2-video');
    await page.locator('input[aria-label="Video file"]').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: MP4 });
    await expect(page.locator('video[aria-label="Video to work on"]')).toBeVisible();
    expect(studio.uploads).toEqual([{ type: 'video/mp4', size: MP4.length }]);

    await makeStep(page, 'Who to replace');
    await expect(page.getByRole('textbox', { name: 'Describe it' })).toHaveCount(0);
    const who = page.getByRole('textbox', { name: 'Who to replace' });
    await expect(page.getByRole('button', { name: 'Hold to talk: who to replace' })).toBeVisible();
    // Fill for me: an idea naming a person.
    await page.getByRole('button', { name: 'Fill for me' }).click();
    await expectNotValue(who, '');
    await who.fill('the man in the red jacket');
    await shot('swap-3-who');

    const make = await makeButton(page, 'Swap the person');
    await expect(make).toBeDisabled();
    await expect(win.getByRole('status').filter({ hasText: 'Add a photo of the new person.' })).toBeVisible();
    await makeStep(page, 'The new person');
    await page.locator('input[aria-label="Photo of the new person"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('img', { name: 'The new person' })).toBeVisible();
    await page.locator('input[aria-label="Face close-up"]').setInputFiles({ name: 'face.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('img', { name: 'Their face, close up' })).toBeVisible();
    await expect(win.getByText('children can’t be swapped', { exact: false })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot('swap-4-new-person');

    await makeStep(page, 'Check & make');
    const summary = win.getByRole('list', { name: 'Your choices' });
    await expect(summary).toContainText('Your video');
    await expect(summary).toContainText('Replace the man in the red jacket');
    await expect(summary).toContainText('A photo of them · a face close-up');
    await expect(make).toBeEnabled();
    await expectNoHorizontalOverflow(page);
    await shot('swap-5-check');
    await make.click();
    await expect.poll(() => studio.requests.length).toBe(1);
    const req = studio.requests[0];
    expect(req).toMatchObject({ kind: 'video', maker: 'person-swap', videoUpload: 'uvid1', target: 'the man in the red jacket', prompt: '' });
    expect(req.task).toBeUndefined();
    expect(String(req.image)).toMatch(/^data:image\/jpeg;base64,/);
    expect((req.images as string[]).map((s) => s.slice(0, 23))).toEqual(['data:image/jpeg;base64,']);

    // Children are refused, and it says why.
    await makeStep(page, 'Who to replace');
    await who.fill('the kid on the bike');
    await (await makeButton(page, 'Swap the person')).click();
    await expect(page.getByText('only works with adults', { exact: false })).toBeVisible();

    // From a gallery video: "Swap a person" goes straight to who to replace, with the video in.
    await openMakeGallery(page);
    await page.getByRole('button', { name: 'Video: waves at sunset' }).click();
    await page.getByRole('dialog', { name: 'Video' }).getByRole('button', { name: 'Swap a person' }).click();
    await expect(dots.filter({ hasText: 'Who to replace' })).toHaveAttribute('aria-current', 'step');
    await expectValue(who, '');
    await makeStep(page, 'The video');
    await expect(page.locator('video[aria-label="Video to work on"]')).toBeVisible();
    // (The browser logs the refusal's 422 itself; nothing else may go wrong.)
    expect(errors.filter((e) => !/status of 422/.test(e))).toEqual([]);
  });

  test('talking photo: a photo and a voice file; LTX-2.5 ends on a photo or restyles a video', async ({ page }) => {
    await mockAi(page, 'on');
    const studio = await mockStudio(page);
    await openOrbit(page);
    await openCreate(page);
    await pickKind(page, 'video');
    await pickMaker(page, 'Talking photo');
    await makeStep(page, 'Extras');
    await expect(page.getByRole('group', { name: 'Length' })).toHaveCount(0);
    const make = await makeButton(page, 'Make video');
    await expect(make).toBeDisabled();
    await makeStep(page, 'Extras');
    await page.locator('.ai-create input[type="file"][accept="image/*"]:not([aria-label])').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
    await page.locator('input[aria-label="Sound file"]').setInputFiles({ name: 'song.m4a', mimeType: 'audio/mp4', buffer: M4A });
    await expect(page.locator('audio[aria-label="Voice or song"]')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);
    await makeStep(page, 'Check & make');
    await expect(make).toBeEnabled();
    await make.click();
    await expect.poll(() => studio.requests.length).toBe(1);
    expect(studio.requests[0]).toMatchObject({ kind: 'video', maker: 's2v', audioUpload: 'uaud1' });
    expect(String(studio.requests[0].image)).toMatch(/^data:image\/jpeg;base64,/);

    await pickMaker(page, 'LTX-2.5');
    await makeStep(page, 'Extras');
    await page.locator('input[aria-label="Ending photo file"]').setInputFiles({ name: 'end.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('img', { name: 'Ending photo' })).toBeVisible();
    await describe(page, 'she walks to the window');
    await makeStep(page, 'Check & make');
    await make.click();
    await expect.poll(() => studio.requests.length).toBe(2);
    expect(studio.requests[1]).toMatchObject({ maker: 'ltx-25', prompt: 'she walks to the window' });
    expect(String(studio.requests[1].endImage)).toMatch(/^data:image\/jpeg;base64,/);

    // Restyle a video: no start or end photo, the video's own shape and length.
    await makeStep(page, 'Extras');
    await page.getByRole('button', { name: 'Remove the ending photo' }).click();
    await page.getByRole('button', { name: 'Remove the starting photo' }).click();
    await page.locator('input[aria-label="Video file"]').setInputFiles({ name: 'clip.mov', mimeType: 'video/quicktime', buffer: MP4 });
    await page.getByRole('group', { name: 'How much to change' }).getByRole('button', { name: 'A little' }).click();
    await describe(page, 'as a claymation');
    await makeStep(page, 'Check & make');
    await make.click();
    await expect.poll(() => studio.requests.length).toBe(3);
    expect(studio.requests[2]).toMatchObject({ maker: 'ltx-25', videoUpload: expect.stringMatching(/^uvid/), change: 'little', prompt: 'as a claymation' });
    expect(studio.requests[2].endImage).toBeUndefined();
  });
});
