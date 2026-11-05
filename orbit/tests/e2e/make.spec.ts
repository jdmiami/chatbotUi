import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, openOrbit, expectValue } from './helpers';
import { closeMakeGallery, makeStep, mockAi, openMakeApp, openMakeGallery } from './aiMocks';

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
  // The steps hand over to the cloud while the machine rests: the words come along.
  await makeStep(page, 'Describe it');
  await win.getByRole('textbox', { name: 'Describe it' }).fill('a lighthouse at dawn');
  await makeStep(page, 'Check & make');
  await win.getByRole('button', { name: 'Make it in the cloud' }).click();
  const cloud = win.getByRole('region', { name: 'Make it in the cloud' });
  await expect(cloud).toBeVisible();
  await expectValue(cloud.getByRole('textbox', { name: 'Describe it for the cloud' }), 'a lighthouse at dawn');
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

  // Still there after a reload (kept on this device): the Cloud button opens it.
  await page.reload();
  const win2 = await openMakeApp(page);
  await win2.getByRole('button', { name: 'Cloud', exact: true }).click();
  const made2 = win2.getByRole('list', { name: 'Made in the cloud' });
  await expect(made2.getByRole('listitem')).toHaveCount(2);
  await win2.getByRole('region', { name: 'Cloud making' }).getByRole('button', { name: 'Back to making' }).click();
  await expect(made2).toBeHidden();

  // The machine comes on: both move into the gallery.
  await win2.getByRole('button', { name: 'Turn it on' }).click();
  await expect.poll(() => imported.length, { timeout: 40_000 }).toBe(2);
  expect(imported.map((b) => b.prompt).sort()).toEqual(['a lighthouse at dawn', 'waves at sunset']);
  expect(imported.find((b) => b.kind === 'video')).toMatchObject({ url: 'https://v3.fal.media/files/clip.mp4', maker: 'cloud:fal' });
  expect(imported.find((b) => b.kind === 'image')).toMatchObject({ url: `data:image/png;base64,${PNG}`, maker: 'cloud:cloudflare' });
  await expect(win2.getByRole('button', { name: 'Cloud', exact: true })).toBeVisible();
  await openMakeGallery(page);
  await expect(win2.getByRole('list', { name: 'Your creations' }).getByRole('listitem')).toHaveCount(2);
  await closeMakeGallery(page);
  expect(errors).toEqual([]);
});

test('Make in the cloud: a MiniMax H3 video with a length and its price, made with progress, saved straight into the stored gallery', async ({ page }) => {
  await mockAi(page, 'off');
  const sent: Record<string, unknown>[] = [];
  const imported: Record<string, unknown>[] = [];
  let polls = 0;
  const CLIP = 'https://api.gpu.ai/v1/videos/1c5cfb89-a829-431d-9ddb-4329aafa2971/content';
  await page.route(/\/api\/make(\?.*)?$/, async (route) => {
    const req = route.request();
    const id = new URL(req.url()).searchParams.get('id');
    if (req.method() === 'POST') {
      sent.push(req.postDataJSON() as Record<string, unknown>);
      return route.fulfill({ json: { id: 'h3job', status: 'queued', provider: 'gpuai', kind: 'video', progress: 0 } });
    }
    if (id) {
      polls++;
      return route.fulfill({ json: polls < 2 ? { id, status: 'running', provider: 'gpuai', kind: 'video', progress: 40 } : { id, status: 'done', url: CLIP, provider: 'gpuai', kind: 'video', progress: 100, costCents: 140 } });
    }
    return route.fulfill({
      json: {
        configured: true,
        image: [],
        video: [{ id: 'gpuai', name: 'MiniMax H3', price: 'about $0.70 for 5 seconds (14¢ a second)', perSecondCents: 14, seconds: { min: 1, max: 10, default: 5 } }],
      },
    });
  });
  // The stored gallery is set up: a finished clip is saved there by the site (it fetches it with the key).
  await page.route('**/api/gallery', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      imported.push(body);
      return route.fulfill({ json: { ok: true, id: 'kept01', url: 'https://files.example/kept01.mp4' } });
    }
    return route.fulfill({ json: { configured: true, items: [] } });
  });
  await page.route('https://files.example/**', (route) => route.fulfill({ status: 200, contentType: 'video/mp4', body: '' }));

  const errors = await openOrbit(page);
  const win = await openMakeApp(page);
  await win.getByRole('button', { name: 'Cloud', exact: true }).click();
  const cloud = win.getByRole('region', { name: 'Make it in the cloud' });
  await expect(cloud).toBeVisible();
  await cloud.getByRole('radio', { name: 'A video' }).click();
  await expect(cloud).toContainText('MiniMax H3: about $0.70 for 5 seconds');
  // The lengths H3 takes, each with its price; 5 seconds to start with.
  const lengths = cloud.getByRole('radiogroup', { name: 'Cloud: how long' });
  await expect(lengths.getByRole('radio', { name: /^5 seconds/ })).toHaveAttribute('aria-checked', 'true');
  await expect(lengths.getByRole('radio', { name: /^10 seconds/ })).toContainText('$1.40');
  await lengths.getByRole('radio', { name: /^10 seconds/ }).click();
  await cloud.getByRole('textbox', { name: 'Describe it for the cloud' }).fill('a lighthouse at dawn');
  await cloud.getByRole('button', { name: 'Make the video in the cloud · $1.40' }).click();
  expect(sent[0]).toEqual({ kind: 'video', prompt: 'a lighthouse at dawn', size: 'landscape', seconds: 10 });
  await expect(cloud.getByRole('list', { name: 'Cloud jobs' })).toContainText(/In line|Making… 40%/);
  // Done: saved into the stored gallery straight from GPU.ai, shown here from its saved link.
  const made = cloud.getByRole('list', { name: 'Made in the cloud' });
  await expect(made.getByRole('button', { name: 'Video: a lighthouse at dawn' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => imported.length).toBe(1);
  expect(imported[0]).toEqual({ action: 'import', url: CLIP, kind: 'video', prompt: 'a lighthouse at dawn', maker: 'cloud:gpuai', seconds: 10 });
  await expect(cloud).toContainText('saved in your gallery');
  await expectNoHorizontalOverflow(page);
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
  // Hide puts the bar away for these downloads, and it stays away after a reload.
  await bar.getByRole('button', { name: 'Hide' }).click();
  await expect(bar).toHaveCount(0);
  await page.reload();
  const again = await openMakeApp(page);
  await expect(again.getByRole('region', { name: 'Makers loading' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Make on GPU.ai: nothing loads until you pick; picks come down in order and one can go next', async ({ page }, info) => {
  await mockAi(page, 'on');
  const loads: { id: string; first: boolean }[] = [];
  const line: string[] = [];
  const row = (id: string, name: string, size: number) => {
    const at = line.indexOf(id);
    return at < 0
      ? { id, kind: id === 'h3-max' ? 'video' : 'image', name, installed: false, wanted: false, percent: 0, size, loadable: true }
      : { id, kind: id === 'h3-max' ? 'video' : 'image', name, installed: false, wanted: true, percent: at ? 0 : 12, size, status: at ? 'waiting' : 'downloading', line: at + 1, waitingFor: at ? 'x' : undefined };
  };
  const makers = () => [row('qwen', 'Qwen Uncensored', 25e9), row('h3-max', 'H3 Max', 52e9), row('anime', 'Anime', 20e9)];
  await page.route('**/fake-ai/_orbit/studio', (r) => r.fulfill({ json: { setup: 'running', running: true, image: READY, video: READY, downloading: null, downloadError: null, jobs: [] } }));
  await page.route('**/fake-ai/_orbit/studio/makers', (r) => r.fulfill({ json: { makers: makers() } }));
  await page.route('**/fake-ai/_orbit/studio/makers/load', (r) => {
    const body = r.request().postDataJSON() as { id: string; first: boolean };
    loads.push(body);
    const at = line.indexOf(body.id);
    if (at >= 0) line.splice(at, 1);
    if (body.first) line.splice(Math.min(1, line.length), 0, body.id);
    else line.push(body.id);
    return r.fulfill({ json: { makers: makers() } });
  });
  await page.route('**/fake-ai/_orbit/studio/items', (r) => r.fulfill({ json: { items: [] } }));

  const errors = await openOrbit(page);
  const win = await openMakeApp(page);
  const pickBar = win.getByRole('region', { name: 'Pick what to load' });
  await expect(pickBar).toContainText('Nothing is loaded yet');
  await pickBar.getByRole('button', { name: 'All makers' }).click();
  await page.screenshot({ path: info.outputPath('make-pick-first.png') });
  await pickBar.getByRole('button', { name: /H3 Max/ }).click();
  const bar = win.getByRole('region', { name: 'Makers loading' });
  await expect(bar).toContainText('Loading H3 Max');
  // Still open: the list stays as you left it.
  await bar.getByRole('group', { name: 'Load next' }).getByRole('button', { name: /Anime/ }).click();
  await bar.getByRole('group', { name: 'Load next' }).getByRole('button', { name: /Qwen/ }).click();
  await expect(bar).toContainText('3rd in line');
  // Qwen moves up to come next.
  await bar.getByRole('button', { name: 'Load Qwen Uncensored next' }).click();
  await expect.poll(() => loads).toEqual([
    { id: 'h3-max', first: false },
    { id: 'anime', first: false },
    { id: 'qwen', first: false },
    { id: 'qwen', first: true },
  ]);
  await expect(bar).toContainText(/Qwen Uncensored\s*0% · 2nd in line/);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath('make-pick-line.png') });
  expect(errors).toEqual([]);
});

test('Make on GPU.ai: while the machine starts, tap what loads first; the order is saved for it', async ({ page }, info) => {
  await mockAi(page, 'off');
  const posts: Record<string, unknown>[] = [];
  let first: string[] = [];
  await page.route('**/api/ai', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { makers?: string[] };
      posts.push(body);
      first = body.makers ?? first;
    }
    await route.fulfill({ json: { state: 'starting', costPerHour: 0.45, autoOffMinutes: 60, tier: 'standard', tiers: [], picks: { library: ['qwen', 'edit', 'h3-max'], first } } });
  });
  await page.route(/\/api\/make(\?.*)?$/, (r) => r.fulfill({ json: { configured: false } }));
  await openOrbit(page);
  const win = await openMakeApp(page);
  await expect(win.getByText('Nothing loads until you pick')).toBeVisible();
  // Folded at first: the makers menu sets the order too, and the whole list would fill a phone.
  await expect(win.getByRole('group', { name: 'Pick what loads first' })).toHaveCount(0);
  await win.getByRole('button', { name: 'All makers' }).click();
  const group = win.getByRole('group', { name: 'Pick what loads first' });
  await expect(group).toBeVisible();
  // Every maker the AI machine can run, yours first, the rest by what they make.
  await expect(group.getByRole('group', { name: 'Yours', exact: true }).getByRole('button')).toHaveCount(3);
  for (const g of ['Pictures', 'Edit pictures', 'Videos', 'Edit videos', '3D objects', 'Rigging']) await expect(group.getByRole('group', { name: g, exact: true })).toBeVisible();
  await expect(group.getByRole('group', { name: '3D objects' }).getByRole('button', { name: '3D object' })).toBeVisible();
  // One that isn't yours can go first too.
  await group.getByRole('group', { name: '3D objects' }).getByRole('button', { name: '3D object' }).click();
  await expect.poll(() => posts.at(-1)).toEqual({ action: 'first', makers: ['trellis2'] });
  await group.getByRole('group', { name: '3D objects' }).getByRole('button', { name: /3D object/ }).first().click();
  await expect.poll(() => posts.at(-1)).toEqual({ action: 'first', makers: [] });
  const yours = group.getByRole('group', { name: 'Yours', exact: true });
  await yours.getByRole('button', { name: /H3 Max/ }).click();
  await yours.getByRole('button', { name: /Qwen Uncensored/ }).click();
  await expect(yours.getByRole('button', { name: /H3 Max/ })).toContainText('1st');
  await expect(yours.getByRole('button', { name: /Qwen Uncensored/ })).toContainText('2nd');
  await expect.poll(() => posts.at(-1)).toEqual({ action: 'first', makers: ['h3-max', 'qwen'] });
  // Tapped again: out of the order.
  await yours.getByRole('button', { name: /H3 Max/ }).click();
  await expect.poll(() => posts.at(-1)).toEqual({ action: 'first', makers: ['qwen'] });
  await expect(yours.getByRole('button', { name: /Qwen Uncensored/ })).toContainText('1st');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath('make-pick-starting.png') });
});

test('Make: the "turn the AI machine on" message hides into a pill, comes back, and stays hidden after a reload', async ({ page }, info) => {
  await mockAi(page, 'off');
  await page.route(/\/api\/make(\?.*)?$/, (r) => r.fulfill({ json: { configured: false } }));
  await openOrbit(page);
  const win = await openMakeApp(page);
  const banner = win.locator('.make-banner');
  await expect(banner).toBeVisible();
  await win.getByRole('button', { name: 'Hide this message' }).click();
  await expect(banner).toBeHidden();
  const pill = win.getByRole('button', { name: /AI machine off/ });
  await expect(pill).toBeVisible();
  await page.screenshot({ path: info.outputPath('make-notice-hidden.png') });
  await page.reload();
  const again = await openMakeApp(page);
  await expect(again.locator('.make-banner')).toBeHidden();
  await again.getByRole('button', { name: /AI machine off/ }).click();
  await expect(again.locator('.make-banner')).toBeVisible();
  await page.screenshot({ path: info.outputPath('make-notice-shown.png') });
  await expectNoHorizontalOverflow(page);
});

test('Make: pick Standard or Turbo before turning the AI machine on; the pick is remembered', async ({ page }) => {
  const calls: Record<string, unknown>[] = [];
  await mockAi(page, 'off', calls);
  await page.route(/\/api\/make(\?.*)?$/, (r) => r.fulfill({ json: { configured: false } }));
  await openOrbit(page);
  const win = await openMakeApp(page);
  const speed = win.locator('.make-banner').getByRole('group', { name: 'Speed' });
  await expect(speed.getByRole('button', { name: 'Standard · $0.59/h' })).toHaveAttribute('aria-pressed', 'true');
  await speed.getByRole('button', { name: 'Turbo · $2.89/h' }).click();
  await win.locator('.make-banner').getByRole('button', { name: 'Turn it on' }).click();
  await expect.poll(() => calls.find((c) => c.action === 'start')).toMatchObject({ action: 'start', tier: 'turbo' });
  expect(await page.evaluate(() => localStorage.getItem('orbit.speed'))).toBe('turbo');
});

test('Make on GPU.ai: Turn it on shows every GPU first; Cancel leaves it off, a pick turns it on and is remembered', async ({ page }, info) => {
  const calls: Record<string, unknown>[] = [];
  await mockAi(page, 'off', calls);
  await page.route(/\/api\/make(\?.*)?$/, (r) => r.fulfill({ json: { configured: false } }));
  await page.route('**/api/ai/gpus?machine=ai', (r) =>
    r.fulfill({
      json: {
        recommended: 'l40s',
        options: [
          { gpu: 'rtx_4000_ada', name: 'RTX 4000 Ada', memoryGb: 20, pricePerHour: 0.28, region: 'eu-east', free: 4, fits: 'no', note: 'Too small for your makers', videoMinutes: 15 },
          { gpu: 'l40s', name: 'L40S', memoryGb: 48, pricePerHour: 0.8, region: 'us-central', free: 58, fits: 'yes', note: 'Everything: pictures and H3 Max videos', videoMinutes: 4 },
          { gpu: 'a100_80gb', name: 'A100 80 GB', memoryGb: 80, pricePerHour: 1.23, region: 'us-central', free: 15, fits: 'yes', note: 'Everything: pictures and H3 Max videos', videoMinutes: 3 },
          { gpu: 'h100_sxm', name: 'H100 SXM', memoryGb: 80, pricePerHour: 3.99, region: 'us-east', free: 8, fits: 'yes', note: 'Everything: pictures and H3 Max videos', videoMinutes: 2 },
        ],
      },
    }),
  );
  await openOrbit(page);
  const win = await openMakeApp(page);
  const banner = win.locator('.make-banner');
  await banner.getByRole('button', { name: 'Turn it on' }).click();
  const sheet = page.getByRole('dialog', { name: 'Pick a GPU for your AI machine' });
  await expect(sheet.getByRole('radio')).toHaveCount(4);
  await expect(sheet.getByRole('radio', { name: /L40S/ })).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByRole('radio', { name: /RTX 4000 Ada/ })).toContainText('Too small');
  await expect(sheet.getByRole('radio', { name: /A100/ })).toContainText('5 s video about 3 min');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath('gpu-ai.png') });
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toHaveCount(0);
  expect(calls.filter((c) => c.action === 'start')).toEqual([]);

  await banner.getByRole('button', { name: 'Turn it on' }).click();
  await sheet.getByRole('radio', { name: /H100 SXM/ }).click();
  await sheet.getByRole('button', { name: 'Turn on · H100 SXM · $3.99/h' }).click();
  await expect.poll(() => calls.find((c) => c.action === 'start')).toMatchObject({ action: 'start', gpu: 'h100_sxm' });
  expect(await page.evaluate(() => localStorage.getItem('orbit.gpu.ai'))).toBe('h100_sxm');
});

test('Make: the × of the "turn the AI machine on" message never sits on its words, and the message keeps its margins', async ({ page }) => {
  await mockAi(page, 'off');
  await page.route(/\/api\/make(\?.*)?$/, (r) => r.fulfill({ json: { configured: false } }));
  await openOrbit(page);
  const win = await openMakeApp(page);
  const banner = win.locator('.make-banner');
  await expect(banner).toBeVisible();
  const words = await banner.locator('p').first().boundingBox();
  const hide = await win.getByRole('button', { name: 'Hide this message' }).boundingBox();
  const wrap = await win.locator('.notice-wrap').boundingBox();
  expect(words && hide && wrap).toBeTruthy();
  expect(words!.x + words!.width).toBeLessThanOrEqual(hide!.x + 1);
  expect(wrap!.x).toBeGreaterThanOrEqual(12);
  // The × is on the screen, with the same margin on the right.
  const vw = page.viewportSize()!.width;
  expect(hide!.x + hide!.width).toBeLessThanOrEqual(vw - 8);
  expect(wrap!.x + wrap!.width).toBeLessThanOrEqual(vw - 8);
  await win.getByRole('button', { name: 'Hide this message' }).click();
  await expect(banner).toBeHidden();
});

test('Make on GPU.ai: the makers menu shows every maker; tapping ones not loaded lines them up in the order tapped', async ({ page }, info) => {
  await mockAi(page, 'on');
  const loads: { id: string; first: boolean }[] = [];
  const line: string[] = [];
  const row = (id: string, kind: string, name: string, installed = false) => {
    if (installed) return { id, kind, name, installed: true, wanted: true, percent: 100, size: 1e9 };
    const at = line.indexOf(id);
    return at < 0
      ? { id, kind, name, installed: false, wanted: false, percent: 0, size: 2e10, loadable: true }
      : { id, kind, name, installed: false, wanted: true, percent: at ? 0 : 12, size: 2e10, status: at ? 'waiting' : 'downloading', line: at + 1 };
  };
  const makers = () => [row('qwen', 'image', 'Qwen Uncensored', true), row('krea-real', 'image', 'Krea Real'), row('anime', 'image', 'Anime'), row('h3-max', 'video', 'H3 Max')];
  await page.route('**/fake-ai/_orbit/studio', (r) => r.fulfill({ json: { setup: 'running', running: true, image: READY, video: READY, downloading: null, downloadError: null, jobs: [] } }));
  await page.route('**/fake-ai/_orbit/studio/makers', (r) => r.fulfill({ json: { makers: makers() } }));
  await page.route('**/fake-ai/_orbit/studio/makers/load', (r) => {
    const body = r.request().postDataJSON() as { id: string; first: boolean };
    loads.push(body);
    const at = line.indexOf(body.id);
    if (at >= 0) line.splice(at, 1);
    if (body.first) line.splice(Math.min(1, line.length), 0, body.id);
    else line.push(body.id);
    return r.fulfill({ json: { makers: makers() } });
  });
  await page.route('**/fake-ai/_orbit/studio/items', (r) => r.fulfill({ json: { items: [] } }));

  const errors = await openOrbit(page);
  const win = await openMakeApp(page);
  await win.getByRole('button', { name: 'Next: Maker & style' }).click();
  const menu = win.getByRole('radiogroup', { name: 'Maker' });
  // The loaded one first, then the ones to load (pictures only: this is a picture).
  await expect(menu.getByRole('radio')).toHaveCount(3);
  await expect(menu.getByRole('radio').first()).toHaveAccessibleName(/^Qwen Uncensored/);
  await expect(menu.getByRole('radio', { name: /^Krea Real/ })).toContainText('tap to load');
  // Tapped in the order wanted; the menu stays put so the next can be tapped.
  await menu.getByRole('radio', { name: /^Krea Real/ }).click();
  await expect.poll(() => loads).toEqual([{ id: 'krea-real', first: false }]);
  await menu.getByRole('radio', { name: /^Anime/ }).click();
  await expect.poll(() => loads.length).toBe(2);
  await expect(menu.getByRole('radio', { name: /^Anime/ })).toContainText('2nd in line');
  await expect(win.getByRole('heading', { level: 3, name: 'Who makes it' })).toBeVisible();
  // The bar at the top shows the line at once.
  await expect(win.getByRole('region', { name: 'Makers loading' })).toContainText('Loading 2 makers');
  // The chosen one moves up.
  await win.getByRole('button', { name: 'Load it next' }).click();
  await expect.poll(() => loads.at(-1)).toEqual({ id: 'anime', first: true });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath('make-menu-line.png') });
  expect(errors).toEqual([]);
});

test('Make on GPU.ai: while the machine starts, the makers menu sets what loads first, and the bar shows the same order', async ({ page }, info) => {
  await mockAi(page, 'off');
  const posts: { action: string; makers: string[] }[] = [];
  let first: string[] = [];
  await page.route('**/api/ai', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { action: string; makers: string[] };
      posts.push(body);
      first = body.makers ?? first;
    }
    await route.fulfill({ json: { state: 'starting', costPerHour: 0.45, autoOffMinutes: 60, tier: 'standard', tiers: [], picks: { library: ['qwen', 'edit', 'h3-max'], first } } });
  });
  await page.route(/\/api\/make(\?.*)?$/, (r) => r.fulfill({ json: { configured: false } }));
  await openOrbit(page);
  const win = await openMakeApp(page);
  await win.getByRole('button', { name: 'Next: Maker & style' }).click();
  const menu = win.getByRole('radiogroup', { name: 'Maker' });
  await menu.getByRole('radio', { name: /^Anime/ }).click();
  await expect.poll(() => posts.at(-1)).toEqual({ action: 'first', makers: ['anime'] });
  await menu.getByRole('radio', { name: /^Krea Real/ }).click();
  await expect.poll(() => posts.at(-1)).toEqual({ action: 'first', makers: ['anime', 'krea-real'] });
  await expect(menu.getByRole('radio', { name: /^Krea Real/ })).toContainText('loads 2nd');
  await expect(win.getByText('Krea Real loads 2nd when your AI machine is up')).toBeVisible();
  // The bar at the top shows the same order, in one line.
  await expect(win.getByText('Loads first: 1st Anime, 2nd Krea Real.')).toBeVisible();
  // Moved to the front, then out.
  await win.getByRole('button', { name: 'Load it first' }).click();
  await expect.poll(() => posts.at(-1)).toEqual({ action: 'first', makers: ['krea-real', 'anime'] });
  await expect(menu.getByRole('radio', { name: /^Krea Real/ })).toContainText('loads 1st');
  await win.getByRole('button', { name: 'Take it out' }).click();
  await expect.poll(() => posts.at(-1)).toEqual({ action: 'first', makers: ['anime'] });
  await expect(menu.getByRole('radio', { name: /^Krea Real/ })).toContainText('tap to load');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath('make-menu-first.png') });
});
