import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, openOrbit } from './helpers';
import { mockAi, openMakeApp } from './aiMocks';

/**
 * Make as a walk-through: one step per screen. Swipe left for the next step, right to go back;
 * buttons named after the step they go to; dots to jump; hold to talk and "Fill for me" on the
 * text steps; nothing on a step scrolls.
 */

const READY = { ready: true, downloaded: true, percent: 100 };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const MAKERS = [
  { id: 'qwen', kind: 'image', name: 'Qwen Uncensored', blurb: 'All-rounder.', for: null, builtIn: true, wanted: true, installed: true, percent: 100 },
  { id: 'krea-real', kind: 'image', name: 'Krea Real', blurb: 'Photoreal.', for: null, builtIn: false, wanted: true, installed: true, percent: 100 },
  { id: 'style-darkbrush', kind: 'style', name: 'Dark brush', blurb: 'A look.', for: 'krea-real', builtIn: false, wanted: true, installed: true, percent: 100 },
  { id: 'ltx', kind: 'video', name: 'LTX 10Eros', blurb: 'Video with sound.', for: null, builtIn: true, wanted: true, installed: true, percent: 100 },
  { id: 'ltx-25', kind: 'video', name: 'LTX-2.5', blurb: 'Newest.', for: null, accepts: ['photo', 'endPhoto', 'video'], needs: [], builtIn: false, wanted: true, installed: true, percent: 100 },
  { id: 'h3-max', kind: 'video', name: 'H3 Max', blurb: 'Best motion.', for: null, builtIn: false, wanted: true, installed: true, percent: 100 },
  { id: 's2v', kind: 'video', name: 'Talking photo', blurb: 'A photo and a voice.', for: null, needs: ['photo', 'audio'], builtIn: false, wanted: true, installed: true, percent: 100 },
  { id: 'wan', kind: 'video', name: 'Wan Video', blurb: 'Cinematic.', for: null, builtIn: false, wanted: true, installed: true, percent: 100 },
  { id: 'edit', kind: 'edit', name: 'Edit with words', blurb: 'Change a picture.', for: null, builtIn: true, wanted: true, installed: true, percent: 100 },
  { id: 'vace', kind: 'videoedit', name: 'Wan VACE', blurb: 'Edit a video.', for: null, needs: ['video'], tasks: ['replace', 'restyle', 'extend', 'motion'], builtIn: false, wanted: true, installed: true, percent: 100 },
].map((m) => ({ twoImages: false, size: 1e9, ...m }));

async function mockStudio(page: Page) {
  const requests: Record<string, unknown>[] = [];
  await page.route('**/fake-ai/_orbit/studio', (r) => r.fulfill({ json: { setup: 'running', running: true, image: READY, video: READY, downloading: null, downloadError: null, jobs: [] } }));
  await page.route('**/fake-ai/_orbit/studio/makers', (r) => r.fulfill({ json: { makers: MAKERS } }));
  await page.route('**/fake-ai/_orbit/studio/items', (r) =>
    r.fulfill({ json: { items: [{ id: 'img1', kind: 'image', prompt: 'a red fox in snow', width: 1328, height: 1328, createdAt: '2026-10-16T10:00:00Z', url: '/_orbit/studio/file/img1?t=tok' }] } }),
  );
  await page.route('**/fake-ai/_orbit/studio/file/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route('**/fake-ai/_orbit/studio/jobs', (r) => {
    const body = r.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    return r.fulfill({ json: { id: `job${requests.length}`, kind: body.kind, prompt: body.prompt, status: 'queued', progress: 0, error: null, createdAt: '', item: null, position: 1, etaSeconds: 40 } });
  });
  await page.route('**/fake-ai/_orbit/studio/jobs/*', (r) => r.fulfill({ json: { id: 'job1', kind: 'image', prompt: 'x', status: 'running', progress: 40, error: null, createdAt: '', item: null } }));
  return requests;
}

/** The step on screen (its heading), and the page that holds it. */
const pane = (win: Locator) => win.locator('.mk-pane[data-live]');
async function expectStep(win: Locator, title: string) {
  await expect(pane(win).getByRole('heading', { level: 3 })).toHaveText(title);
  // Settled: only one page left on the stage.
  await expect(win.locator('.mk-pane')).toHaveCount(1);
}

/** A real finger swipe across the middle of the step (touch events, through the browser's input pipeline). */
async function swipe(page: Page, win: Locator, dir: 'left' | 'right', from?: { x: number; y: number }) {
  const box = (await win.locator('.mk-stage').boundingBox())!;
  const start = from ?? { x: box.x + box.width * (dir === 'left' ? 0.75 : 0.25), y: box.y + box.height * 0.88 };
  const dx = (dir === 'left' ? -1 : 1) * box.width * 0.55;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (dx * i) / 8, y: start.y + i }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function openMake(page: Page) {
  const errors = await openOrbit(page);
  const win = await openMakeApp(page);
  await expectStep(win, 'What will it be?');
  return { errors, win };
}

/** Nothing on the step scrolls, and nothing sticks out sideways. */
async function expectFits(page: Page, win: Locator, name: string) {
  const m = await pane(win).evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  expect(m.sh, `${name}: the step fits without scrolling`).toBeLessThanOrEqual(m.ch + 1);
  const root = await win.locator('.make-root').evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  expect(root.sh, `${name}: Make itself does not scroll`).toBeLessThanOrEqual(root.ch + 1);
  await expectNoHorizontalOverflow(page);
  // Everything to tap is big enough for a finger.
  const small = await win.locator('button:visible').evaluateAll((els) =>
    els
      .map((el) => ({ name: el.getAttribute('aria-label') || el.textContent?.trim() || '?', r: el.getBoundingClientRect() }))
      .filter((b) => Math.min(b.r.width, b.r.height) < 44)
      .map((b) => `${b.name} ${Math.round(b.r.width)}×${Math.round(b.r.height)}`),
  );
  expect(small, `${name}: buttons at least 44 px`).toEqual([]);
}

test.describe('Make, step by step', () => {
  test('buttons named after their step, dots to jump, a pick moves on; the request carries every choice', async ({ page }) => {
    await mockAi(page, 'on');
    const requests = await mockStudio(page);
    const { errors, win } = await openMake(page);
    await expect(win.getByRole('button', { name: /^Back:/ })).toHaveCount(0);
    await win.getByRole('button', { name: 'Next: Maker & style' }).click();
    await expectStep(win, 'Who makes it');
    await expect(win.getByRole('button', { name: 'Back: What' })).toBeVisible();
    await win.getByRole('button', { name: 'Back: What' }).click();
    await expectStep(win, 'What will it be?');

    // Tapping a kind approves it and the maker step slides in.
    await win.getByRole('radiogroup', { name: 'What to make' }).getByRole('radio', { name: /^A picture/ }).click();
    await expectStep(win, 'Who makes it');
    // A maker with looks waits for the look; the look moves on.
    await win.getByRole('radiogroup', { name: 'Maker' }).getByRole('radio', { name: /^Krea Real/ }).click();
    await expect(win.getByRole('radiogroup', { name: 'Style' })).toBeVisible();
    await expectStep(win, 'Who makes it');
    await win.getByRole('radiogroup', { name: 'Style' }).getByRole('radio', { name: 'Dark brush' }).click();
    await expectStep(win, 'Describe it');
    await win.getByRole('textbox', { name: 'Describe it' }).fill('a lighthouse at dawn');
    await win.getByRole('button', { name: 'Next: Extras' }).click();
    await expectStep(win, 'Shape');
    await win.getByRole('group', { name: 'Shape' }).getByRole('button', { name: 'Portrait' }).click();

    // The dots: straight to the end, and back to any step.
    const dots = win.getByRole('navigation', { name: 'Make, step by step' });
    await expect(dots.getByRole('button')).toHaveCount(5);
    await expect(dots.getByRole('button', { name: 'Step 4 of 5: Extras' })).toHaveAttribute('aria-current', 'step');
    await dots.getByRole('button', { name: 'Step 5 of 5: Check & make' }).click();
    await expectStep(win, 'Check, then make it');
    const summary = win.getByRole('list', { name: 'Your choices' });
    await expect(summary).toContainText('A picture');
    await expect(summary).toContainText('Krea Real · Dark brush');
    await expect(summary).toContainText('a lighthouse at dawn');
    await expect(summary).toContainText('Portrait');
    await win.getByRole('button', { name: 'Make image' }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toMatchObject({ kind: 'image', maker: 'krea-real', style: 'style-darkbrush', prompt: 'a lighthouse at dawn', size: 'portrait' });
    await expect(win.getByRole('list', { name: 'In progress' })).toBeVisible();
    // A summary row goes back to its step.
    await summary.getByRole('button', { name: /^Words:/ }).click();
    await expectStep(win, 'Describe it');
    expect(errors).toEqual([]);
  });

  test('swipe left for the next step, right to go back; mouse drags too; nothing past either end', async ({ page }) => {
    await mockAi(page, 'on');
    await mockStudio(page);
    const { errors, win } = await openMake(page);
    // Nothing before the first step: the page gives a little and comes back.
    await swipe(page, win, 'right');
    await expectStep(win, 'What will it be?');
    await swipe(page, win, 'left');
    await expectStep(win, 'Who makes it');
    await swipe(page, win, 'left');
    await expectStep(win, 'Describe it');
    await swipe(page, win, 'right');
    await expectStep(win, 'Who makes it');
    // A swipe that ends over a choice does not pick it.
    await expect(win.getByRole('radiogroup', { name: 'Maker' }).getByRole('radio', { checked: true })).toHaveCount(1);

    // A mouse (or a pen) can drag the page too.
    const box = (await win.locator('.mk-stage').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.8, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.8, { steps: 6 });
    await page.mouse.up();
    await expectStep(win, 'Describe it');

    // A short swipe springs back.
    const cdp = await page.context().newCDPSession(page);
    const y = box.y + box.height * 0.8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * 0.6, y }] });
    for (const dx of [8, 16, 24, 30]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * 0.6 - dx, y }] });
    await page.waitForTimeout(400);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expectStep(win, 'Describe it');

    // From the screen's edge it is iOS's own back swipe, not ours.
    await swipe(page, win, 'right', { x: 4, y: box.y + box.height * 0.5 });
    await expectStep(win, 'Describe it');
    expect(errors).toEqual([]);
  });

  test('swipes leave text boxes and sideways lists alone', async ({ page }) => {
    await mockAi(page, 'on');
    await mockStudio(page);
    const { win } = await openMake(page);
    await win.getByRole('radio', { name: /^A video/ }).click();
    await expectStep(win, 'Who makes it');
    const makers = win.getByRole('radiogroup', { name: 'Maker' });
    const scrolls = await makers.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    if (scrolls) {
      // On a phone the makers slide sideways: a swipe on them scrolls them, the step stays.
      const mb = (await makers.boundingBox())!;
      await swipe(page, win, 'left', { x: mb.x + mb.width * 0.8, y: mb.y + mb.height / 2 });
      await expectStep(win, 'Who makes it');
      await expect.poll(() => makers.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    }
    await win.getByRole('button', { name: 'Next: Describe it' }).click();
    await expectStep(win, 'Describe it');
    const box = win.getByRole('textbox', { name: 'Describe it' });
    await box.fill('waves at sunset with gulls');
    const tb = (await box.boundingBox())!;
    await swipe(page, win, 'left', { x: tb.x + tb.width * 0.8, y: tb.y + tb.height / 2 });
    await expectStep(win, 'Describe it');
    await expect(box).toHaveValue('waves at sunset with gulls');
  });

  test('hold to talk fills the box with what you say', async ({ page }) => {
    await page.addInitScript(() => {
      // The device's speech recognition, pretending to hear a sentence.
      class FakeRecognition {
        lang = 'en-US';
        interimResults = true;
        continuous = false;
        onresult: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        private said = '';
        start() {
          (window as unknown as { __heard: number }).__heard = ((window as unknown as { __heard?: number }).__heard ?? 0) + 1;
          setTimeout(() => {
            this.said = 'a red balloon over the sea';
            const r = Object.assign([{ transcript: this.said }], { isFinal: true });
            this.onresult?.({ results: [r] });
          }, 150);
        }
        stop() {
          setTimeout(() => this.onend?.(), 30);
        }
        abort() {}
      }
      Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition });
    });
    await mockAi(page, 'on');
    await mockStudio(page);
    const { errors, win } = await openMake(page);
    await win.getByRole('button', { name: 'Next: Maker & style' }).click();
    await win.getByRole('button', { name: 'Next: Describe it' }).click();
    await expectStep(win, 'Describe it');
    const talk = win.getByRole('button', { name: 'Hold to talk: the description' });
    const tb = (await talk.boundingBox())!;
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.mouse.down();
    await expect(win.getByRole('button', { name: 'Listening: let go to stop' })).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(600);
    await page.mouse.up();
    const box = win.getByRole('textbox', { name: 'Describe it' });
    await expect(box).toHaveValue('a red balloon over the sea');
    await expect(win.getByRole('button', { name: 'Hold to talk: the description' })).toHaveAttribute('aria-pressed', 'false');
    // Talking again adds to what is there.
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    await expect(box).toHaveValue('a red balloon over the sea a red balloon over the sea');
    expect(errors).toEqual([]);
  });

  test('"Fill for me" writes an idea, and another one each tap; cloud AI writes them when it is set up', async ({ page }) => {
    await mockAi(page, 'on');
    await mockStudio(page);
    const { errors, win } = await openMake(page);
    await win.getByRole('radio', { name: /^A video/ }).click();
    await win.getByRole('button', { name: 'Next: Describe it' }).click();
    await expectStep(win, 'Describe it');
    const box = win.getByRole('textbox', { name: 'Describe it' });
    const fill = win.getByRole('button', { name: 'Fill for me' });
    await fill.click();
    await expect(box).not.toHaveValue('');
    const first = await box.inputValue();
    await fill.click();
    await expect(box).not.toHaveValue(first);
    expect((await box.inputValue()).length).toBeGreaterThan(10);

    // With cloud AI: it is asked, with what the step is about.
    const asked: string[] = [];
    await page.route('**/api/orb/ai**', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { configured: true, models: { write: ['test'] } } });
      const body = route.request().postDataJSON() as { messages: { content: string }[] };
      asked.push(body.messages.map((m) => m.content).join('\n'));
      return route.fulfill({ json: { choices: [{ message: { content: `"A snowy owl gliding over a frozen lake ${asked.length}"` } }] } });
    });
    await page.reload();
    const win2 = await openMakeApp(page);
    await win2.getByRole('radio', { name: /^A video/ }).click();
    await win2.getByRole('button', { name: 'Next: Describe it' }).click();
    await win2.getByRole('button', { name: 'Fill for me' }).click();
    await expect(win2.getByRole('textbox', { name: 'Describe it' })).toHaveValue('A snowy owl gliding over a frozen lake 1');
    expect(asked[0]).toContain('Step 3 of 5, Describe it: a landscape video with');
    expect(errors).toEqual([]);
  });

  test('every step fits the screen without scrolling', async ({ page }, info) => {
    await mockAi(page, 'on');
    await mockStudio(page);
    const { win } = await openMake(page);
    const flows: [string, RegExp][] = [
      ['picture', /^A picture/],
      ['video', /^A video/],
      ['edit', /^An edit/],
      ['vedit', /^Edit a video/],
    ];
    const shots = process.env.MAKESTEPS_SHOTS;
    for (const [flow, radio] of flows) {
      await win.getByRole('navigation', { name: 'Make, step by step' }).getByRole('button', { name: /^Step 1 of/ }).click();
      await expectStep(win, 'What will it be?');
      await expectFits(page, win, `${flow}: what`);
      if (shots && flow === 'picture') await page.screenshot({ path: `${shots}/${info.project.name}-1-what.png` });
      await win.getByRole('radio', { name: radio }).click();
      await expect(pane(win).locator('[data-assist-target]').first()).toBeVisible();
      await expect(win.locator('.mk-pane')).toHaveCount(1);
      const n = await win.getByRole('navigation', { name: 'Make, step by step' }).getByRole('button').count();
      for (let i = 2; i <= n; i++) {
        await win.getByRole('navigation', { name: 'Make, step by step' }).getByRole('button', { name: new RegExp(`^Step ${i} of`) }).click();
        await expect(win.locator('.mk-pane')).toHaveCount(1);
        const title = await pane(win).getByRole('heading', { level: 3 }).textContent();
        await expectFits(page, win, `${flow}: step ${i} (${title})`);
        if (shots) await page.screenshot({ path: `${shots}/${info.project.name}-${flow}-${i}.png` });
      }
    }
  });
});

test.describe('Make, step by step, with Motion on', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  for (const motion of ['full', 'lite'] as const) {
    test(`Motion ${motion}: the next step comes in from the right and settles in the middle; back comes from the left`, async ({ page }, info) => {
      await page.addInitScript((m) => {
        localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: m, motionPicked: true, introSeen: true } }, version: 0 }));
      }, motion);
      await mockAi(page, 'on');
      await mockStudio(page);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('/');
      const win = await openMakeApp(page);
      await expectStep(win, 'What will it be?');
      const shots = process.env.MAKESTEPS_SHOTS;

      // Follow a page's sideways position every frame while it moves.
      const track = (step: string) =>
        page.evaluate((id) => {
          const xs: number[] = [];
          (window as unknown as { __xs: number[] }).__xs = xs;
          const t0 = performance.now();
          const tick = () => {
            const el = document.querySelector<HTMLElement>(`.app-window[data-app="make"] .mk-pane[data-step="${id}"]`);
            if (el) xs.push(new DOMMatrix(getComputedStyle(el).transform).m41);
            if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }, step);
      const path = () => page.evaluate(() => (window as unknown as { __xs: number[] }).__xs);
      const width = (await win.locator('.mk-stage').boundingBox())!.width;

      // Next: the new page starts well to the right, and ends in the middle.
      await track('maker');
      await win.getByRole('button', { name: 'Next: Maker & style' }).click();
      if (shots && motion === 'full') {
        await page.waitForTimeout(120);
        await page.screenshot({ path: `${shots}/${info.project.name}-motion-mid.png` });
      }
      await expectStep(win, 'Who makes it');
      await page.waitForTimeout(400);
      let xs = await path();
      expect(Math.max(...xs)).toBeGreaterThan(width * 0.15);
      expect(Math.abs(xs[xs.length - 1])).toBeLessThan(1);
      const incoming = win.locator('.mk-pane[data-step="maker"]');
      expect(await incoming.evaluate((el) => el.style.transform)).toBe('');

      // Back: the earlier page comes from the left.
      await track('what');
      await win.getByRole('button', { name: 'Back: What' }).click();
      await expectStep(win, 'What will it be?');
      await page.waitForTimeout(400);
      xs = await path();
      expect(Math.min(...xs)).toBeLessThan(-width * 0.05);
      expect(Math.abs(xs[xs.length - 1])).toBeLessThan(1);

      // A pick pops, and the next step follows.
      await win.getByRole('radio', { name: /^A video/ }).click();
      await expectStep(win, 'Who makes it');
      expect(errors).toEqual([]);
    });
  }
});
