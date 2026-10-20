import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';
import { mockAi } from './aiMocks';

/** Orbit 0.5 in the AI app: Talk · Make and the orb, folded tools, a quiet conversation, the maker as a walk-through. */

async function openO5Ai(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, skin: 'o5', introSeen: true, space: false } }, version: 0 }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  await page.getByRole('dialog', { name: 'Index' }).getByRole('button', { name: /Talk/ }).click();
  await expect(page.locator('.app-window[data-app="ai"] .o5-ai-bar')).toBeVisible();
  return errors;
}

async function expectTappable(page: Page) {
  const boxes = await page.locator('.app-window[data-app="ai"] button:visible').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label') || el.textContent?.trim() || '?', w: r.width, h: r.height };
    }),
  );
  for (const b of boxes) expect(Math.min(b.w, b.h), `${b.name} is big enough to tap`).toBeGreaterThanOrEqual(44);
}

test.describe('Orbit 0.5: AI', () => {
  test('talk: no header or tabs, the orb holds the menu, tools fold behind one +', async ({ page }) => {
    await mockAi(page, 'on');
    const errors = await openO5Ai(page);
    const win = page.locator('.app-window[data-app="ai"]');
    await expect(win.locator('.app-header')).toHaveCount(0);
    await expect(win.getByRole('group', { name: 'Talk or make' }).getByRole('button', { name: 'Talk' })).toHaveAttribute('aria-pressed', 'true');
    // Only the essentials in the message box until you ask for more.
    await expect(win.getByRole('button', { name: 'Search the web' })).toBeHidden();
    await expect(win.getByRole('button', { name: /^Model:/ })).toBeHidden();
    await win.getByRole('button', { name: 'Tools: photos, web, picture' }).click();
    await expect(win.getByRole('button', { name: 'Search the web' })).toBeVisible();
    await win.getByRole('button', { name: 'Search the web' }).click();
    await win.getByRole('button', { name: 'Hide tools' }).click();
    // A tool that is on stays in view.
    await expect(win.getByRole('button', { name: 'Search the web' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);

    await win.getByRole('button', { name: /^Your AI: Ready/ }).click();
    const menu = page.getByRole('dialog', { name: 'Your AI' });
    await expect(menu).toContainText('Ready · $0.59/h');
    await menu.getByRole('button', { name: /^Model qwen/ }).click();
    await expect(page.getByRole('dialog', { name: 'Choose a model' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a conversation: actions only on the latest answer, others when tapped; the keyboard leaves only the conversation', async ({ page }) => {
    await mockAi(page, 'on');
    await openO5Ai(page);
    const win = page.locator('.app-window[data-app="ai"]');
    await win.getByRole('textbox', { name: 'Message' }).fill('Hello there');
    await win.getByRole('button', { name: 'Send' }).click();
    await expect(win.locator('.ai-msg-assistant').last()).toContainText('Done.');
    await expect(win.locator('.ai-msg-assistant').last().getByRole('button', { name: 'Again' })).toBeVisible();
    const mine = win.locator('.ai-msg-user').last();
    await expect(mine.getByRole('button', { name: /Edit/ })).toBeHidden();
    await mine.locator('.ai-user-text').click();
    await expect(mine.getByRole('button', { name: /Edit/ })).toBeVisible();
    // Keyboard up: the bar steps aside.
    await page.locator('.shell').evaluate((el) => el.setAttribute('data-keyboard', 'true'));
    await expect(win.locator('.o5-ai-bar')).toHaveCSS('opacity', '0');
    await expect(win.getByRole('textbox', { name: 'Message' })).toBeVisible();
  });

  test('make: a walk-through; answering a step brings the next one into view', async ({ page }) => {
    await mockAi(page, 'on');
    await page.route('**/fake-ai/_orbit/studio', (r) =>
      r.fulfill({ json: { setup: 'running', running: true, image: { ready: true, downloaded: true, percent: 100 }, video: { ready: true, downloaded: true, percent: 100 }, downloading: null, downloadError: null, jobs: [] } }),
    );
    await page.route('**/fake-ai/_orbit/studio/items', (r) => r.fulfill({ json: { items: [] } }));
    await page.route('**/fake-ai/_orbit/studio/makers', (r) =>
      r.fulfill({ json: { makers: [{ id: 'qwen', kind: 'image', name: 'Qwen Image', installed: true, builtIn: true }, { id: 'ltx', kind: 'video', name: 'LTX', installed: true, builtIn: true }] } }),
    );
    const errors = await openO5Ai(page);
    const win = page.locator('.app-window[data-app="ai"]');
    await win.getByRole('button', { name: 'Make', exact: true }).click();
    for (const t of ['What will it be?', 'Who makes it', 'Describe it', 'Shape', 'Make it']) await expect(win.getByRole('heading', { name: t, exact: true })).toBeAttached();
    await win.getByRole('radio', { name: /A video/ }).click();
    await expect(win.getByRole('heading', { name: 'Who makes it' })).toBeInViewport();
    await expect(win.getByRole('heading', { name: 'Shape, length and start' })).toBeAttached();
    await win.getByRole('radio', { name: 'LTX' }).click();
    await expect(win.getByRole('textbox', { name: 'Describe it' })).toBeInViewport();
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);
    expect(errors).toEqual([]);
  });

  test('make with the machine off: the built-in makers are still pickable, and Makers opens with a way to turn it on', async ({ page }, testInfo) => {
    const powerCalls: Record<string, unknown>[] = [];
    await mockAi(page, 'off', powerCalls);
    const errors = await openO5Ai(page);
    const win = page.locator('.app-window[data-app="ai"]');
    await win.getByRole('button', { name: 'Make', exact: true }).click();
    await win.getByRole('radio', { name: /A picture/ }).click();
    const picks = win.getByRole('radiogroup', { name: 'Maker' });
    const qwen = picks.getByRole('radio', { name: 'Qwen Uncensored' });
    await expect(qwen).toHaveAttribute('aria-checked', 'true');
    await qwen.click();
    await expect(win.getByRole('textbox', { name: 'Describe it' })).toBeInViewport();
    // Makers opens the Store at its picture and video shelves, with a way to turn the machine on.
    await picks.getByRole('button', { name: 'Makers' }).click();
    const store = page.locator('.app-window[data-app="store"]');
    await expect(store.getByText(/Your AI machine is resting/)).toBeVisible();
    await expect(store.getByRole('region', { name: 'Video' })).toContainText('H3 Max');
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('makers-off.png') });
    await store.getByRole('button', { name: 'Turn on' }).click();
    await expect.poll(() => powerCalls.length).toBe(1);
    expect(powerCalls[0]).toMatchObject({ action: 'start' });
    expect(errors).toEqual([]);
  });

  test('make: the queue shows its place in line, time left, a slow job, and what the machine did on its own', async ({ page }, testInfo) => {
    await mockAi(page, 'on');
    const ready = { ready: true, downloaded: true, percent: 100 };
    await page.route('**/fake-ai/_orbit/studio', (r) => r.fulfill({ json: { setup: 'running', running: true, image: ready, video: ready, downloading: null, downloadError: null, jobs: [] } }));
    await page.route('**/fake-ai/_orbit/studio/items', (r) => r.fulfill({ json: { items: [] } }));
    await page.route('**/fake-ai/_orbit/studio/makers', (r) =>
      r.fulfill({ json: { makers: [{ id: 'qwen', kind: 'image', name: 'Qwen Uncensored', installed: true, builtIn: true, wanted: true, percent: 100 }] } }),
    );
    const base = { kind: 'image', prompt: 'a lighthouse at dusk', error: null, createdAt: '', item: null, maker: 'qwen', expectedSeconds: 45 };
    await page.route('**/fake-ai/_orbit/studio/jobs', (r) => r.fulfill({ json: { ...base, id: 'j1', status: 'queued', progress: 0, position: 2, etaSeconds: 170, notes: [] } }));
    let polls = 0;
    await page.route('**/fake-ai/_orbit/studio/jobs/j1', (r) => {
      polls++;
      return r.fulfill({
        json:
          polls < 2
            ? { ...base, id: 'j1', status: 'queued', progress: 0, position: 2, etaSeconds: 170, notes: [] }
            : {
                ...base,
                id: 'j1',
                status: 'running',
                progress: 30,
                position: 0,
                etaSeconds: 0,
                slow: true,
                attempt: 2,
                notes: ['The maker was frozen, so it was restarted.', 'Freed the graphics card and started again (try 2 of 2).'],
              },
      });
    });
    const errors = await openO5Ai(page);
    const win = page.locator('.app-window[data-app="ai"]');
    await win.getByRole('button', { name: 'Make', exact: true }).click();
    await win.getByRole('radio', { name: /A picture/ }).click();
    await win.getByRole('textbox', { name: 'Describe it' }).fill('a lighthouse at dusk');
    await win.getByRole('button', { name: 'Make image' }).click();
    const job = win.locator('.ai-job').first();
    await expect(job.locator('.ai-job-line')).toHaveText('2nd in line · ready in about 3 min');
    await expect(job.locator('.ai-job-line')).toHaveText('Slower than usual · the machine is watching it', { timeout: 8000 });
    await expect(job.locator('.ai-job-notes')).toContainText('frozen, so it was restarted');
    await expectNoHorizontalOverflow(page);
    await job.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('queue.png') });
    expect(errors).toEqual([]);
  });
});

/** Orbit 0.5 at the home screen, with Motion on so the store's pages get their depth. */
async function openO5Home(page: Page, motion: 'full' | 'reduce' = 'full') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((m) => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: m, motionPicked: true, skin: 'o5', introSeen: true, space: false } }, version: 0 }));
  }, motion);
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Home' })).toBeVisible();
  return errors;
}

/** Tap a link on the home path the way a person would: scrolled up to the middle of the screen first. */
async function tapHome(page: Page, name: RegExp) {
  const link = page.getByRole('main', { name: 'Home' }).getByRole('button', { name });
  await link.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  // The home snaps to its chapters: wait until it has come to rest before tapping.
  const home = page.getByRole('main', { name: 'Home' });
  let last = -1;
  await expect
    .poll(async () => {
      const top = await home.evaluate((el) => el.scrollTop);
      const still = top === last;
      last = top;
      return still;
    }, { intervals: [250] })
    .toBe(true);
  // On the words, as a finger would: the row's middle can sit under the Index handle.
  await link.locator('.o5-go-label').click();
}

test.describe('Orbit 0.5: the Store from everywhere', () => {
  test('home, index, settings and the AI menu all open the Store app', async ({ page }) => {
    await mockAi(page, 'on');
    const errors = await openO5Home(page, 'reduce');
    const store = page.locator('.app-window[data-app="store"]');

    // From the home's "Talk" chapter.
    await tapHome(page, /^Store/);
    await expect(store.getByTestId('store')).toBeVisible();
    await expect(store.getByRole('heading', { name: 'Everyday' })).toBeVisible();

    // From the index.
    await page.getByRole('button', { name: /^Index/ }).click();
    await page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list').getByRole('button', { name: /Store/ }).click();
    await expect(store.getByTestId('store')).toBeVisible();

    // From Settings: the makers shelf.
    await page.getByRole('button', { name: /^Index/ }).click();
    await page.getByRole('dialog', { name: 'Index' }).getByRole('button', { name: /Settings/ }).click();
    await page.locator('.app-window[data-app="settings"]').getByRole('button', { name: /^Makers/ }).click();
    await expect(store.getByRole('tab', { name: 'Pictures & video' })).toHaveAttribute('aria-selected', 'true');

    // And from the AI's own menu.
    await page.getByRole('button', { name: /^Index/ }).click();
    await page.getByRole('dialog', { name: 'Index' }).getByRole('button', { name: /Talk/ }).click();
    await page.locator('.app-window[data-app="ai"]').getByRole('button', { name: /^Your AI:/ }).click();
    await page.getByRole('dialog', { name: 'Your AI' }).getByRole('button', { name: /^Store/ }).click();
    await expect(store.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    expect(errors).toEqual([]);
  });
});
