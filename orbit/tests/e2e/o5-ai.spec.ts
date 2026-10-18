import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';
import { mockAi } from './aiMocks';

/** Orbit 0.5 in the AI app: Talk · Make and the orb, folded tools, a quiet conversation, the maker as a walk-through. */

async function openO5Ai(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, skin: 'o5', introSeen: true } }, version: 0 }));
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
});
