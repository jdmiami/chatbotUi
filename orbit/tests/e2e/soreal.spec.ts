import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, openOrbit } from './helpers';
import { mockAi } from './aiMocks';
import { mockMovies, type Shot } from './soRealMocks';

/** soReal on iPhone / iPad viewports, with the AI machine's movie API mocked in memory. */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function openSoReal(page: Page) {
  const win = page.locator('.app-window[data-app="soreal"]');
  const icon = page.getByRole('button', { name: /^soReal\./ });
  await expect(win.or(icon).first()).toBeVisible();
  if (!(await win.isVisible())) await icon.click();
  await expect(win.getByRole('heading', { name: 'soReal' })).toBeVisible();
  return win;
}

async function expectTappable(page: Page, min = 44) {
  const boxes = await page.locator('.app-window[data-app="soreal"] button:visible').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label') || el.textContent?.trim() || '?', x: r.x, right: r.right, w: r.width, h: r.height };
    }),
  );
  const vw = page.viewportSize()!.width;
  for (const b of boxes) {
    expect(b.x, `${b.name} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(b.right, `${b.name} ends on screen`).toBeLessThanOrEqual(vw + 1);
    expect(Math.min(b.w, b.h), `${b.name} is big enough to tap`).toBeGreaterThanOrEqual(min);
  }
}

const step = (win: Locator, title: string) => expect(win.getByRole('heading', { name: title, exact: true })).toBeVisible();

test.describe('soReal', () => {
  test('off: asks to turn the AI machine on', async ({ page }) => {
    await mockAi(page, 'off');
    await mockMovies(page);
    const errors = await openOrbit(page);
    const win = await openSoReal(page);
    await expect(win.getByRole('status').filter({ hasText: 'soReal makes your movies on your AI machine' })).toBeVisible();
    await expect(win.getByRole('button', { name: 'Make', exact: true })).toBeDisabled();
    await win.getByRole('button', { name: 'Turn on' }).click();
    await win.getByRole('textbox', { name: 'What’s your movie about?' }).fill('A kite on a windy hill');
    await expect(win.getByRole('button', { name: 'Make', exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('one idea and Make: vertical by default, an estimate first, then the whole movie to watch and save', async ({ page }) => {
    await mockAi(page, 'on');
    const api = await mockMovies(page);
    const errors = await openOrbit(page);
    const win = await openSoReal(page);
    await expect(win.getByRole('heading', { name: 'What’s your movie about?' })).toBeVisible();
    await expect(win.getByRole('group', { name: 'Shape' }).getByRole('button', { name: 'Vertical' })).toHaveAttribute('aria-pressed', 'true');
    await expect(win.getByRole('group', { name: 'Length' }).getByRole('button', { name: '20 s' })).toHaveAttribute('aria-pressed', 'true');
    // 30 seconds is the longest.
    await expect(win.getByRole('group', { name: 'Length' }).getByRole('button')).toHaveText(['10 s', '20 s', '30 s']);
    await win.getByRole('textbox', { name: 'What’s your movie about?' }).fill('A woman flies a kite on a windy hill');
    await win.getByRole('group', { name: 'Length' }).getByRole('button', { name: '10 s' }).click();
    await expect(win.getByText('Takes about 5 minutes on your AI machine. It keeps going if your phone sleeps.')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);

    await win.getByRole('button', { name: 'Make', exact: true }).click();
    const created = api.calls.find((c) => c.method === 'POST' && c.path === '')!;
    expect(created.body).toMatchObject({ idea: 'A woman flies a kite on a windy hill', length: 10, size: 'portrait' });
    await expect.poll(() => api.calls.some((c) => c.path.endsWith('/run'))).toBe(true);
    // Progress, with the time left, on the movie's page.
    await expect(win.getByRole('status').filter({ hasText: /Making shot|Drawing|Writing/ })).toBeVisible();
    await expect(win.getByText(/minutes? left/)).toBeVisible();
    await expect(win.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(win.getByText('Your movie is ready')).toBeVisible({ timeout: 20_000 });
    await expect(win.getByLabel('Kite Day, the movie')).toBeVisible();
    await expect(win.getByRole('link', { name: 'Save' })).toHaveAttribute('href', /download=1/);
    // The storyboard: one picture where it starts and one where each shot ends.
    await expect(win.locator('.sr-frame img')).toHaveCount(3);
    await expect(win.locator('.sr-badge-done')).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);

    await win.getByRole('button', { name: 'All movies' }).click();
    await expect(win.getByRole('button', { name: /Kite Day/ })).toContainText('Your movie is ready');
    expect(errors).toEqual([]);
  });

  test('walk me through it: the orb’s line on every step, skips left to the AI, the story editable line by line', async ({ page }) => {
    await mockAi(page, 'on');
    const api = await mockMovies(page);
    const errors = await openOrbit(page);
    const win = await openSoReal(page);
    await win.getByRole('button', { name: 'Music video' }).click();
    await expect(win.getByRole('textbox', { name: 'What’s your movie about?' })).toHaveValue(/neon rooftop/);
    await win.getByRole('button', { name: 'Walk me through it' }).click();
    expect(api.calls.find((c) => c.method === 'POST' && c.path === '')!.body).toMatchObject({ template: 'music-video', length: 20 });

    // 1. The idea, with the orb's line marked for it to fly to.
    await step(win, 'Your idea');
    await expect(win.getByText('Step 1 of 7')).toBeVisible();
    await expect(win.locator('.sr-guide[data-orb-focus]')).toContainText('Skip it and I’ll pick an idea');
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);
    await win.getByRole('button', { name: 'Next' }).click();

    // 2. Length and shape: wide this time.
    await step(win, 'Length and shape');
    await win.getByRole('group', { name: 'Shape' }).getByRole('button', { name: 'Wide' }).click();
    await win.getByRole('button', { name: 'Next' }).click();
    expect(api.calls.filter((c) => c.method === 'PUT').pop()!.body).toMatchObject({ length: 20, size: 'landscape' });

    // 3. The story: the AI writes it on arrival (4 shots for 20 s), each line editable.
    await step(win, 'The story');
    await expect(win.getByRole('textbox', { name: 'Shot 4', exact: true })).toBeVisible();
    expect(api.calls.some((c) => c.path.endsWith('/plan'))).toBe(true);
    await win.getByRole('textbox', { name: 'Shot 2', exact: true }).fill('She spins as the lights flash');
    await win.getByRole('textbox', { name: 'Words said or sung in shot 2' }).fill('Mia, laughing: "Again!"');
    await expectTappable(page);
    await win.getByRole('button', { name: 'Next' }).click();
    const shots = (api.calls.filter((c) => c.method === 'PUT').pop()!.body!.shots as Shot[]).map((s) => s.prompt);
    expect(shots[1]).toBe('She spins as the lights flash');
    expect(shots).toHaveLength(4);
    expect((api.calls.filter((c) => c.method === 'PUT').pop()!.body!.shots as Shot[])[1]).toMatchObject({ says: 'Mia, laughing: "Again!"' });

    // 4–6. Skipped: the AI designs the lead and style, the storyboard is automatic, the AI picks the sound.
    const puts = api.calls.filter((c) => c.method === 'PUT').length;
    await step(win, 'Cast and look');
    await expect(win.getByRole('group', { name: 'Who stars' }).getByRole('button', { name: 'AI designs one' })).toHaveAttribute('aria-pressed', 'true');
    await win.getByRole('textbox', { name: 'Describe the lead' }).fill('someone I will not keep');
    await win.getByRole('button', { name: 'Skip', exact: true }).click();
    await step(win, 'Storyboard');
    await expect(win.getByRole('switch', { name: 'Let me check the storyboard first' })).not.toBeChecked();
    await win.getByRole('button', { name: 'Skip', exact: true }).click();
    await step(win, 'Sound');
    await expect(win.getByText('For this movie I’d use: Voices and sound.')).toBeVisible();
    await expect(win.getByText('Voices are made with each shot')).toBeVisible();
    await expectTappable(page);
    await win.getByRole('button', { name: 'Skip', exact: true }).click();
    expect(api.calls.filter((c) => c.method === 'PUT').length).toBe(puts);

    // 7. Make: what it will be and how long it takes.
    await step(win, 'Make it');
    await expect(win.locator('.sr-summary')).toContainText('A woman in a yellow raincoat');
    await expect(win.locator('.sr-summary')).toContainText('Voices and sound (the AI’s pick)');
    await expect(win.getByText(/Takes about \d+ minutes on your AI machine/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await win.getByRole('button', { name: 'Make my movie' }).click();
    await expect(win.getByText('Your movie is ready')).toBeVisible({ timeout: 25_000 });
    expect(errors).toEqual([]);
  });

  test('the storyboard can be checked first: redo a picture, then approve', async ({ page }) => {
    await mockAi(page, 'on');
    const api = await mockMovies(page);
    const errors = await openOrbit(page);
    const win = await openSoReal(page);
    await win.getByRole('textbox', { name: 'What’s your movie about?' }).fill('A kite on a windy hill');
    await win.getByRole('button', { name: 'Walk me through it' }).click();
    for (const title of ['Your idea', 'Length and shape', 'The story', 'Cast and look']) {
      await step(win, title);
      await win.getByRole('button', { name: title === 'Length and shape' ? 'Skip' : 'Next', exact: true }).click();
    }
    await step(win, 'Storyboard');
    await win.locator('.sr-switch').click();
    await expect(win.getByRole('switch', { name: 'Let me check the storyboard first' })).toBeChecked();
    await win.getByRole('button', { name: 'Skip to the end' }).click();
    expect(api.calls.filter((c) => c.method === 'PUT').pop()!.body).toMatchObject({ reviewStoryboard: true });
    await step(win, 'Make it');
    await win.getByRole('button', { name: 'Make my movie' }).click();

    await expect(win.getByText('The storyboard is ready for you to check')).toBeVisible({ timeout: 15_000 });
    await expect(win.locator('.sr-frame img')).toHaveCount(5);
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);
    await win.getByRole('button', { name: 'Redo picture 2' }).click();
    await win.getByRole('textbox', { name: 'What the picture shows' }).fill('The kite tangled in a tree');
    await win.getByRole('button', { name: 'Redo this picture' }).click();
    const put = api.calls.filter((c) => c.method === 'PUT').pop()!;
    expect(put.body).toMatchObject({ frames: [{ prompt: 'The kite tangled in a tree', redo: true }] });
    await expect(win.getByText('The storyboard is ready for you to check')).toBeVisible({ timeout: 15_000 });
    await win.getByRole('button', { name: 'Looks good, make the video' }).click();
    expect(api.calls.filter((c) => c.path.endsWith('/run')).pop()!.body).toEqual({ approve: true });
    await expect(win.getByText('Your movie is ready')).toBeVisible({ timeout: 25_000 });
    expect(errors).toEqual([]);
  });

  test('after making: redo one shot, reorder, trim, update the movie', async ({ page }) => {
    await mockAi(page, 'on');
    const api = await mockMovies(page);
    const errors = await openOrbit(page);
    const win = await openSoReal(page);
    await win.getByRole('textbox', { name: 'What’s your movie about?' }).fill('A kite on a windy hill');
    await win.getByRole('group', { name: 'Length' }).getByRole('button', { name: '10 s' }).click();
    await win.getByRole('button', { name: 'Make', exact: true }).click();
    await expect(win.getByText('Your movie is ready')).toBeVisible({ timeout: 20_000 });
    const runs = () => api.calls.filter((c) => c.path.endsWith('/run')).length;

    // Redo shot 1 only.
    await win.locator('.sr-shot').first().getByRole('button', { name: 'Redo' }).click();
    const redo = api.calls.filter((c) => c.method === 'PUT').pop()!.body!.shots as Shot[];
    expect(redo.map((s) => Boolean(s.redo))).toEqual([true, false]);
    await expect.poll(runs).toBe(2);
    // The remake starts (the old "ready" line goes), then it's ready again.
    await expect(win.getByText('Your movie is ready')).toHaveCount(0);
    await expect(win.getByText('Your movie is ready')).toBeVisible({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Move shot 1 later' })).toBeEnabled();

    // Swap the shots, trim the first: nothing is remade, the cut is updated.
    const [first] = redo;
    await win.getByRole('button', { name: 'Move shot 1 later' }).click();
    await expect.poll(() => (api.calls.filter((c) => c.method === 'PUT').pop()!.body!.shots as Shot[])[1].id).toBe(first.id);
    await expect(win.getByText('You changed shots since the last cut.')).toBeVisible();
    await win.getByRole('button', { name: 'Trim shot 1' }).click();
    await win.getByRole('group', { name: 'Cut from the start of shot 1' }).getByRole('button', { name: '0.5 s' }).click();
    await expect.poll(() => (api.calls.filter((c) => c.method === 'PUT').pop()!.body!.shots as Shot[])[0].trimStart).toBe(0.5);
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);
    await win.getByRole('button', { name: 'Update the movie' }).click();
    await expect.poll(() => api.calls.some((c) => c.path.endsWith('/render'))).toBe(true);
    await expect(win.getByText('You changed shots since the last cut.')).toHaveCount(0);
    expect(runs()).toBe(2);
    expect(errors).toEqual([]);
  });

  test('a photo of the lead', async ({ page }) => {
    await mockAi(page, 'on');
    const api = await mockMovies(page);
    const errors = await openOrbit(page);
    const win = await openSoReal(page);
    await win.getByRole('textbox', { name: 'What’s your movie about?' }).fill('My friend flies a kite');
    await win.getByRole('button', { name: 'Walk me through it' }).click();
    for (let i = 0; i < 3; i++) await win.getByRole('button', { name: 'Skip', exact: true }).click();
    await step(win, 'Cast and look');
    await win.getByRole('group', { name: 'Who stars' }).getByRole('button', { name: 'Use a photo' }).click();
    // Next without a photo: it asks for one (or skip).
    await win.getByRole('button', { name: 'Next' }).click();
    await expect(win.getByText('Choose a photo first, or skip')).toBeVisible();
    await expect(win.getByText('Photos of real people can never be made sexual or undressed.')).toBeVisible();
    await win.getByLabel('Photo of the lead').setInputFiles({ name: 'friend.png', mimeType: 'image/png', buffer: PNG });
    await expect.poll(() => api.calls.some((c) => c.path.endsWith('/lead'))).toBe(true);
    expect(String(api.calls.find((c) => c.path.endsWith('/lead'))!.body!.photo)).toMatch(/^data:image\/jpeg;base64,/);
    await expect(win.getByText('Your lead is ready.')).toBeVisible({ timeout: 10_000 });
    await win.getByRole('button', { name: 'Noir' }).click();
    await win.getByRole('button', { name: 'Next' }).click();
    expect(api.calls.filter((c) => c.method === 'PUT').pop()!.body).toMatchObject({ look: expect.stringContaining('film noir') });
    await step(win, 'Storyboard');
    expect(errors).toEqual([]);
  });

  test('helper machine: turn it on and make a movie there', async ({ page }) => {
    await mockAi(page, 'on');
    const api = await mockMovies(page);
    let helper = 'off';
    const helperCalls: string[] = [];
    await page.route('**/api/ai/helper', async (route) => {
      if (route.request().method() === 'POST') {
        helperCalls.push(route.request().postDataJSON().action);
        helper = 'on';
      }
      await route.fulfill({ json: { state: helper, costPerHour: helper === 'on' ? 0.59 : null, pricePerHour: 0.59, autoOffMinutes: 60, idle: { limitMinutes: 60, idleMinutes: 0 } } });
    });
    await page.route('**/api/ai/token', (route) =>
      route.fulfill({
        json: { url: new URL('/fake-ai', page.url()).href, helperUrl: helper === 'on' ? new URL('/fake-helper', page.url()).href : null, token: 'test', expiresIn: 3600 },
      }),
    );
    const onHelper: string[] = [];
    await page.route('**/fake-helper/_orbit/studio/movies/*/run', async (route) => {
      onHelper.push(route.request().url());
      const id = /movies\/([^/]+)\/run/.exec(route.request().url())![1];
      const m = api.movies.get(id)!;
      Object.assign(m, { running: true, runningOn: 'helper', phase: 'story' });
      await route.fulfill({ json: m });
    });
    const errors = await openOrbit(page);
    const win = await openSoReal(page);
    const bar = win.getByRole('status', { name: 'Helper machine' });
    await expect(bar).toContainText('Turn it on to make two movies at once ($0.59/h while on)');
    await bar.getByRole('button', { name: 'Turn on helper' }).click();
    await expect(bar).toContainText('Helper machine: on');
    await expect(bar).toContainText('turns itself off after 60 minutes unused.');
    expect(helperCalls).toEqual(['start']);

    await win.getByRole('textbox', { name: 'What’s your movie about?' }).fill('Waves roll in');
    await win.getByRole('group', { name: 'Make on' }).getByRole('button', { name: 'Helper' }).click();
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);
    await win.getByRole('button', { name: 'Make', exact: true }).click();
    await expect.poll(() => onHelper.length).toBe(1);
    await expect(win.getByRole('status').filter({ hasText: 'on the helper' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
