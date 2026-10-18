import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';
import { mockAi } from './aiMocks';

/** The orb: on every screen, physics you can grab and throw, and it uses Orbit for you. */

async function openWithOrb(page: Page, settings: Record<string, unknown> = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((s) => {
    localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { motion: 'full', motionPicked: true, introSeen: true, ...s } }, version: 0 }));
    // No microphone here: tapping the orb opens "What should I do?" instead of listening.
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
  }, settings);
  await page.goto('/');
  const orb = page.getByRole('button', { name: /^Orb:/ });
  if (settings.orb !== false) await expect(orb).toBeVisible();
  else await expect(page.locator('.shell')).toBeVisible();
  return { errors, orb };
}

async function center(page: Page) {
  return page.locator('.orb-cursor').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

async function settled(page: Page) {
  let prev = await center(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(80);
    const now = await center(page);
    if (Math.hypot(now.x - prev.x, now.y - prev.y) < 0.5) return now;
    prev = now;
  }
  return prev;
}

test.describe('the orb', () => {
  test('is on every screen; the old pill at the top is gone', async ({ page }) => {
    const { errors, orb } = await openWithOrb(page);
    await expect(page.locator('orbit-island')).toHaveCount(0);
    await page.getByRole('button', { name: /^Settings\./ }).click();
    await expect(page.locator('.app-window[data-app="settings"]')).toBeVisible();
    await expect(orb).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('hold it to ask; it opens apps and changes settings for you', async ({ page }) => {
    const { errors } = await openWithOrb(page);
    // Press where it is once it has glided into place, not where it was mid-flight.
    const at = await settled(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    const panel = page.getByRole('dialog', { name: 'Ask the orb' });
    await expect(panel).toBeVisible();
    await panel.getByRole('textbox', { name: 'Tell the orb what to do' }).fill('Open Terminal');
    await panel.getByRole('button', { name: 'Go' }).click();
    await expect(page.locator('.app-window[data-app="terminal"]')).toBeVisible();
    await expect(panel.getByRole('list', { name: 'What happened' })).toContainText('Opened Terminal');

    await panel.getByRole('textbox', { name: 'Tell the orb what to do' }).fill('light mode');
    await panel.getByRole('button', { name: 'Go' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(errors).toEqual([]);
  });

  test('it taps and types like a cursor, flying to what it touches', async ({ page }) => {
    const { errors, orb } = await openWithOrb(page);
    await orb.click(); // no microphone: a tap opens the panel
    const panel = page.getByRole('dialog', { name: 'Ask the orb' });
    await panel.getByRole('textbox', { name: 'Tell the orb what to do' }).fill('open settings');
    await panel.getByRole('button', { name: 'Go' }).click();
    const win = page.locator('.app-window[data-app="settings"]');
    await expect(win).toBeVisible();
    // Where the orb is at the moment something is tapped, and what was tapped.
    await page.evaluate(() => {
      document.addEventListener(
        'click',
        (e) => {
          const t = (e.target as HTMLElement).getBoundingClientRect();
          const o = document.querySelector('.orb-cursor')!.getBoundingClientRect();
          (window as unknown as { lastTap: unknown }).lastTap = { dx: Math.abs(o.left + o.width / 2 - (t.left + t.width / 2)), dy: Math.abs(o.top + o.height / 2 - (t.top + t.height / 2)), label: (e.target as HTMLElement).textContent };
        },
        true,
      );
    });
    await panel.getByRole('textbox', { name: 'Tell the orb what to do' }).fill('tap Light');
    await panel.getByRole('button', { name: 'Go' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // It flew onto the button it pressed.
    const tap = (await page.evaluate(() => (window as unknown as { lastTap: { dx: number; dy: number; label: string } }).lastTap))!;
    expect(tap.label).toContain('Light');
    expect(tap.dx).toBeLessThan(12);
    expect(tap.dy).toBeLessThan(12);
    expect(errors).toEqual([]);
  });

  test('asks before turning a machine on', async ({ page }) => {
    const calls: unknown[] = [];
    await page.route('**/api/status', (route) => {
      calls.push(route.request().postDataJSON());
      return route.fulfill({ json: { machines: [], money: null } });
    });
    const { orb } = await openWithOrb(page);
    await orb.click();
    const panel = page.getByRole('dialog', { name: 'Ask the orb' });
    await panel.getByRole('textbox', { name: 'Tell the orb what to do' }).fill('turn on the AI machine');
    await panel.getByRole('button', { name: 'Go' }).click();
    const confirm = panel.getByRole('alertdialog', { name: 'Confirm' });
    await expect(confirm).toContainText('bills by the hour');
    expect(calls).toEqual([]);
    await confirm.getByRole('button', { name: 'Yes, do it' }).click();
    await expect.poll(() => calls).toEqual([{ machine: 'ai', action: 'start' }]);
  });

  test('drag and fling: it follows the finger, then lands on the side you threw it to', async ({ page }) => {
    const { errors } = await openWithOrb(page, { orbFollow: false });
    const start = await settled(page);
    const vw = page.viewportSize()!.width;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // A quick throw to the left.
    for (let i = 1; i <= 6; i++) await page.mouse.move(start.x - i * 50, start.y - i * 12);
    await page.mouse.up();
    const end = await settled(page);
    expect(end.x).toBeLessThan(vw / 2);
    expect(end.x).toBeGreaterThan(20);
    expect(end.x).toBeLessThan(40);
    expect(errors).toEqual([]);
  });

  test('can be switched off in Settings', async ({ page }) => {
    await openWithOrb(page, { orb: false });
    await expect(page.locator('.orb-cursor')).toHaveCount(0);
  });

  test('typing: the machine banner steps aside and the orb becomes the text cursor', async ({ page }) => {
    await mockAi(page, 'off');
    const { errors } = await openWithOrb(page);
    await page.getByRole('button', { name: /^AI\./ }).click();
    const win = page.locator('.app-window[data-app="ai"]');
    const banner = win.locator('.ai-banner');
    await expect(banner).toBeVisible();
    const box = win.getByRole('textbox', { name: 'Message' });
    await box.click();
    await expect(banner).toBeHidden();
    await expect(page.locator('.orb-layer')).toHaveAttribute('data-caret', 'true');
    await box.pressSequentially('hi');
    const caretAt = async () => {
      await page.waitForTimeout(450);
      return page.locator('.orb-cursor').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
      });
    };
    const field = (await box.boundingBox())!;
    const a = await caretAt();
    // A thin caret inside the box, on the text line.
    expect(a.w).toBeLessThan(8);
    expect(a.h).toBeGreaterThan(10);
    expect(a.x).toBeGreaterThan(field.x);
    expect(a.x).toBeLessThan(field.x + field.width);
    expect(a.y).toBeGreaterThan(field.y);
    expect(a.y).toBeLessThan(field.y + field.height);
    // It moves with the letters.
    await box.pressSequentially(' there, orb');
    const b = await caretAt();
    expect(b.x).toBeGreaterThan(a.x + 20);
    // The box's own caret is hidden: the orb is the caret.
    expect(await box.evaluate((el) => getComputedStyle(el).caretColor)).toBe('rgba(0, 0, 0, 0)');
    // Leaving the box: banner back, orb a ball again.
    await box.evaluate((el) => (el as HTMLElement).blur());
    await expect(banner).toBeVisible();
    await expect(page.locator('.orb-layer')).not.toHaveAttribute('data-caret', 'true');
    await expect.poll(async () => (await page.locator('.orb-cursor').boundingBox())!.width).toBeGreaterThan(40);
    expect(errors).toEqual([]);
  });
});
