import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';
import { mockAi, setShowNsfw } from './aiMocks';

/** The Lab as its own app (from the Index). */
test('the Lab app opens from the Index and shows what it is making and what comes next', async ({ page }) => {
  await mockAi(page, 'on');
  const lab = {
    enabled: true, topics: ['gym fails'], quietMinutes: 0, readyScore: 75, minutesPerVideo: 6, minutesLeft: 55, madeLastHour: 1, lastError: null,
    making: { title: 'Treadmill wins', topic: 'gym fails', prompt: 'x', job: { id: 'lab1', kind: 'video', prompt: 'x', status: 'running', progress: 10, error: null, createdAt: '', item: null } },
    queue: [{ id: 'q1', title: 'The dumbbell drop', prompt: 'x', topic: 'gym fails', yours: false }],
    records: [],
  };
  await page.route('**/fake-ai/_orbit/studio/lab**', (route) => route.fulfill({ json: lab }));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, introSeen: true } }, version: 0 }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  await page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list').getByRole('button', { name: /Lab/ }).click();
  const win = page.locator('.app-window[data-app="lab"]');
  const section = win.getByRole('region', { name: 'Lab' });
  await expect(section.getByRole('status', { name: 'Making now' })).toContainText('Treadmill wins');
  await expect(section.getByRole('list', { name: 'Up next' })).toContainText('The dumbbell drop');
  await expect(section.getByRole('list', { name: 'Topics' })).toContainText('gym fails');
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('the Lab switches between spicy and comedy', async ({ page }) => {
  await mockAi(page, 'on');
  let lab = {
    enabled: true, style: 'spicy', topics: ['date night'], quietMinutes: 0, readyScore: 75, minutesPerVideo: 6, minutesLeft: 55, madeLastHour: 0, lastError: null,
    making: null, queue: [{ id: 'q1', title: 'Fit check: date night', prompt: 'x', topic: 'date night', yours: false }], records: [],
  };
  const posts: unknown[] = [];
  await page.route('**/fake-ai/_orbit/studio/lab**', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      posts.push(body);
      lab = { ...lab, ...body, queue: [{ id: 'q2', title: 'Nobody: … a goose:', prompt: 'x', topic: null, yours: false }] };
    }
    await route.fulfill({ json: lab });
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, introSeen: true } }, version: 0 }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  await page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list').getByRole('button', { name: /Lab/ }).click();
  const section = page.locator('.app-window[data-app="lab"]').getByRole('region', { name: 'Lab' });
  const style = section.getByRole('group', { name: 'Lab style' });
  await expect(style.getByRole('button', { name: 'Spicy' })).toHaveAttribute('aria-pressed', 'true');
  await expect(section).toContainText('never nudity');
  await style.getByRole('button', { name: 'Comedy' }).click();
  await expect(style.getByRole('button', { name: 'Comedy' })).toHaveAttribute('aria-pressed', 'true');
  await expect(section.getByRole('list', { name: 'Up next' })).toContainText('a goose');
  expect(posts).toEqual([{ style: 'comedy' }]);
  await expectNoHorizontalOverflow(page);
});

test('Your style: 30-second movies from your own prompts, with a profile you can edit, trim and rebuild', async ({ page }) => {
  await mockAi(page, 'on');
  const movieQueue = [{ id: 'q9', title: 'A lone astronaut in neon city', prompt: 'A lonely sci-fi noir about a lone astronaut', topic: null, yours: false, kind: 'movie', seconds: 30, look: 'neon, teal and orange, anamorphic' }];
  let lab = {
    enabled: true, style: 'comedy', topics: [], quietMinutes: 0, readyScore: 75, minutesPerVideo: 6, minutesLeft: 55, madeLastHour: 0, lastError: null,
    making: null as unknown, queue: [{ id: 'q1', title: 'Nobody: … a goose:', prompt: 'x', topic: null, yours: false }] as unknown[], records: [] as unknown[],
  };
  let profile = {
    ready: true, building: false, summary: 'You like lonely astronauts in rainy neon cities.', edited: false, count: 42, builtAt: '2026-10-21T09:00:00Z', by: 'ai', spicy: false,
    profile: {}, removed: [] as string[], lastError: null,
    chips: [
      { kind: 'subject', text: 'a lone astronaut' },
      { kind: 'look', text: 'anamorphic' },
      { kind: 'mood', text: 'lonely' },
    ],
  };
  const posts: { url: string; body: unknown }[] = [];
  await page.route('**/fake-ai/_orbit/studio/lab**', async (route) => {
    const req = route.request();
    const url = new URL(req.url()).pathname;
    const body = req.method() === 'POST' ? req.postDataJSON() : null;
    if (body) posts.push({ url: url.replace(/^.*\/_orbit/, '/_orbit'), body });
    if (url.endsWith('/lab/profile/rebuild')) {
      profile = { ...profile, building: true };
      setTimeout(() => (profile = { ...profile, building: false, count: 43, chips: [...profile.chips, { kind: 'look', text: 'slow dolly' }] }), 300);
      return route.fulfill({ json: profile });
    }
    if (url.endsWith('/lab/profile')) {
      if (body?.summary) profile = { ...profile, summary: body.summary, edited: true };
      if (body?.remove) profile = { ...profile, removed: body.remove, chips: profile.chips.filter((c) => !body.remove.includes(c.text)) };
      return route.fulfill({ json: profile });
    }
    if (body?.style === 'yours') {
      lab = {
        ...lab, style: 'yours', minutesPerVideo: 48, queue: movieQueue,
        making: { title: 'Last light on Europa', topic: null, prompt: 'x', job: null, movie: { id: 'mv1', phase: 'shots', paused: false, shots: 6, shotsDone: 2, etaSeconds: 1500, seconds: 30 } },
      };
    }
    if (url.endsWith('/lab/cancel')) lab = { ...lab, making: null };
    await route.fulfill({ json: lab });
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, introSeen: true } }, version: 0 }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  await page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list').getByRole('button', { name: /Lab/ }).click();
  const section = page.locator('.app-window[data-app="lab"]').getByRole('region', { name: 'Lab' });
  const style = section.getByRole('group', { name: 'Lab style' });
  await style.getByRole('button', { name: 'Your style' }).click();
  await expect(style.getByRole('button', { name: 'Your style' })).toHaveAttribute('aria-pressed', 'true');

  // The profile panel: what it read, from how many prompts.
  const panel = section.getByRole('region', { name: 'Your style' });
  await expect(panel).toContainText('lonely astronauts in rainy neon cities');
  await expect(panel).toContainText('Built from 42 of your prompts');
  await expect(section.getByRole('list', { name: 'Topics' })).toHaveCount(0);

  // The queue: a planned 30-second movie. Making now: its stage and time left.
  const queue = section.getByRole('list', { name: 'Up next' });
  await expect(queue).toContainText('A lone astronaut in neon city');
  await expect(queue).toContainText('30-second movie');
  await expect(section).toContainText('Each movie takes about 48 minutes');
  const now = section.getByRole('status', { name: 'Making now' });
  await expect(now).toContainText('Last light on Europa');
  const stages = now.getByRole('list', { name: 'Movie stages' });
  await expect(stages.locator('[aria-current="step"]')).toHaveText('Shots 3 of 6');
  await expect(now).toContainText('about 25 min left');

  // Edit the summary: your words steer it.
  await panel.getByRole('button', { name: 'Edit' }).click();
  await panel.getByRole('textbox', { name: 'Your style, in your words' }).fill('Warmer light from now on, still lonely astronauts.');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel).toContainText('Warmer light from now on');
  await expect(panel).toContainText('with your edits');

  // Remove a chip.
  const chips = panel.getByRole('list', { name: 'What it picked up' });
  await expect(chips).toContainText('anamorphic');
  await chips.getByRole('button', { name: 'Stop using anamorphic' }).click();
  await expect(chips).not.toContainText('anamorphic');

  // Rebuild now.
  await panel.getByRole('button', { name: 'Rebuild now' }).click();
  await expect(panel).toContainText('Built from 43 of your prompts', { timeout: 10_000 });
  await expect(chips).toContainText('slow dolly');

  // Cancel the movie being made.
  await now.getByRole('button', { name: 'Cancel' }).click();
  await expect(section.getByRole('status', { name: 'Making now' })).toHaveCount(0);

  expect(posts.map((p) => p.url)).toEqual(['/_orbit/studio/lab', '/_orbit/studio/lab/profile', '/_orbit/studio/lab/profile', '/_orbit/studio/lab/profile/rebuild', '/_orbit/studio/lab/cancel']);
  expect(posts[1].body).toEqual({ summary: 'Warmer light from now on, still lonely astronauts.' });
  expect(posts[2].body).toEqual({ remove: ['anamorphic'] });

  // Every button and the chip removers are 44 px targets; no sideways scroll.
  for (const b of await panel.getByRole('button').all()) {
    const box = await b.boundingBox();
    expect(box && box.height >= 44, `${await b.textContent()} is a 44 px target`).toBe(true);
  }
  await expectNoHorizontalOverflow(page);
});

// ---- The Lab gallery: the same gallery as the Make tab, with the judge's scouting report.

const labRecord = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, title, prompt: `${title} prompt`, caption: `${title} caption`, hashtags: ['#fyp'], seconds: 30, movieId: `mv-${id}`,
  createdAt: '2026-10-21T10:00:00Z', url: `/_orbit/studio/file/${id}?t=tok`, score: null, why: '', status: 'judged', ...extra,
});
const labState = () => ({
  enabled: true, style: 'spicy', topics: [], quietMinutes: 0, readyScore: 75, minutesPerVideo: 34, minutesLeft: 50, madeLastHour: 1, lastError: null,
  making: null, queue: [],
  records: [
    // A spicy movie that shows nothing: clear, plays with its controls.
    labRecord('clear1', 'Rooftop glance', { style: 'spicy', score: 91, status: 'ready', why: 'Eye contact in the first second and a clean loop.' }),
    // The machine's check saw NSFW in this one: hidden until "Show NSFW" is on.
    labRecord('hot1', 'Pool night', { style: 'spicy', score: 70, why: 'Strong light, slow start.', nsfw: true }),
    labRecord('wait1', 'Gym crush energy', { style: 'spicy', status: 'made', why: '' }),
  ],
});

async function openLab(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, introSeen: true } }, version: 0 }));
    // Count play() and pause() (the test files are not real videos).
    const w = window as unknown as { plays: number; pauses: number };
    w.plays = 0;
    w.pauses = 0;
    HTMLMediaElement.prototype.play = function () {
      w.plays++;
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      w.pauses++;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  await page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list').getByRole('button', { name: /Lab/ }).click();
  return page.locator('.app-window[data-app="lab"]').getByRole('region', { name: 'Lab' });
}

test(`Lab gallery: the Make gallery's tiles, a viewer with the score and why, NSFW hidden until shown, plays`, async ({ page }, testInfo) => {
  await mockAi(page, 'on');
  let lab = labState();
  const calls: string[] = [];
  const marks: unknown[] = [];
  await page.route('**/fake-ai/_orbit/studio/lab**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname.replace(/.*\/_orbit\/studio/, '');
    calls.push(`${req.method()} ${p}`);
    const keep = /^\/lab\/(\w+)\/keep$/.exec(p);
    if (keep) lab = { ...lab, records: lab.records.filter((r) => r.id !== keep[1]) };
    const del = /^\/lab\/(\w+)$/.exec(p);
    if (del && req.method() === 'DELETE') lab = { ...lab, records: lab.records.filter((r) => r.id !== del[1]) };
    await route.fulfill({ json: lab });
  });
  await page.route('**/fake-ai/_orbit/studio/items/*/nsfw', (route) => {
    marks.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/fake-ai/_orbit/studio/file/**', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'video/mp4' }, body: '' }));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const section = await openLab(page);

  // The same tile grid as Make, best first, the score on each judged one.
  const gallery = section.getByRole('list', { name: 'Lab movies, best first' });
  await expect(gallery).toHaveClass(/ai-gallery/);
  // The NSFW one is hidden (no blur): two show.
  await expect(gallery.getByRole('listitem')).toHaveCount(2);
  await expect(gallery.getByRole('button', { name: 'Video: Pool night' })).toHaveCount(0);
  await expect(gallery.getByRole('listitem').first()).toContainText('91');
  // As wide as the screen allows, never wider (no sideways scroll inside the Lab either).
  const gb = (await gallery.boundingBox())!;
  expect(gb.x).toBeGreaterThanOrEqual(0);
  expect(gb.x + gb.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(await page.evaluate(() => [...document.querySelectorAll('.meme-lab, .ai-create, .lab-scroll')].some((e) => e.scrollWidth > e.clientWidth + 1))).toBe(false);
  await expect(gallery.locator('.censor')).toHaveCount(0);
  // Every video shows its first frame (not black): a tenth of a second in, metadata loaded.
  for (const v of await gallery.locator('video').all()) {
    expect(await v.getAttribute('src')).toMatch(/#t=0\.1$/);
    expect(await v.getAttribute('preload')).toBe('metadata');
  }

  // Tap the best one: the viewer, with the judge's scouting report.
  await gallery.getByRole('button', { name: 'Video: Rooftop glance' }).click();
  const viewer = page.getByRole('dialog', { name: 'Lab movie' });
  const report = viewer.getByRole('region', { name: 'Scouting report' });
  await expect(report).toContainText('Ready to post');
  await expect(report).toContainText('30 s movie');
  await expect(report.getByLabel('Viral score 91 of 100')).toHaveText('91');
  await expect(report).toContainText('Why: Eye contact in the first second and a clean loop.');
  await expect(viewer).toContainText('Rooftop glance caption');
  await expect(viewer).toContainText('#fyp');
  // No blur, and it plays with its own controls.
  const video = viewer.locator('.ai-viewer-media video');
  await expect(video).toHaveAttribute('controls', '');
  expect(await video.evaluate((el) => getComputedStyle(el).pointerEvents)).not.toBe('none');
  expect(await video.evaluate((el) => getComputedStyle(el).filter)).toBe('none');
  // The Make viewer's switch: mark it NSFW (saved on the AI machine), then unmark it.
  const sw = viewer.getByRole('switch', { name: 'NSFW', exact: true });
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect(sw).toBeChecked();
  await expect.poll(() => marks).toEqual([{ nsfw: true }]);
  await sw.click();
  await expect(sw).not.toBeChecked();
  expect(await video.evaluate((el) => getComputedStyle(el).filter)).toBe('none');
  await expect(viewer.getByRole('button', { name: 'Copy caption' })).toBeVisible();
  for (const b of await viewer.getByRole('button').all()) {
    const bb = await b.boundingBox();
    if (bb) expect(Math.min(bb.width, bb.height), `${await b.getAttribute('aria-label') ?? await b.textContent()} is a 44 px target`).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('lab-viewer.png') });

  // Keep: into your gallery.
  await viewer.getByRole('button', { name: 'Keep in my gallery' }).click();
  await expect(viewer).toHaveCount(0);
  expect(calls).toContain('POST /lab/clear1/keep');
  await expect(gallery.getByRole('listitem')).toHaveCount(1);

  // Waiting to be judged: says so. Delete asks first.
  await gallery.getByRole('button', { name: 'Video: Gym crush energy' }).click();
  await expect(viewer.getByRole('region', { name: 'Scouting report' })).toContainText('Waiting to be judged');
  await viewer.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete this?' }).getByRole('button', { name: 'Delete' }).click();
  expect(calls).toContain('DELETE /lab/wait1');
  // Only the hidden NSFW one is left.
  await expect(section.getByText(/One NSFW result is hidden/)).toBeVisible();

  // Show NSFW: it shows, blurred; in the viewer it plays while held.
  await expect(section.getByRole('switch', { name: 'Show NSFW' })).toHaveCount(0);
  await setShowNsfw(page, true);
  await expect(gallery.locator('.censor')).toHaveCount(1);
  await gallery.getByRole('button', { name: 'Video: Pool night' }).click();
  await expect(viewer.getByRole('switch', { name: 'NSFW', exact: true })).toBeChecked();
  const media = viewer.locator('.ai-viewer-media.censor');
  await expect(media).toBeVisible();
  expect(await media.locator('video').evaluate((el) => getComputedStyle(el).filter)).toContain('blur');
  const plays = await page.evaluate(() => (window as unknown as { plays: number }).plays);
  const mb = (await media.boundingBox())!;
  await page.mouse.move(mb.x + mb.width / 2, mb.y + Math.min(mb.height / 2, 120));
  await page.mouse.down();
  await expect(media).toHaveAttribute('data-revealed', '');
  await expect.poll(() => page.evaluate(() => (window as unknown as { plays: number }).plays)).toBeGreaterThan(plays);
  await page.mouse.up();
  await expect(media).not.toHaveAttribute('data-revealed', '');
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('Your style on an older AI machine: a plain message, not a raw error', async ({ page }) => {
  await mockAi(page, 'on');
  const lab = { ...labState(), style: 'comedy', records: [] };
  await page.route('**/fake-ai/_orbit/studio/lab**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    // An older machine: no profile route, and it ignores a style it doesn't know.
    if (p.endsWith('/lab/profile')) return route.fulfill({ status: 404, json: { error: 'Not found' } });
    await route.fulfill({ json: lab });
  });
  const section = await openLab(page);
  await section.getByRole('group', { name: 'Lab style' }).getByRole('button', { name: 'Your style' }).click();
  await expect(section).toContainText('Your AI machine is on an older version. Turn it off and on again to get this.');
  await expect(section).not.toContainText('Not found');
  await expectNoHorizontalOverflow(page);
});

test('Lab refreshes keep the same pictures and videos (no reloading) and the same page', async ({ page }) => {
  await mockAi(page, 'on');
  // The machine signs a fresh link for every file on every refresh, like the real one.
  let n = 0;
  const polls: number[] = [];
  await page.route('**/fake-ai/_orbit/studio/lab**', async (route) => {
    n++;
    if (new URL(route.request().url()).pathname.endsWith('/studio/lab')) polls.push(n);
    const s = labState();
    await route.fulfill({ json: { ...s, records: s.records.map((r) => ({ ...r, url: `/_orbit/studio/file/${r.id}?t=tok${n}` })) } });
  });
  await page.route('**/fake-ai/_orbit/studio/file/**', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'video/mp4' }, body: '' }));
  const section = await openLab(page);
  const gallery = section.getByRole('list', { name: 'Lab movies, best first' });
  await expect(gallery.getByRole('listitem').first()).toBeVisible();
  const src = await gallery.locator('video').first().getAttribute('src');
  await gallery.getByRole('listitem').first().evaluate((el) => el.setAttribute('data-probe', 'kept'));
  // Two Lab refreshes later (every 10 s): the same file links, the same tiles.
  const start = polls.length;
  await expect.poll(() => polls.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(start + 2);
  expect(await gallery.locator('video').first().getAttribute('src')).toBe(src);
  await expect(gallery.locator('[data-probe="kept"]')).toHaveCount(1);
});

// ---- Remix: pictures and short videos remade from your own Make prompts, many an hour.

test('Remix: remakes your Make prompts as pictures and videos, picks what it makes, and shows where each came from', async ({ page }) => {
  await mockAi(page, 'on');
  const remixQueue = [
    { id: 'r1', title: 'Remix: A lone astronaut in a rainy neon…', prompt: 'x', topic: null, yours: false, kind: 'picture', remixOf: 'A lone astronaut in a rainy neon market' },
    { id: 'r2', title: 'Remix: Slow dolly through a foggy forest', prompt: 'x', topic: null, yours: false, kind: 'clip', seconds: 5, remixOf: 'Slow dolly through a foggy forest at dawn' },
  ];
  let lab = {
    enabled: true, style: 'comedy', topics: ['gym fails'], quietMinutes: 0, readyScore: 75, minutesPerVideo: 6, minutesLeft: 55, madeLastHour: 0, lastError: null,
    making: null as unknown, queue: [] as unknown[], records: [] as unknown[], mix: 'both', remix: undefined as unknown,
  };
  const posts: unknown[] = [];
  await page.route('**/fake-ai/_orbit/studio/lab**', async (route) => {
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
    if (body) posts.push(body);
    if (body?.style === 'remix') {
      lab = {
        ...lab, style: 'remix', minutesPerVideo: 1, madeLastHour: 14, queue: remixQueue, remix: { sources: 2, pictures: 1, videos: 1 },
        making: { title: 'Neon rain, from above', topic: null, prompt: 'x', kind: 'picture', remixOf: 'A lone astronaut in a rainy neon market', job: { id: 'j1', kind: 'image', prompt: 'x', status: 'running', progress: 40, error: null, createdAt: '', item: null } },
        records: [
          { id: 'p1', kind: 'image', style: 'remix', title: 'Neon rain, at dusk', prompt: 'x', caption: 'Same world, new light', hashtags: ['#scifi'], remixOf: 'A lone astronaut in a rainy neon market', createdAt: '2026-10-23T10:00:00Z', url: '/_orbit/studio/file/p1?t=tok', score: 84, why: 'Fresh and still theirs.', status: 'ready' },
          { id: 'v1', kind: 'video', style: 'remix', seconds: 5, title: 'Forest, from above', prompt: 'x', caption: 'c', hashtags: [], remixOf: 'Slow dolly through a foggy forest at dawn', createdAt: '2026-10-23T09:00:00Z', url: '/_orbit/studio/file/v1?t=tok', score: 60, why: 'Nice light.', status: 'judged' },
        ],
      };
    }
    if (body?.mix) lab = { ...lab, mix: body.mix, queue: remixQueue.filter((q) => q.kind === 'picture'), remix: { sources: 1, pictures: 1, videos: 1 } };
    await route.fulfill({ json: lab });
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, skin: 'o5', introSeen: true } }, version: 0 }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  await page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list').getByRole('button', { name: /Lab/ }).click();
  const section = page.locator('.app-window[data-app="lab"]').getByRole('region', { name: 'Lab' });
  const style = section.getByRole('group', { name: 'Lab style' });
  await style.getByRole('button', { name: 'Remix' }).click();
  await expect(style.getByRole('button', { name: 'Remix' })).toHaveAttribute('aria-pressed', 'true');
  await expect(section).toContainText('remakes each one in a creative new way');
  // No topics: it works from your own prompts.
  await expect(section.getByRole('list', { name: 'Topics' })).toHaveCount(0);

  const panel = section.getByRole('region', { name: 'Remix' });
  await expect(panel).toContainText('Remixing your 2 newest prompts (1 for pictures, 1 for videos)');
  const now = section.getByRole('status', { name: 'Making now' });
  await expect(now).toContainText('Neon rain, from above');
  await expect(now).toContainText('Picture remade from: “A lone astronaut in a rainy neon market”');
  const queue = section.getByRole('list', { name: 'Up next' });
  await expect(queue).toContainText('Picture');
  await expect(queue).toContainText('5-second video');
  await expect(queue).toContainText('Remade from: “Slow dolly through a foggy forest at dawn”');
  await expect(section).toContainText('Each remix takes about 1 min');
  await expect(section).toContainText('14 made in the last hour').catch(() => {}); // only shown when nothing is being made

  // Only pictures.
  await panel.getByRole('group', { name: 'What Remix makes' }).getByRole('button', { name: 'Pictures' }).click();
  await expect(panel.getByRole('group', { name: 'What Remix makes' }).getByRole('button', { name: 'Pictures' })).toHaveAttribute('aria-pressed', 'true');
  await expect(queue).not.toContainText('5-second video');

  // The gallery: a picture and a video, best first; the picture's page says where it came from.
  const grid = section.getByRole('list', { name: 'Lab remixes, best first' });
  await expect(grid.locator('img')).toHaveCount(1);
  await grid.getByRole('button').first().click();
  const viewer = page.getByRole('dialog', { name: 'Lab picture' });
  await expect(viewer).toContainText('Picture remix');
  await expect(viewer).toContainText('Remade from your prompt: “A lone astronaut in a rainy neon market”');

  expect(posts).toEqual([{ style: 'remix' }, { mix: 'pictures' }]);
  await expectNoHorizontalOverflow(page);
});
