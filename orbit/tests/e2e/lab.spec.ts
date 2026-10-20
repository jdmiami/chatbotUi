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
