import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';
import { mockAi } from './aiMocks';

/** Orbit Space: the home is a 3D space of pages; tap to go to a page, tap again to open it flat. */

async function openSpace(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      'orbit:shell:v1',
      JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, skin: 'o5', introSeen: true } }, version: 0 }),
    );
  });
  await page.goto('/');
  await expect(page.locator('.sp')).toBeVisible();
  return errors;
}

/** Tap a page where it is drawn (the engine handles taps, as on a phone). */
async function tapNode(page: Page, id: string) {
  const box = await page.locator(`[data-node="${id}"]`).boundingBox();
  expect(box, `${id} is on screen`).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + Math.min(box!.height / 2, 30));
}

test.describe('Orbit Space', () => {
  test('opens straight into the space, with the cover, the machine log and the rooms as pages', async ({ page }) => {
    await mockAi(page, 'off');
    const errors = await openSpace(page);
    const home = page.getByRole('main', { name: 'Home' });
    await expect(home.locator('[data-node="cover"]')).toContainText(/Good (morning|afternoon|evening|night)\./);
    await expect(home.locator('[data-node="log"]')).toContainText('Linux');
    await expect(home.getByRole('button', { name: /^Room: Apps, 11 apps, as a grid/ })).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Dock' })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('tap a room to go to it, double tap to change its layout, tap an app twice to open it', async ({ page }) => {
    await mockAi(page, 'off');
    const errors = await openSpace(page);
    await tapNode(page, 'room:apps');
    await expect(page.locator('[data-node="room:apps"]')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();

    // Double tap: grid → stack, remembered in this browser.
    const room = page.locator('[data-node="room:apps"]');
    const box = (await room.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + 30);
    await page.mouse.click(box.x + box.width / 2, box.y + 30);
    await expect(room).toHaveAttribute('data-layout', 'stack');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('orbit:space:v1') || '{}').state?.layouts?.['room:apps'])).toBe('stack');

    // Keyboard: G at a room makes it a grid again.
    await page.locator('.sp-stage').focus();
    await page.keyboard.press('g');
    await expect(room).toHaveAttribute('data-layout', 'grid');

    await tapNode(page, 'app:settings');
    await expect(page.locator('[data-node="app:settings"]')).toHaveAttribute('aria-current', 'true');
    await tapNode(page, 'app:settings');
    await expect(page.locator('.app-window[data-app="settings"]')).toBeVisible();
    await expect(page.locator('.sp')).toHaveAttribute('data-hidden', 'true');
    expect(errors).toEqual([]);
  });

  test('Back returns to the overview; Flat switches to the path and Space comes back', async ({ page }) => {
    await mockAi(page, 'off');
    await openSpace(page);
    await tapNode(page, 'log');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Flat view/ }).click();
    await expect(page.locator('.o5-path')).toBeVisible();
    await page.locator('.o5-path').getByRole('button', { name: /^Space/ }).click();
    await expect(page.locator('.sp')).toBeVisible();
  });

  test('keyboard: Tab goes from page to page with the orb, Enter opens the one you are at', async ({ page }) => {
    await mockAi(page, 'off');
    await openSpace(page);
    await page.locator('.sp-stage').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-node="cover"]')).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-node="log"]')).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Enter');
    await expect(page.locator('.app-window[data-app="ai"]')).toBeVisible();
  });
});
