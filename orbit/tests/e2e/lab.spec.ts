import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';
import { mockAi } from './aiMocks';

// The Lab: a prompt multiplier. The writer studies your own Make prompts and writes new ones in your
// style; your machine makes them. You can multiply one prompt, write a fresh round, pick pictures or
// videos, and keep or delete what it made.

const job = { id: 'lab1', kind: 'image', prompt: 'x', status: 'running', progress: 40, error: null, createdAt: '', item: null, etaSeconds: 60 };
const base = () => ({
  kind: 'multiply',
  enabled: true,
  mix: 'both',
  writerReady: true,
  writing: false,
  yours: { pictures: 12, videos: 3 },
  making: { prompt: 'A lone astronaut naps in a flooded neon subway car', kind: 'picture', maker: 'krea-real', job },
  queue: [
    { id: 'q1', prompt: 'A lone astronaut buys noodles from a robot stall in the rain', kind: 'picture', maker: 'krea-real' },
    { id: 'q2', prompt: 'Fog rolls through pines as the camera glides low', kind: 'clip', maker: 'ltx', from: 'Slow dolly through a foggy forest at dawn' },
  ],
  madeLastHour: 4,
  maxPerHour: 60,
  lastError: null,
  records: [{ id: 'r1', prompt: 'A lone astronaut on a rooftop watching neon blimps', kind: 'image', createdAt: '2026-11-24T10:00:00Z', url: '/_orbit/studio/file/r1?t=tok' }],
});

async function openLab(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, introSeen: true } }, version: 0 }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  await page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list').getByRole('button', { name: /Lab/ }).click();
  return page.locator('.app-window[data-app="lab"]').getByRole('region', { name: 'Lab' });
}

test('the Lab shows what it is making, the prompts it wrote in your style, and what it made', async ({ page }) => {
  await mockAi(page, 'on');
  await page.route('**/fake-ai/_orbit/studio/lab**', (route) => route.fulfill({ json: base() }));
  await page.route('**/fake-ai/_orbit/studio/file/**', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: '' }));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const lab = await openLab(page);
  await expect(lab.getByRole('status', { name: 'Making now' })).toContainText('flooded neon subway car');
  await expect(lab.getByRole('status', { name: 'Making now' })).toContainText('Picture · 40%');
  const next = lab.getByRole('list', { name: 'Up next' });
  await expect(next).toContainText('robot stall');
  await expect(next).toContainText('5-second video');
  await expect(next).toContainText('From your prompt: “Slow dolly through a foggy forest at dawn”');
  await expect(lab.getByTestId('lab-yours')).toHaveText('Learning from 12 picture prompts and 3 video prompts of yours.');
  await expect(lab.getByRole('list', { name: 'Made in the Lab, newest first' }).getByRole('listitem')).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('the Lab: pick videos, multiply a prompt, write new ones, move one up, keep what it made', async ({ page }) => {
  await mockAi(page, 'on');
  let lab = base();
  const posts: { url: string; method: string; body: unknown }[] = [];
  await page.route('**/fake-ai/_orbit/studio/lab**', async (route) => {
    const req = route.request();
    const url = new URL(req.url()).pathname.replace('/fake-ai', '');
    if (req.method() !== 'GET') {
      posts.push({ url, method: req.method(), body: req.postData() ? JSON.parse(req.postData()!) : null });
      if (url === '/_orbit/studio/lab') lab = { ...lab, mix: (req.postDataJSON() as { mix?: string }).mix ?? lab.mix };
      if (url === '/_orbit/studio/lab/queue') lab = { ...lab, queue: [{ id: 'q9', prompt: 'Neon koi swim through a rainy alley, anamorphic', kind: 'picture', maker: 'krea-real', from: 'Neon koi' }, ...lab.queue] };
      if (url === '/_orbit/studio/lab/write') lab = { ...lab, queue: [{ id: 'q7', prompt: 'A fresh one in your style', kind: 'picture', maker: 'krea-real' }] };
      if (url.endsWith('/keep')) lab = { ...lab, records: [] };
    }
    await route.fulfill({ json: lab });
  });
  await page.route('**/fake-ai/_orbit/studio/file/**', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: '' }));
  const ui = await openLab(page);

  await ui.getByRole('group', { name: 'What the Lab makes' }).getByRole('button', { name: 'Videos' }).click();
  await expect.poll(() => posts.at(-1)).toMatchObject({ url: '/_orbit/studio/lab', body: { mix: 'videos' } });

  await ui.getByRole('textbox', { name: 'Prompt to multiply' }).fill('Neon koi');
  await ui.getByRole('button', { name: 'Multiply' }).click();
  await expect.poll(() => posts.at(-1)).toMatchObject({ url: '/_orbit/studio/lab/queue', body: { prompt: 'Neon koi', count: 6 } });
  await expect(ui.getByRole('list', { name: 'Up next' })).toContainText('Neon koi swim');

  await ui.getByRole('button', { name: 'Make this next' }).first().click();
  await expect.poll(() => posts.at(-1)?.url).toMatch(/\/_orbit\/studio\/lab\/queue\/q1\/next$/);

  await ui.getByRole('button', { name: 'Write new ones' }).click();
  await expect.poll(() => posts.at(-1)?.url).toBe('/_orbit/studio/lab/write');
  await expect(ui.getByRole('list', { name: 'Up next' })).toContainText('A fresh one in your style');

  await ui.getByRole('list', { name: 'Made in the Lab, newest first' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Keep in my gallery' }).click();
  await expect.poll(() => posts.at(-1)?.url).toBe('/_orbit/studio/lab/r1/keep');
  await expect(ui.getByRole('list', { name: 'Made in the Lab, newest first' })).toHaveCount(0);
});

test('with nothing made in Make yet, the Lab says what to do first', async ({ page }) => {
  await mockAi(page, 'on');
  await page.route('**/fake-ai/_orbit/studio/lab**', (route) => route.fulfill({ json: { ...base(), yours: { pictures: 0, videos: 0 }, making: null, queue: [], records: [] } }));
  const ui = await openLab(page);
  await expect(ui.getByTestId('lab-yours')).toContainText('Make a few pictures or videos in Make first');
  await expect(ui.getByRole('button', { name: 'Write new ones' })).toBeDisabled();
});
