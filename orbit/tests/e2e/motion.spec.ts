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
    localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: m, motionPicked: true, introSeen: true } }, version: 0 }));
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

  test('older saved Auto settings move to Full once; a picked level is kept', async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'system', introSeen: true } }, version: 0 })),
    );
    await page.goto('/');
    await expect.poll(() => level(page)).toBe('full');
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
    await page.waitForTimeout(150); // held still, then let go: no throw
    await page.mouse.up();
    await expect(sheet).toBeVisible();
    await expect.poll(() => page.locator('.sheet').evaluate((el) => el.style.transform)).toBe('');

    // Big drag: dismisses.
    const now = await page.locator('.sheet-grabber').boundingBox();
    const y2 = now!.y + now!.height / 2;
    await page.mouse.move(x, y2);
    await page.mouse.down();
    await page.mouse.move(x, y2 + 260, { steps: 10 });
    await page.mouse.up();
    await expect(sheet).toHaveCount(0, { timeout: 3000 });
  });

  test('full: nothing drifts on its own; the background, light and shadows follow the tilt', async ({ page }) => {
    await open(page, 'full');
    await page.waitForTimeout(1200);
    await expectNoHorizontalOverflow(page);
    // The decorative float and drift are cut (MOTION.md §5).
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.shell')!, '::before').animationName)).toBe('none');
    expect(await page.locator('.home-grid .app-icon .glyph').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    // The one GPU layer is running on the home screen.
    await expect(page.locator('canvas.home-light[data-live="true"]')).toHaveCount(1);

    const read = () =>
      page.evaluate(() => ({
        tx: Number(document.documentElement.style.getPropertyValue('--tx') || 0),
        bg: getComputedStyle(document.querySelector('.shell')!, '::before').translate,
        shadow: getComputedStyle(document.querySelector('.home-grid .app-icon .glyph')!).boxShadow,
      }));
    const before = await read();
    // Tilt the phone 15° to the right of how it's held.
    await page.evaluate(async () => {
      const tilt = (beta: number, gamma: number) => dispatchEvent(Object.assign(new Event('deviceorientation'), { beta, gamma, alpha: 0 }));
      tilt(40, 0);
      for (let i = 0; i < 10; i++) {
        tilt(40, 15);
        await new Promise((r) => setTimeout(r, 30));
      }
    });
    await expect.poll(async () => (await read()).tx).toBeGreaterThan(0.3);
    const after = await read();
    expect(after.bg).not.toBe(before.bg);
    expect(after.shadow).not.toBe(before.shadow);
    await expectNoHorizontalOverflow(page);
  });

  test('liquid glass: floating panes blur what is behind and carry a lit rim', async ({ page }) => {
    await open(page, 'full');
    const look = await dock(page).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { blur: cs.backdropFilter || (cs as unknown as Record<string, string>).webkitBackdropFilter, shadow: cs.boxShadow, bg: cs.backgroundImage };
    });
    expect(look.blur).toContain('blur(26px)');
    expect(look.shadow).toContain('inset');
    expect(look.bg).toContain('radial-gradient');
  });

  test('full: sheets grow out of the button you tapped', async ({ page }) => {
    await open(page, 'full');
    const chip = page.getByRole('button', { name: /Show details/ });
    const box = (await chip.boundingBox())!;
    await chip.click();
    const sheet = page.locator('.sheet');
    await expect(sheet).toHaveAttribute('data-grown', '');
    // Early in the entrance the sheet is small and centred near the chip.
    const mid = await sheet.evaluate(
      (el) => new Promise<DOMRect>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(el.getBoundingClientRect().toJSON())))),
    );
    const vp = page.viewportSize()!;
    expect(mid.width).toBeLessThan(vp.width * 0.8);
    expect(Math.abs(mid.y + mid.height / 2 - (box.y + box.height / 2))).toBeLessThan(vp.height * 0.45);
    await expect.poll(() => sheet.evaluate((el) => el.style.transform)).toBe('');
  });

  test('full: swipe up on the dock to go home; a short swipe springs back', async ({ page }) => {
    await open(page, 'full');
    await page.getByRole('button', { name: /^Terminal\./ }).click();
    const win = terminalWindow(page);
    await expect(win).toHaveAttribute('data-placement', 'full');
    await page.waitForTimeout(900);
    const d = (await dock(page).boundingBox())!;
    const x = d.x + d.width - 6;
    const y = d.y + d.height / 2;

    // A short, slow drag: the window follows, then springs back to full size.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 50, { steps: 8 });
    const held = await win.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    expect(held).toBeLessThan(0.98);
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect.poll(() => win.evaluate((el) => el.style.transform)).toBe('');
    await expect(win).toHaveAttribute('data-placement', 'full');

    // A long throw: it flies home.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 320, { steps: 5 });
    await page.mouse.up();
    await expect(win).toHaveAttribute('data-placement', 'hidden');
    await expect(page.getByRole('button', { name: /^Terminal\./ })).toBeVisible();
    await expect.poll(() => win.evaluate((el) => el.style.transform)).toBe('');
  });

  test('off: designed, not empty — still, but apps and sheets cross-fade', async ({ page }) => {
    await open(page, 'reduce');
    expect(await level(page)).toBe('off');
    await expect(page.locator('canvas.home-light')).toHaveCount(0);
    await page.getByRole('button', { name: /Show details/ }).click();
    expect(await page.locator('.sheet').evaluate((el) => getComputedStyle(el).animationName)).toBe('mo-xfade');
    await page.keyboard.press('Escape');
    // Sample the window every frame while it opens: it fades, but never moves or scales.
    const sampled = page.evaluate(
      () =>
        new Promise<{ minOpacity: number; moved: boolean }>((res) => {
          let minOpacity = 1;
          let moved = false;
          const start = performance.now();
          const tick = () => {
            const el = document.querySelector('.app-window[data-app="terminal"]');
            if (el) {
              const cs = getComputedStyle(el);
              minOpacity = Math.min(minOpacity, Number(cs.opacity));
              if (cs.transform !== 'none' && cs.transform !== 'matrix(1, 0, 0, 1, 0, 0)') moved = true;
            }
            if (performance.now() - start < 600) requestAnimationFrame(tick);
            else res({ minOpacity, moved });
          };
          requestAnimationFrame(tick);
        }),
    );
    await page.getByRole('button', { name: /^Terminal\./ }).click();
    const t = await sampled;
    expect(t.minOpacity).toBeLessThan(1);
    expect(t.moved).toBe(false);
    await expect.poll(() => terminalWindow(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  });
});
