import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';
import { mockAi } from './aiMocks';

/** Stats & Storage: live machine numbers, money and storage, with the site and the AI machine mocked. */

const GB = 1024 ** 3;
const today = new Date().toISOString().slice(0, 10);
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

function status(cpu = 14.5) {
  return {
    at: new Date().toISOString(),
    canPower: true,
    money: { balance: 41.2, spendPerHour: 1.87, today: 6.5, spendLimit: 80 },
    machines: [
      {
        id: 'ai',
        name: 'AI machine',
        state: 'on',
        costPerHour: 1.79,
        uptimeSeconds: 7200,
        autoOff: true,
        gpuName: 'A100 80 GB',
        live: { cpu: 12, memory: 30, gpu: 64, gpuMemory: 48 },
        stats: {
          cpu: { percent: cpu, cores: 16 },
          memory: { used: 18 * GB, total: 50 * GB },
          disks: [{ label: 'System disk', path: '/', total: 250 * GB, free: 180 * GB }],
          network: { rxPerSec: 2.5 * 1024 * 1024, txPerSec: 400 * 1024 },
          processes: [{ name: 'AI chat model', cpu: 9.5, memory: 2.1 * GB, count: 1 }],
          gpus: [{ name: 'NVIDIA A100-SXM4-80GB', percent: 64, memoryUsed: 38 * GB, memoryTotal: 80 * GB, temperature: 55, watts: 180 }],
          users: [{ kind: 'model', name: 'qwen3.8:27b', label: 'Chat model: qwen3.8:27b', memory: 20 * GB }],
        },
      },
      { id: 'linux', name: 'Linux machine', state: 'off', costPerHour: 0.08, uptimeSeconds: null, autoOff: true, live: null, stats: null },
    ],
  };
}

async function mockAll(page: Page) {
  let cpu = 10;
  await page.route('**/api/status**', (route) => route.fulfill({ json: status((cpu += 7)) }));
  await page.route('**/api/spend**', (route) =>
    route.fulfill({
      json: {
        days: [3, 2, 1, 0].map((n, i) => ({ date: day(n), amount: [3.5, 5, 21.76, 6.5][i], gpu: [2.2, 4.1, 20.9, 6][i], cpu: 0.3, disk: 0.2, storage: 0.05 })),
        total: 36.76,
        volumes: [{ id: 'v1', name: 'orbit-linux-storage', sizeGb: 50, dataCenter: 'US-NC-2', costPerMonth: 3.5 }],
      },
    }),
  );
  await mockAi(page, 'on');
  const deleted: string[] = [];
  let items = [
    { id: 'big', kind: 'video', prompt: 'waves at sunset', createdAt: `${today}T10:00:00Z`, url: '/_orbit/studio/file/big?t=a' },
    { id: 'pic', kind: 'image', prompt: 'a red fox in snow', createdAt: `${today}T09:00:00Z`, url: '/_orbit/studio/file/pic?t=a' },
    { id: 'spicy', kind: 'image', prompt: 'a quiet portrait', nsfw: true, createdAt: `${today}T08:00:00Z`, url: '/_orbit/studio/file/spicy?t=a' },
  ];
  await page.route('**/fake-ai/_orbit/studio/items', (route) => route.fulfill({ json: { items } }));
  await page.route('**/fake-ai/_orbit/studio/items/*', (route) => {
    const id = route.request().url().split('/').pop()!;
    deleted.push(`${route.request().method()} ${id}`);
    items = items.filter((i) => i.id !== id);
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/fake-ai/_orbit/studio/file/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/fake-ai/_orbit/storage**', (route) =>
    route.fulfill({
      json: {
        at: new Date().toISOString(),
        disks: [],
        cloud: {
          bytes: 16 * GB,
          files: 1234,
          freeBytes: 10 * GB,
          perGbMonth: 0.015,
          costPerMonth: 0.09,
          folders: [
            { id: 'makers', label: 'Picture and video makers', bytes: 12 * GB, files: 40 },
            { id: 'chat', label: 'Chat models', bytes: 4 * GB, files: 20 },
            { id: 'gallery', label: 'Your pictures and videos', bytes: 60 * 1024 * 1024, files: 6 },
          ],
        },
        items: [
          { id: 'big', bytes: 48 * 1024 * 1024 },
          { id: 'spicy', bytes: 3 * 1024 * 1024 },
          { id: 'pic', bytes: 2 * 1024 * 1024 },
        ].filter((x) => items.some((i) => i.id === x.id)),
      },
    }),
  );
  return { deleted };
}

async function openStats(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, skin: 'o5', introSeen: true } }, version: 0 }));
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  await page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list').getByRole('button', { name: /Stats/ }).click();
  const win = page.locator('.app-window[data-app="stats"]');
  await expect(win.getByTestId('stats')).toBeVisible();
  return { win, errors };
}

test('Stats: every machine number live with history, money by day, storage with the biggest first; NSFW stays hidden; delete asks first', async ({ page }) => {
  const { deleted } = await mockAll(page);
  const { win, errors } = await openStats(page);

  // Right now: the AI machine's numbers.
  const ai = win.getByRole('article', { name: 'AI machine' });
  await expect(ai).toContainText('$1.79/h');
  await expect(ai).toContainText('on for 2 h 0 min');
  await expect(ai).toContainText('$3.58 this time');
  await expect(ai).toContainText('16 cores');
  await expect(ai).toContainText('18.0 GB of 50.0 GB');
  await expect(ai).toContainText('55°C');
  await expect(ai).toContainText('180 W');
  await expect(ai).toContainText('38.0 GB of 80.0 GB');
  await expect(ai).toContainText('2.5 MB/s');
  await expect(ai).toContainText('180 GB free');
  await expect(ai).toContainText('Chat model: qwen3.8:27b');
  await expect(ai.getByRole('list', { name: 'AI machine: busiest programs' })).toContainText('AI chat model');
  // The history line fills in as readings come (every 5 s).
  await expect(ai.getByRole('img', { name: /^CPU, last \d+ readings/ })).toBeVisible({ timeout: 15_000 });
  await expect(win.getByRole('article', { name: 'Linux machine' })).toContainText('Resting: costs nothing per hour');

  // Money.
  const money = win.locator('#sx-money');
  await expect(money).toContainText('$41.20');
  await expect(money).toContainText('$1.87/h');
  await expect(money).toContainText('$36.76');
  await expect(money).toContainText('a whole day costs $44.88');
  await expect(money.getByRole('list', { name: 'Spending per day' }).getByRole('listitem')).toHaveCount(4);
  // Storage a month: cloud $0.09 + the drive $3.50.
  await expect(money).toContainText('$3.59');

  // Storage.
  const storage = win.locator('#sx-storage');
  await expect(storage).toContainText('16.0 GB');
  await expect(storage.getByRole('list', { name: 'Cloud storage by folder' })).toContainText('Picture and video makers');
  await expect(storage).toContainText('orbit-linux-storage');
  const biggest = storage.getByRole('list', { name: 'Biggest pictures and videos' });
  await expect(biggest.getByRole('listitem')).toHaveCount(3);
  await expect(biggest.getByRole('listitem').first()).toContainText('waves at sunset');
  // The NSFW one: listed by size only, no picture and no words.
  await expect(biggest).toContainText('NSFW picture (hidden)');
  await expect(biggest).not.toContainText('a quiet portrait');
  await expect(biggest.locator('img')).toHaveCount(1);

  await biggest.getByRole('button', { name: 'Delete video: waves at sunset' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this?' });
  await expect(confirm).toBeVisible();
  expect(deleted).toEqual([]);
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => deleted).toEqual(['DELETE big']);
  await expect(biggest.getByRole('listitem')).toHaveCount(2);

  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
