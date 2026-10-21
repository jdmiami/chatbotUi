import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, openOrbit } from './helpers';
import { mockAi, openMakeApp } from './aiMocks';

/** Make, its own app: in the cloud while the AI machine rests; what is made there moves into the gallery when it is on. */

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const READY = { ready: true, downloaded: true, percent: 100 };

test('Make in the cloud: a picture straight away, a video after a wait; both move into the gallery once the machine is on; NSFW stays off the cloud', async ({ page }) => {
  await mockAi(page, 'off');
  const sent: Record<string, unknown>[] = [];
  let polls = 0;
  await page.route(/\/api\/make(\?.*)?$/, async (route) => {
    const req = route.request();
    const id = new URL(req.url()).searchParams.get('id');
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as Record<string, unknown>;
      sent.push(body);
      if (body.kind === 'image') return route.fulfill({ json: { id: 'cf:1', status: 'done', url: `data:image/png;base64,${PNG}`, provider: 'cloudflare', kind: 'image' } });
      return route.fulfill({ json: { id: 'falvid', status: 'queued', position: 2, provider: 'fal', kind: 'video' } });
    }
    if (id) {
      polls++;
      return route.fulfill({ json: polls < 2 ? { id, status: 'running', provider: 'fal', kind: 'video' } : { id, status: 'done', url: 'https://v3.fal.media/files/clip.mp4', provider: 'fal', kind: 'video' } });
    }
    return route.fulfill({
      json: {
        configured: true,
        image: [{ id: 'cloudflare', name: 'Cloudflare', price: 'about 230 a day free, then $0.0005 each' }],
        video: [{ id: 'fal', name: 'fal.ai', price: 'a few cents a clip' }],
      },
    });
  });
  await page.route('https://v3.fal.media/**', (route) => route.fulfill({ status: 200, contentType: 'video/mp4', body: '' }));
  // Once on: the studio, an empty gallery, and the import.
  const imported: Record<string, unknown>[] = [];
  await page.route('**/fake-ai/_orbit/studio', (r) => r.fulfill({ json: { setup: 'running', running: true, image: READY, video: READY, downloading: null, downloadError: null, jobs: [] } }));
  await page.route('**/fake-ai/_orbit/studio/makers', (r) => r.fulfill({ json: { makers: [{ id: 'qwen', kind: 'image', name: 'Qwen Image', installed: true, builtIn: true }] } }));
  await page.route('**/fake-ai/_orbit/studio/items', (r) => r.fulfill({ json: { items: imported.map((b, i) => ({ id: `in${i}`, kind: b.kind, prompt: b.prompt, createdAt: '2026-10-21T10:00:00Z', url: `/_orbit/studio/file/in${i}?t=a` })) } }));
  await page.route('**/fake-ai/_orbit/studio/file/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG, 'base64') }));
  await page.route('**/fake-ai/_orbit/studio/import', (r) => {
    imported.push(r.request().postDataJSON() as Record<string, unknown>);
    return r.fulfill({ json: { item: { id: `in${imported.length - 1}`, kind: 'image', prompt: 'x', createdAt: '', url: '/_orbit/studio/file/x?t=a' } } });
  });

  const errors = await openOrbit(page);
  const win = await openMakeApp(page);
  const cloud = win.getByRole('region', { name: 'Make it in the cloud' });
  await expect(cloud).toBeVisible();
  await expect(cloud).toContainText('Cloudflare: about 230 a day free');

  // A picture: back at once, waiting on this device.
  await cloud.getByRole('textbox', { name: 'Describe it for the cloud' }).fill('a lighthouse at dawn');
  await cloud.getByRole('button', { name: 'Make the picture in the cloud' }).click();
  const made = cloud.getByRole('list', { name: 'Made in the cloud' });
  await expect(made.getByRole('button', { name: 'Image: a lighthouse at dawn' })).toBeVisible();
  expect(sent[0]).toEqual({ kind: 'image', prompt: 'a lighthouse at dawn', size: 'square' });

  // NSFW never goes to the cloud.
  await cloud.getByRole('textbox', { name: 'Describe it for the cloud' }).fill('a nude portrait');
  await cloud.getByRole('button', { name: 'Make the picture in the cloud' }).click();
  await expect(page.getByText("Cloud makers don't allow adult content")).toBeVisible();
  expect(sent).toHaveLength(1);

  // A video: in line, then made.
  await cloud.getByRole('radio', { name: 'A video' }).click();
  await cloud.getByRole('textbox', { name: 'Describe it for the cloud' }).fill('waves at sunset');
  await cloud.getByRole('button', { name: 'Make the video in the cloud' }).click();
  expect(sent[1]).toEqual({ kind: 'video', prompt: 'waves at sunset', size: 'landscape' });
  await expect(cloud.getByRole('list', { name: 'Cloud jobs' })).toContainText(/In line, 2 ahead|Making/);
  await expect(made.getByRole('button', { name: 'Video: waves at sunset' })).toBeVisible({ timeout: 15_000 });
  await expectNoHorizontalOverflow(page);

  // Still there after a reload (kept on this device).
  await page.reload();
  const win2 = await openMakeApp(page);
  const made2 = win2.getByRole('list', { name: 'Made in the cloud' });
  await expect(made2.getByRole('listitem')).toHaveCount(2);

  // The machine comes on: both move into the gallery, and the cloud section folds away.
  await win2.getByRole('button', { name: 'Turn it on' }).click();
  await expect.poll(() => imported.length, { timeout: 40_000 }).toBe(2);
  expect(imported.map((b) => b.prompt).sort()).toEqual(['a lighthouse at dawn', 'waves at sunset']);
  expect(imported.find((b) => b.kind === 'video')).toMatchObject({ url: 'https://v3.fal.media/files/clip.mp4', maker: 'cloud:fal' });
  expect(imported.find((b) => b.kind === 'image')).toMatchObject({ url: `data:image/png;base64,${PNG}`, maker: 'cloud:cloudflare' });
  await expect(win2.getByRole('button', { name: 'Make it in the cloud instead' })).toBeVisible();
  await expect(win2.getByRole('list', { name: 'Your creations' }).getByRole('listitem')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('Make: a bar at the top shows what is still loading, and a stopped download resumes', async ({ page }) => {
  await mockAi(page, 'on');
  let resumed = false;
  const installs: unknown[] = [];
  const makers = () => [
    { id: 'qwen', kind: 'image', name: 'Qwen Image', installed: true, builtIn: true, wanted: true, percent: 100 },
    { id: 'h3-max', kind: 'video', name: 'H3 Max', installed: false, wanted: true, percent: 40, size: 50e9, status: resumed ? 'downloading' : 'paused' },
    { id: 'wan', kind: 'video', name: 'Wan Video', installed: false, wanted: true, percent: 10, size: 30e9, status: 'waiting', waitingFor: 'H3 Max' },
  ];
  await page.route('**/fake-ai/_orbit/studio', (r) => r.fulfill({ json: { setup: 'running', running: true, image: READY, video: READY, downloading: null, downloadError: null, jobs: [] } }));
  await page.route('**/fake-ai/_orbit/studio/makers', (r) => r.fulfill({ json: { makers: makers() } }));
  await page.route('**/fake-ai/_orbit/studio/makers/install', (r) => {
    installs.push(r.request().postDataJSON());
    resumed = true;
    return r.fulfill({ json: { makers: makers() } });
  });
  await page.route('**/fake-ai/_orbit/studio/items', (r) => r.fulfill({ json: { items: [] } }));

  const errors = await openOrbit(page);
  const win = await openMakeApp(page);
  const bar = win.getByRole('region', { name: 'Makers loading' });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Loading 2 makers');
  await expect(bar).toContainText('H3 Max');
  await expect(bar).toContainText('40% · paused');
  await expect(bar).toContainText('10% · in line');
  // Only the stopped one can be resumed.
  await expect(bar.getByRole('button', { name: 'Resume Wan Video' })).toHaveCount(0);
  await bar.getByRole('button', { name: 'Resume H3 Max' }).click();
  await expect.poll(() => installs).toEqual([{ id: 'h3-max' }]);
  await expect(bar.getByRole('button', { name: 'Resume H3 Max' })).toHaveCount(0);
  await expect(bar).toContainText(/H3 Max\s*40%/);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
