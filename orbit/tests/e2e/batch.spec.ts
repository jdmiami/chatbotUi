import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, openOrbit } from './helpers';
import { mockAi, openMakeApp } from './aiMocks';

// Batch making in Make: a small cloud model writes many prompts from one idea, you edit them,
// and Make all puts each one in the AI machine's queue with the maker you pick.

const READY = { ready: true, downloaded: true, percent: 100 };

test('Make: Batch writes prompts from one idea, you change and drop some, and Make all queues the rest', async ({ page }, info) => {
  await mockAi(page, 'on');
  const asked: Record<string, unknown>[] = [];
  const jobs: Record<string, unknown>[] = [];
  await page.route('**/api/orb/ai', async (r) => {
    if (r.request().method() !== 'POST') return r.fulfill({ json: { configured: true, providers: [] } });
    const body = r.request().postDataJSON() as Record<string, unknown>;
    asked.push(body);
    const prompts = ['A neon street in the rain, a detective under a flickering sign', 'A rooftop at night, two strangers sharing an umbrella', 'A taxi window streaked with rain, city lights blurred', 'An alley bar, smoke curling under a red lamp'];
    return r.fulfill({ json: { choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(prompts)}\n\`\`\`` } }] } });
  });
  await page.route('**/fake-ai/_orbit/studio', (r) => r.fulfill({ json: { setup: 'running', running: true, image: READY, video: READY, downloading: null, downloadError: null, jobs: [] } }));
  await page.route('**/fake-ai/_orbit/studio/makers', (r) =>
    r.fulfill({
      json: {
        makers: [
          { id: 'qwen', kind: 'image', name: 'Qwen Uncensored', installed: true, builtIn: true, wanted: true, percent: 100, size: 0 },
          { id: 'anime', kind: 'image', name: 'Anime', installed: true, builtIn: false, wanted: true, percent: 100, size: 0 },
          { id: 'h3-max', kind: 'video', name: 'H3 Max', installed: false, builtIn: false, wanted: false, percent: 0, size: 0, loadable: true },
        ],
      },
    }),
  );
  await page.route('**/fake-ai/_orbit/studio/items', (r) => r.fulfill({ json: { items: [] } }));
  await page.route('**/fake-ai/_orbit/studio/jobs', (r) => {
    const body = r.request().postDataJSON() as Record<string, unknown>;
    jobs.push(body);
    return r.fulfill({ json: { id: `job${jobs.length}`, kind: body.kind, prompt: body.prompt, status: 'queued', progress: 0, error: null, createdAt: '', item: null, position: jobs.length, etaSeconds: 40 } });
  });
  await page.route('**/fake-ai/_orbit/studio/jobs/*', (r) => r.fulfill({ json: { id: 'job1', kind: 'image', prompt: 'x', status: 'queued', progress: 0, error: null, createdAt: '', item: null } }));

  await openOrbit(page);
  const win = await openMakeApp(page);
  await win.getByRole('button', { name: 'Batch' }).click();
  const screen = win.getByRole('region', { name: 'Batch making' });
  await expect(screen).toBeVisible();
  await screen.getByRole('textbox', { name: 'Your idea' }).fill('Film noir city in the rain');
  await screen.getByRole('group', { name: 'How many' }).getByRole('button', { name: '4', exact: true }).click();
  await screen.getByRole('button', { name: 'Write 4 prompts' }).click();
  const list = screen.getByRole('list', { name: 'Prompts' });
  await expect(list.getByRole('listitem')).toHaveCount(4);
  expect(asked[0]).toMatchObject({ task: 'free' });
  expect(JSON.stringify(asked[0].messages)).toContain('exactly 4');

  // Change the first, drop the third.
  await screen.getByRole('textbox', { name: 'Prompt 1' }).fill('A detective under a neon sign, rain on his hat, low angle');
  await screen.getByRole('button', { name: 'Remove prompt 3' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(3);
  // Only loaded picture makers to pick from.
  const maker = screen.getByRole('combobox', { name: 'Maker' });
  await expect(maker.locator('option')).toHaveText(['Qwen Uncensored', 'Anime']);
  await maker.selectOption('anime');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath('batch.png') });
  await screen.getByRole('button', { name: 'Make all 3' }).click();
  await expect.poll(() => jobs.length).toBe(3);
  expect(jobs.map((j) => j.maker)).toEqual(['anime', 'anime', 'anime']);
  expect(jobs[0]).toMatchObject({ kind: 'image', prompt: 'A detective under a neon sign, rain on his hat, low angle' });
  await expect(list.getByText('In the queue')).toHaveCount(3);
});
