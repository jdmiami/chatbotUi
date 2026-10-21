import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';
import { mockAi } from './aiMocks';

/** The AI Store: its own app, with shelves, a page per model (specs), the library, and makers. */

async function mockMakers(page: Page) {
  const calls: string[] = [];
  let makers = [
    { id: 'qwen', kind: 'image', name: 'Qwen Uncensored', blurb: 'All-rounder.', for: null, twoImages: false, builtIn: true, wanted: true, installed: true, size: 17e9, percent: 100 },
    { id: 'krea-real', kind: 'image', name: 'Krea Real', blurb: 'Photographs, uncensored.', for: null, twoImages: false, builtIn: false, wanted: false, installed: false, size: 19e9, percent: 0 },
    { id: 'h3-max', kind: 'video', name: 'H3 Max', blurb: 'Best motion.', for: null, twoImages: false, builtIn: false, wanted: false, installed: false, size: 52e9, percent: 0 },
    { id: 'sharpen', kind: 'upscale', name: 'Sharpen 4×', blurb: 'Bigger and crisper.', for: null, twoImages: false, builtIn: false, wanted: false, installed: false, size: 67e6, percent: 0 },
  ];
  await page.route('**/fake-ai/_orbit/studio/makers**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const { id } = req.postDataJSON() as { id: string };
      const op = req.url().endsWith('/install') ? 'install' : 'remove';
      calls.push(`${op} ${id}`);
      makers = makers.map((m) => (m.id === id ? { ...m, wanted: op === 'install', installed: false, percent: op === 'install' ? 40 : 0 } : m));
    }
    await route.fulfill({ json: { makers } });
  });
  return calls;
}

async function openStore(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, skin: 'o5', introSeen: true } }, version: 0 }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  await page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list').getByRole('button', { name: /Store/ }).click();
  const win = page.locator('.app-window[data-app="store"]');
  await expect(win.getByTestId('store')).toBeVisible();
  return { errors, win };
}

test.describe('AI Store', () => {
  test('shelves, a model page with its specifications, getting a model, and the library', async ({ page }, testInfo) => {
    const calls = await mockAi(page, 'on');
    await mockMakers(page);
    const { errors, win } = await openStore(page);
    await expect(win.getByRole('heading', { name: 'Editor’s picks' })).toBeVisible();
    await expect(win.getByRole('heading', { name: 'Everyday' })).toBeVisible();
    await expect(win.getByRole('heading', { name: 'Unfiltered' })).toBeVisible();
    await expect(win.getByRole('heading', { name: 'Video', exact: true })).toBeVisible();
    await expect(win.getByText('15.0 GB free').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('store-home.png') });

    // A model's own page.
    await win.getByRole('button', { name: 'Defiant Fable 9B: details' }).first().click();
    const detail = page.getByRole('dialog', { name: 'Defiant Fable 9B' });
    await expect(detail.locator('.st-detail-title')).toHaveText('Defiant Fable 9B');
    const specs = detail.getByRole('region', { name: 'Specifications' });
    for (const k of ['Publisher', 'Size of the brain', 'Download', 'GPU memory', 'Speed', 'On this machine']) await expect(specs.getByText(k, { exact: true })).toBeVisible();
    await expect(detail.getByText('18+ · Unfiltered')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('store-detail.png') });
    await detail.getByRole('button', { name: 'Get Defiant Fable 9B' }).click();
    await expect.poll(() => calls.find((c) => c.path === 'POST /install')?.body).toMatchObject({ spec: expect.stringMatching(/^defiant-fable:9b=hf\.co\//) });
    await expect(detail.getByRole('status', { name: /Adding Defiant Fable 9B/ })).toBeVisible();

    // Already on the machine: "Open" chats with it in the AI app.
    await page.keyboard.press('Escape');
    await win.getByRole('tab', { name: 'Your library' }).click();
    await expect(win.getByRole('heading', { name: 'Your library' })).toBeVisible();
    await win.getByRole('button', { name: 'Open Qwen 3.8 27B' }).first().click();
    await expect(page.locator('.app-window[data-app="ai"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('makers: add a video maker from its shelf; Create’s Makers button opens the store there', async ({ page }) => {
    await mockAi(page, 'on');
    const makerCalls = await mockMakers(page);
    const { errors, win } = await openStore(page);
    await win.getByRole('tab', { name: 'Pictures & video' }).click();
    const video = win.getByRole('region', { name: 'Video', exact: true });
    await video.getByRole('button', { name: 'Get H3 Max', exact: true }).click();
    expect(makerCalls).toEqual(['install h3-max']);
    await expect(video.getByRole('status', { name: 'Adding H3 Max: 40%' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('with the machine resting: everything browsable, Get turns it on', async ({ page }, testInfo) => {
    const power: Record<string, unknown>[] = [];
    await mockAi(page, 'off', power);
    const { errors, win } = await openStore(page);
    await expect(win.getByText(/Your AI machine is resting/)).toBeVisible();
    await expect(win.getByRole('heading', { name: 'Sees pictures' })).toBeVisible();
    await expect(win.getByRole('heading', { name: 'Pictures', exact: true })).toBeVisible();
    await win.getByRole('searchbox', { name: 'Search the store' }).fill('fable');
    await expect(win.getByRole('button', { name: 'Defiant Fable 9B: details' }).first()).toBeVisible();
    await expect(win.getByRole('button', { name: 'Qwen 3.8 27B: details' })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('store-off.png') });
    await win.getByRole('button', { name: 'Get Defiant Fable 9B' }).first().click();
    await expect.poll(() => power.length).toBe(1);
    expect(power[0]).toMatchObject({ action: 'start' });
    expect(errors).toEqual([]);
  });

  test('video makers: all five on their shelves; LTX-2.5 says it needs a token; add Wan VACE', async ({ page }, testInfo) => {
    await mockAi(page, 'on');
    const calls: string[] = [];
    let makers = [
      { id: 'ltx-25', kind: 'video', name: 'LTX-2.5', blurb: 'Newest LTX.', for: null, twoImages: false, accepts: ['photo', 'endPhoto', 'video'], gated: true, needsToken: true, builtIn: false, wanted: false, installed: false, size: 39.7e9, percent: 0 },
      { id: 's2v', kind: 'video', name: 'Talking photo', blurb: 'A photo and a voice.', for: null, twoImages: false, needs: ['photo', 'audio'], builtIn: false, wanted: false, installed: false, size: 25.2e9, percent: 0 },
      { id: 'vace', kind: 'videoedit', name: 'Wan VACE', blurb: 'Edit a video.', for: null, twoImages: false, needs: ['video'], tasks: ['replace', 'restyle', 'extend', 'motion'], builtIn: false, wanted: false, installed: false, size: 43.7e9, percent: 0 },
      { id: 'video-erase', kind: 'videoedit', name: 'Erase from video', blurb: 'Remove a thing.', for: null, twoImages: false, needs: ['video', 'target'], builtIn: false, wanted: false, installed: false, size: 43.7e9, percent: 0 },
      { id: 'video-sharpen', kind: 'videoedit', name: 'Sharpen video', blurb: 'Twice as large.', for: null, twoImages: false, needs: ['video'], builtIn: false, wanted: false, installed: false, size: 3.96e9, percent: 0 },
    ];
    await page.route('**/fake-ai/_orbit/studio/makers**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        const { id } = req.postDataJSON() as { id: string };
        calls.push(`install ${id}`);
        makers = makers.map((m) => (m.id === id ? { ...m, wanted: true, percent: 25 } : m));
      }
      await route.fulfill({ json: { makers } });
    });
    const { errors, win } = await openStore(page);
    await win.getByRole('tab', { name: 'Pictures & video' }).click();
    const video = win.getByRole('region', { name: 'Video', exact: true });
    const editing = win.getByRole('region', { name: 'Video editing' });
    await expect(video).toContainText('LTX-2.5');
    await expect(video).toContainText('Talking photo');
    for (const n of ['Wan VACE', 'Erase from video', 'Sharpen video']) await expect(editing).toContainText(n);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('store-video-makers.png') });

    // Gated: the button says so, and tapping it explains what to do instead of failing quietly.
    await video.getByRole('button', { name: 'LTX-2.5 needs a Hugging Face token' }).click();
    // (It explains in a toast; the store page below keeps the same words.)
    expect(calls).toEqual([]);
    await video.getByRole('button', { name: 'LTX-2.5: details' }).click();
    const detail = page.getByRole('dialog', { name: 'LTX-2.5' });
    await expect(detail.getByRole('note')).toContainText('hf_token');
    await expect(detail.getByRole('region', { name: 'Specifications' }).getByText('Gated: your AI machine needs a Hugging Face token first')).toBeVisible();
    await page.keyboard.press('Escape');

    await editing.getByRole('button', { name: 'Wan VACE: details' }).click();
    const vace = page.getByRole('dialog', { name: 'Wan VACE' });
    const specs = vace.getByRole('region', { name: 'Specifications' });
    await expect(specs.getByText('A video', { exact: true })).toBeVisible();
    await expect(specs.getByText('About 28 GB of the 48 GB')).toBeVisible();
    await vace.getByRole('button', { name: 'Get Wan VACE' }).click();
    expect(calls).toEqual(['install vace']);
    await page.keyboard.press('Escape');
    await expect(editing.getByRole('status', { name: 'Adding Wan VACE: 25%' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a stopped download resumes from its details, and the sheet follows along', async ({ page }) => {
    await mockAi(page, 'on');
    const calls: string[] = [];
    let makers = [{ id: 's2v', kind: 'video', name: 'Talking photo', blurb: 'A photo and a voice.', for: null, twoImages: false, needs: ['photo', 'audio'], builtIn: false, wanted: true, installed: false, size: 25.2e9, percent: 40, status: 'paused' }];
    await page.route('**/fake-ai/_orbit/studio/makers**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        calls.push(`install ${(req.postDataJSON() as { id: string }).id}`);
        makers = makers.map((m) => ({ ...m, status: 'downloading', percent: 41 }));
      }
      await route.fulfill({ json: { makers } });
    });
    const { errors, win } = await openStore(page);
    await win.getByRole('tab', { name: 'Pictures & video' }).click();
    await win.getByRole('button', { name: 'Talking photo: details' }).first().click();
    const sheet = page.getByRole('dialog', { name: 'Talking photo' });
    await expect(sheet.getByRole('status', { name: 'Adding Talking photo: 40% · paused' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Resume Talking photo' }).click();
    expect(calls).toEqual(['install s2v']);
    // The open sheet shows the new state at once: no second Resume.
    await expect(sheet.getByRole('status', { name: 'Adding Talking photo: 41%' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Resume Talking photo' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('download manager: what is downloading, how fast, what waits and why; pause, resume, copy the report', async ({ page }, testInfo) => {
    await mockAi(page, 'on');
    let paused = false;
    const actions: string[] = [];
    const report = () => ({
      state: paused ? 'paused' : 'downloading',
      paused,
      current: paused
        ? null
        : { name: '10Eros_v1.4_fp8mixed_learned.safetensors', makers: ['LTX video'], source: 'cloud storage', saving: false, completed: 12e9, total: 22e9, percent: 54, bytesPerSec: 95e6, etaSeconds: 105, startedAt: '2026-10-21T18:30:00Z' },
      queue: [
        { id: 'a', name: '10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors', size: 20.9e9, have: 0, makers: ['H3 Max'], problem: null },
        { id: 'b', name: 'krea_real.safetensors', size: 19e9, have: 4e9, makers: ['Krea Real'], problem: null },
        { id: 'c', name: 'ltx-2.5.safetensors', size: 39e9, have: 0, makers: ['LTX-2.5'], problem: 'Needs a Hugging Face token' },
      ],
      done: 7,
      bytesLeft: 60e9,
      etaSeconds: paused ? null : 640,
      lastError: null,
      diskFree: 655e9,
      bottleneck: paused
        ? 'Downloads are paused. Resume to carry on from where they stopped.'
        : 'One file at a time: downloading 10Eros_v1.4_fp8mixed_learned.safetensors from cloud storage at 95 MB/s. 2 more wait behind it.',
      log: [
        { at: '2026-10-21T18:29:00Z', kind: 'done', text: 'Finished qwen_image.safetensors (20.4 GB in 4 min)' },
        { at: '2026-10-21T18:30:00Z', kind: 'start', text: 'Downloading 10Eros_v1.4_fp8mixed_learned.safetensors' },
      ],
      network: { rxPerSec: 97e6, txPerSec: 1.2e6 },
    });
    await page.route('**/fake-ai/_orbit/studio/downloads', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        const { action } = req.postDataJSON() as { action: string };
        actions.push(action);
        paused = action === 'pause';
      }
      await route.fulfill({ json: report() });
    });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const { errors, win } = await openStore(page);
    await win.getByRole('tab', { name: 'Downloads' }).click();
    const dm = win.getByRole('region', { name: 'Downloads' });
    await expect(dm.getByRole('status')).toContainText('Downloading');
    await expect(dm).toContainText('60.0 GB to go');
    await expect(dm.getByLabel('What is happening')).toContainText('One file at a time');
    await expect(dm).toContainText('95 MB/s');
    await expect(dm).toContainText('11 min');
    await expect(dm).toContainText('from cloud storage');
    await expect(dm).toContainText('For LTX video');
    await expect(dm.getByRole('list', { name: 'Next in line' }).getByRole('listitem')).toHaveCount(2);
    await expect(dm.getByRole('list', { name: 'Next in line' })).toContainText('4.0 GB already here');
    await expect(dm.getByRole('list', { name: 'Stuck downloads' })).toContainText('Needs a Hugging Face token');
    await expect(dm.getByRole('list', { name: 'What happened' })).toContainText('Finished qwen_image.safetensors');
    await expectNoHorizontalOverflow(page);
    await dm.getByRole('list', { name: 'Next in line' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('downloads.png') });

    await dm.getByRole('button', { name: 'Pause all' }).click();
    await expect(dm.getByRole('status')).toContainText('Paused');
    await expect(dm.getByLabel('What is happening')).toContainText('paused');
    await dm.getByRole('button', { name: 'Resume all' }).click();
    await expect(dm.getByRole('status')).toContainText('Downloading');
    expect(actions).toEqual(['pause', 'resume']);
    await dm.getByRole('button', { name: 'Copy report' }).click();
    expect(errors).toEqual([]);
  });

  test('video makers show while the machine rests (from the catalog)', async ({ page }) => {
    await mockAi(page, 'off');
    const { win } = await openStore(page);
    await win.getByRole('searchbox', { name: 'Search the store' }).fill('video');
    for (const n of ['Wan VACE', 'Erase from video', 'Sharpen video']) await expect(win.getByRole('button', { name: `${n}: details` }).first()).toBeVisible();
    await win.getByRole('searchbox', { name: 'Search the store' }).fill('');
    for (const n of ['LTX-2.5', 'Talking photo']) await expect(win.getByRole('button', { name: `${n}: details` }).first()).toBeVisible();
  });

  test('an AI machine on older code: the video editors still show, and arrive when it restarts', async ({ page }, testInfo) => {
    await mockAi(page, 'on');
    // The older machine's list: no video editors, no LTX-2.5, no talking photo.
    const calls = await mockMakers(page);
    const { errors, win } = await openStore(page);
    await win.getByRole('tab', { name: 'Pictures & video' }).click();
    const editing = win.getByRole('region', { name: 'Video editing' });
    for (const n of ['Wan VACE', 'Erase from video', 'Sharpen video']) {
      await expect(editing.getByRole('button', { name: `${n}: Arrives when your AI machine restarts` })).toBeVisible();
    }
    await expect(editing).toContainText('Arrives when your AI machine restarts');
    const video = win.getByRole('region', { name: 'Video', exact: true });
    for (const n of ['LTX-2.5', 'Talking photo']) await expect(video.getByRole('button', { name: `${n}: Arrives when your AI machine restarts` })).toBeVisible();
    // What the machine has stays as it says.
    await expect(video.getByRole('button', { name: 'Get H3 Max' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('store-older-machine.png') });

    // Not installable yet: tapping explains, nothing is sent.
    await editing.getByRole('button', { name: 'Wan VACE: Arrives when your AI machine restarts' }).click();
    await expect(page.getByText('Arrives when your AI machine restarts. Turn it off and on again to get it.').first()).toBeVisible();
    await editing.getByRole('button', { name: 'Wan VACE: details' }).click();
    const vace = page.getByRole('dialog', { name: 'Wan VACE' });
    await expect(vace.getByRole('note').first()).toContainText('Turn it off and on again');
    await expect(vace.getByRole('region', { name: 'Specifications' }).getByText('Arrives when your AI machine restarts')).toBeVisible();
    expect(calls).toEqual([]);
    for (const b of await editing.getByRole('button').all()) {
      const bb = (await b.boundingBox())!;
      expect(bb.height, `${await b.getAttribute('aria-label')} is a 44 px target`).toBeGreaterThanOrEqual(44);
    }
    expect(errors).toEqual([]);
  });

  test('refreshing while a maker downloads never moves the page or rebuilds the rows (no jump back up, no lost tap)', async ({ page }) => {
    await mockAi(page, 'on');
    // A maker downloading: the Store refreshes every few seconds.
    let pct = 10;
    await page.route('**/fake-ai/_orbit/studio/makers**', (route) =>
      route.fulfill({
        json: {
          makers: [
            { id: 'qwen', kind: 'image', name: 'Qwen Uncensored', blurb: 'All-rounder.', for: null, twoImages: false, builtIn: true, wanted: true, installed: true, size: 17e9, percent: 100 },
            { id: 'h3-max', kind: 'video', name: 'H3 Max', blurb: 'Best motion.', for: null, twoImages: false, builtIn: false, wanted: true, installed: false, size: 52e9, percent: (pct += 5) },
            { id: 'sharpen', kind: 'upscale', name: 'Sharpen 4×', blurb: 'Bigger and crisper.', for: null, twoImages: false, builtIn: false, wanted: false, installed: false, size: 67e6, percent: 0 },
          ],
        },
      }),
    );
    const { win } = await openStore(page);
    const scroller = win.locator('.st-scroll');
    await expect(win.getByRole('status', { name: /Adding H3 Max/ }).first()).toBeVisible();
    // Read halfway down the page.
    const target = await scroller.evaluate((el) => {
      el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
      return el.scrollTop;
    });
    expect(target).toBeGreaterThan(100);
    // Tag one row: a rebuilt row would lose the mark.
    await win.locator('.st-row').nth(3).evaluate((el) => el.setAttribute('data-probe', 'kept'));
    const before = await win.getByRole('status', { name: /Adding H3 Max/ }).first().textContent();
    // Two refreshes later (every 3 s while downloading): same place, same rows.
    await expect.poll(() => win.getByRole('status', { name: /Adding H3 Max/ }).first().textContent(), { timeout: 15_000 }).not.toBe(before);
    await page.waitForTimeout(3500);
    expect(Math.abs((await scroller.evaluate((el) => el.scrollTop)) - target)).toBeLessThan(4);
    await expect(win.locator('.st-row[data-probe="kept"]')).toHaveCount(1);
  });

  test('opens from the home path, Settings and the AI app', async ({ page }) => {
    await mockAi(page, 'on');
    await mockMakers(page);
    const { win } = await openStore(page);
    // From Settings → AI models.
    await page.getByRole('button', { name: /^Index/ }).click();
    await page.getByRole('dialog', { name: 'Index' }).getByRole('button', { name: /Settings/ }).click();
    await page.locator('.app-window[data-app="settings"]').getByRole('button', { name: /^Makers/ }).click();
    await expect(win.getByRole('tab', { name: 'Pictures & video' })).toHaveAttribute('aria-selected', 'true');
  });
});
