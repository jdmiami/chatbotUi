import { expect, test, type Page } from '@playwright/test';
import { dock, expectNoHorizontalOverflow } from './helpers';

/**
 * Motion levels. The rest of the suite runs with the device's Reduce Motion on (Orbit's Auto then means
 * Off), so layout checks see settled screens. Here the level is set explicitly and animation is real.
 */
test.use({ contextOptions: { reducedMotion: 'no-preference' } });

type Level = 'full' | 'lite' | 'reduce' | 'system';

async function open(page: Page, motion: Level) {
  await page.addInitScript((m) => {
    localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { motion: m, introSeen: true } }, version: 0 }));
  }, motion);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Terminal\./ })).toBeVisible();
  return errors;
}

const level = (page: Page) => page.evaluate(() => document.documentElement.dataset.motion);
const terminalWindow = (page: Page) => page.locator('.app-window[data-app="terminal"]');

test.describe('motion levels', () => {
  test('full: icons pop in, the app grows out of its icon and settles clean, then shrinks back', async ({ page }) => {
    const errors = await open(page, 'full');
    expect(await level(page)).toBe('full');
    const icon = page.locator('.home-grid .app-icon').first();
    expect(await icon.evaluate((el) => getComputedStyle(el).animationName)).toContain('mo-icon-pop');

    await page.getByRole('button', { name: /^Terminal\./ }).click();
    // Mid-flight the window is scaled down and clipped to the icon.
    const mid = await terminalWindow(page).evaluate(
      (el) =>
        new Promise<{ clip: string; transform: string }>((res) =>
          setTimeout(() => res({ clip: getComputedStyle(el).clipPath, transform: getComputedStyle(el).transform }), 60),
        ),
    );
    expect(mid.clip).toContain('inset');
    expect(mid.transform).not.toBe('none');
    // Settled: no leftover inline animation styles, fully on screen.
    await expect.poll(() => terminalWindow(page).evaluate((el) => el.style.clipPath + el.style.transform + el.style.opacity), { timeout: 4000 }).toBe('');
    await expect(terminalWindow(page)).toHaveAttribute('data-placement', 'full');
    await expectNoHorizontalOverflow(page);

    // Home: the app shrinks into its icon and hides afterwards.
    await dock(page).getByRole('button', { name: 'Home screen' }).click();
    await expect(terminalWindow(page)).toBeVisible();
    await expect.poll(() => terminalWindow(page).evaluate((el) => getComputedStyle(el).visibility), { timeout: 4000 }).toBe('hidden');
    await expect(page.getByRole('button', { name: /^Terminal\./ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('lite: short fades only, no icon pop or clip', async ({ page }) => {
    await open(page, 'lite');
    expect(await level(page)).toBe('lite');
    const icon = page.locator('.home-grid .app-icon').first();
    expect(await icon.evaluate((el) => getComputedStyle(el).animationName)).toContain('mo-fade-up');
    await page.getByRole('button', { name: /^Terminal\./ }).click();
    await expect(terminalWindow(page)).toHaveAttribute('data-placement', 'full');
    expect(await terminalWindow(page).evaluate((el) => getComputedStyle(el).clipPath)).toBe('none');
    await expect.poll(() => terminalWindow(page).evaluate((el) => el.style.opacity + el.style.transform), { timeout: 3000 }).toBe('');
  });

  test('off: nothing animates and apps open instantly', async ({ page }) => {
    await open(page, 'reduce');
    expect(await level(page)).toBe('off');
    await page.getByRole('button', { name: /^Terminal\./ }).click();
    expect(await terminalWindow(page).evaluate((el) => el.style.clipPath + el.style.transform)).toBe('');
    const dur = await page.locator('.home-grid .app-icon').first().evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(dur)).toBeLessThan(0.01);
  });

  test('auto follows the device: Reduce Motion on means off', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await open(page, 'system');
    expect(await level(page)).toBe('off');
    await ctx.close();
  });

  test('Settings: pick a level and it applies at once; sounds and vibration start off', async ({ page }) => {
    await open(page, 'system');
    await page.getByRole('button', { name: /^Settings\./ }).click();
    const group = page.getByRole('group', { name: 'Motion', exact: true });
    await expect(group.getByRole('button')).toHaveText(['Auto', 'Full', 'Lite', 'Off']);
    await group.getByRole('button', { name: 'Lite' }).click();
    await expect.poll(() => level(page)).toBe('lite');
    await group.getByRole('button', { name: 'Off' }).click();
    await expect.poll(() => level(page)).toBe('off');
    await group.getByRole('button', { name: 'Full' }).click();
    await expect.poll(() => level(page)).toBe('full');
    await expect(page.getByRole('switch', { name: 'Play sounds' })).not.toBeChecked();
    await expect(page.getByRole('switch', { name: 'Vibrate' })).not.toBeChecked();
  });

  test('full: a sheet can be dragged down to dismiss, and springs back if let go early', async ({ page }) => {
    await open(page, 'full');
    await page.getByRole('button', { name: /Show details/ }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(900); // entrance spring settles
    const grip = await page.locator('.sheet-grabber').boundingBox();
    const x = grip!.x + grip!.width / 2;
    const y = grip!.y + grip!.height / 2;

    // Small drag: springs back.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 50, { steps: 6 });
    await page.mouse.up();
    await expect(sheet).toBeVisible();
    await expect.poll(async () => Math.abs((await sheet.boundingBox())!.y - (await page.locator('.sheet').evaluate((el) => el.getBoundingClientRect().y)))).toBeLessThan(1);

    // Big drag: dismisses.
    const now = await page.locator('.sheet-grabber').boundingBox();
    const y2 = now!.y + now!.height / 2;
    await page.mouse.move(x, y2);
    await page.mouse.down();
    await page.mouse.move(x, y2 + 260, { steps: 10 });
    await page.mouse.up();
    await expect(sheet).toHaveCount(0, { timeout: 3000 });
  });

  test('full: no horizontal overflow on the start screen while icons float and the glow drifts', async ({ page }) => {
    await open(page, 'full');
    await page.waitForTimeout(1200);
    await expectNoHorizontalOverflow(page);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.shell')!, '::before').animationName)).toContain('mo-drift');
  });
});
