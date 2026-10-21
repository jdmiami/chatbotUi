import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';
import { mockAi } from './aiMocks';

/** The Lab as its own app (from the Index): the same Lab screen as the AI app's Lab tab. */
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
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, skin: 'o5', introSeen: true } }, version: 0 }));
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
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, skin: 'o5', introSeen: true } }, version: 0 }));
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
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, skin: 'o5', introSeen: true } }, version: 0 }));
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
