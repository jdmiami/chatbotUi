import { expect, test, type Page } from '@playwright/test';
import { dock, expectNoHorizontalOverflow, openOrbit } from './helpers';

/**
 * AI app on iPhone / iPad viewports. The site's /api/ai endpoints and the AI machine's
 * OpenAI-compatible API are mocked (same origin, under /fake-ai), so this runs without a GPU.
 */

const MODELS = ['qwen3.6:35b', 'qwen3.8-obliterated:27b', 'qwen3.8:27b'];
const LONG_LINE = `const data = [${Array.from({ length: 60 }, (_, i) => `"item-${i}"`).join(', ')}];`;
const REPLY = `Here is the answer.\n\n\`\`\`js\n${LONG_LINE}\nconsole.log(data.length);\n\`\`\`\n\nDone.`;

function sse(text: string) {
  const parts = text.match(/[\s\S]{1,24}/g) ?? [];
  return (
    [
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'Thinking about it.' } }] })}`,
      ...parts.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}`),
      'data: [DONE]',
    ].join('\n\n') + '\n\n'
  );
}

async function mockAi(page: Page, initial: 'off' | 'on') {
  let state: string = initial;
  await page.route('**/api/ai', async (route) => {
    if (route.request().method() === 'POST') state = 'on';
    await route.fulfill({
      json: { state, costPerHour: state === 'on' ? 0.59 : null, models: state === 'on' ? MODELS : [], idle: state === 'on' ? { limitMinutes: 30, idleMinutes: 0 } : null },
    });
  });
  await page.route('**/api/ai/token', (route) =>
    route.fulfill({ json: { url: new URL('/fake-ai', page.url()).href, token: 'test', expiresIn: 3600 } }),
  );
  await page.route('**/fake-ai/v1/models', (route) => route.fulfill({ json: { data: MODELS.map((id) => ({ id })) } }));
  await page.route('**/fake-ai/v1/chat/completions', (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(REPLY) }),
  );
}

async function openAi(page: Page) {
  // After a reload Orbit reopens the app that was open.
  const win = page.locator('.app-window[data-app="ai"]');
  const icon = page.getByRole('button', { name: /^AI\./ });
  await expect(win.or(icon).first()).toBeVisible();
  if (!(await win.isVisible())) await icon.click();
  await expect(win.locator('.ai-composer')).toBeVisible();
  await expect(page.locator('.app-window[data-app="ai"]')).toBeVisible();
}

/** Every visible button in the AI window is on screen and at least `min` px tall and wide. */
async function expectTappable(page: Page, min = 44) {
  const boxes = await page.locator('.app-window[data-app="ai"] button:visible').evaluateAll((els) =>
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

test.describe('AI app', () => {
  test('off: turn-on banner fits the screen and turns the machine on', async ({ page }) => {
    await mockAi(page, 'off');
    const errors = await openOrbit(page);
    await openAi(page);
    const banner = page.getByRole('status').filter({ hasText: 'Your AI machine is off' });
    await expect(banner).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByText('Your AI machine: Ready')).toBeVisible();
    await expect(banner).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('chat: send, streamed reply, wide code stays inside the screen', async ({ page }, testInfo) => {
    await mockAi(page, 'on');
    const errors = await openOrbit(page);
    await openAi(page);
    const picker = page.locator('.app-window[data-app="ai"] .ai-model select');
    await expect(picker.locator('option')).toHaveCount(MODELS.length);
    await picker.selectOption('qwen3.8-obliterated:27b');

    const box = page.getByRole('textbox', { name: 'Message' });
    await box.fill('Show me some code');
    // Touch devices: Return adds a new line, the Send button sends.
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Done.')).toBeVisible();
    await expect(page.getByText('Thinking', { exact: true })).toBeVisible();
    await expect(box).toHaveValue('');

    await expectNoHorizontalOverflow(page);
    // The wide code line scrolls inside its own block, not the page.
    const code = page.locator('.ai-msg-assistant pre').first();
    await expect(code).toBeVisible();
    const fits = await code.evaluate((el) => el.getBoundingClientRect().right <= document.documentElement.clientWidth + 1);
    expect(fits, 'code block fits the screen').toBe(true);

    // The composer is fully on screen and not covered by the dock.
    const composer = await page.locator('.ai-composer').boundingBox();
    const dockBox = await dock(page).boundingBox();
    const vh = page.viewportSize()!.height;
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(vh + 1);
    if (dockBox) expect(composer!.y + composer!.height, 'composer above the dock').toBeLessThanOrEqual(dockBox.y + 1);

    await expectTappable(page);
    await expect(page.getByRole('button', { name: 'Again' })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('ai-chat.png') });
    expect(errors).toEqual([]);
  });

  test('chats list: sheet on narrow screens, sidebar on wide ones; survives reload', async ({ page }) => {
    await mockAi(page, 'on');
    await openOrbit(page);
    await openAi(page);
    await page.getByRole('textbox', { name: 'Message' }).fill('First question');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Done.')).toBeVisible();

    const sidebar = page.locator('.ai-side');
    if (await sidebar.isVisible()) {
      await expect(sidebar.getByRole('button', { name: /^First question/ })).toBeVisible();
    } else {
      await page.getByRole('button', { name: 'Chats' }).click();
      const sheet = page.getByRole('dialog', { name: 'Chats' });
      await expect(sheet.getByRole('button', { name: /^First question/ })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await sheet.getByRole('button', { name: 'New chat' }).click();
      await expect(sheet).toHaveCount(0);
    }

    await page.reload();
    await openAi(page);
    if (await page.locator('.ai-side').isVisible()) {
      await expect(page.locator('.ai-side').getByRole('button', { name: /^First question/ })).toBeVisible();
    } else {
      await page.getByRole('button', { name: 'Chats' }).click();
      await expect(page.getByRole('dialog', { name: 'Chats' }).getByRole('button', { name: /^First question/ })).toBeVisible();
    }
  });
});
