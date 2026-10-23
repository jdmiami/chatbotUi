import { expect, test } from '@playwright/test';
import { appWindow, expectNoHorizontalOverflow, goHome, indexButton, isTablet, openApp, openIndex, openOrbit } from './helpers';

test.describe('shell', () => {
  test('first-run sheet discloses what is simulated', async ({ page }) => {
    await openOrbit(page, { keepIntro: true });
    const sheet = page.getByRole('dialog', { name: /Welcome to Orbit/ });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('not connected to your Linux machine');
    await expect(sheet).toContainText('does not sync');
    await sheet.getByRole('button', { name: 'Got it' }).click();
    await page.reload();
    await expect(page.getByRole('dialog', { name: /Welcome to Orbit/ })).toHaveCount(0);
  });

  test('home path and index show the apps, the demo state and no horizontal overflow', async ({ page }) => {
    const errors = await openOrbit(page);
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'o5');
    const home = page.getByRole('main', { name: 'Home' });
    await expect(home).toHaveAttribute('data-hidden', 'false');
    await expect(home).toContainText('You are in the demo workspace');
    await expectNoHorizontalOverflow(page);
    const index = await openIndex(page);
    for (const name of ['Terminal', 'Code', 'Antigravity', 'Settings']) {
      await expect(index.locator('.o5-index-list').getByRole('button', { name: new RegExp(`^\\d+\\s+${name}\\b`) })).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('the index opens apps, lists what is open, and goes home', async ({ page }) => {
    await openOrbit(page);
    await openApp(page, 'terminal');
    await expect(appWindow(page, 'terminal')).toHaveAttribute('data-placement', 'full');
    await openApp(page, 'editor');
    await expect(appWindow(page, 'editor')).toHaveAttribute('data-placement', 'full');
    await expect(appWindow(page, 'terminal')).toHaveAttribute('data-placement', 'hidden');
    // Terminal stays open: the index lists it under "Open now".
    const index = await openIndex(page);
    await expect(index.getByRole('region', { name: 'Open now' })).toContainText('Terminal');
    await page.keyboard.press('Escape');
    await expect(index).toHaveCount(0);
    await goHome(page);
  });

  test('App Switcher (keyboard) lists open apps and closes them', async ({ page }) => {
    await openOrbit(page);
    await openApp(page, 'settings');
    await openApp(page, 'terminal');
    await page.keyboard.press('Control+Shift+KeyA');
    const switcher = page.getByRole('dialog', { name: 'App Switcher' });
    await expect(switcher).toBeVisible();
    await expect(switcher.getByRole('button', { name: 'Open Terminal' })).toBeVisible();
    await expect(switcher.getByRole('button', { name: 'Open Settings' })).toBeVisible();
    await switcher.getByRole('button', { name: 'Close Settings' }).click();
    await expect(switcher.getByRole('button', { name: 'Open Settings' })).toHaveCount(0);
    await switcher.getByRole('button', { name: 'Open Terminal' }).click();
    await expect(switcher).toHaveCount(0);
    await expect(appWindow(page, 'terminal')).toHaveAttribute('data-placement', 'full');
    await expect(appWindow(page, 'settings')).toHaveCount(0);
  });

  test('Control Center (keyboard) toggles theme and accent, Escape closes it', async ({ page }) => {
    await openOrbit(page);
    await page.keyboard.press('Control+Shift+Period');
    const cc = page.getByRole('dialog', { name: 'Control Center' });
    await expect(cc).toBeVisible();
    await expect(cc).toContainText('Demo mode');
    // Orbit 0.5 is the only look: no tile to switch looks.
    await expect(cc.getByRole('button', { name: /Orbit 0\.5/ })).toHaveCount(0);
    await cc.getByRole('button', { name: /Dark mode/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await cc.getByRole('button', { name: 'Teal' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal');
    await page.keyboard.press('Escape');
    await expect(cc).toHaveCount(0);
    // preferences persist across reloads
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal');
  });

  test('Code + Chat split view is offered only on iPad', async ({ page }, testInfo) => {
    await openOrbit(page);
    const settings = await openApp(page, 'settings');
    const open = settings.getByRole('button', { name: 'Open Code + Chat' });
    if (!isTablet(testInfo)) {
      await expect(open).toHaveCount(0);
      await expect(settings).toContainText('Available on iPad in wider layouts.');
      return;
    }
    await open.scrollIntoViewIfNeeded();
    await open.click();
    await expect(appWindow(page, 'editor')).toHaveAttribute('data-placement', 'split-left');
    await expect(appWindow(page, 'agent')).toHaveAttribute('data-placement', 'split-right');
    const divider = page.getByRole('separator', { name: /Resize split view/ });
    await expect(divider).toBeVisible();
    const before = Number(await divider.getAttribute('aria-valuenow'));
    await divider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(divider).toHaveAttribute('aria-valuenow', String(before + 5));
    // leaving split keeps both apps open
    await page.keyboard.press('Control+Shift+Backslash');
    await expect(appWindow(page, 'editor')).toHaveAttribute('data-placement', 'full');
    await expect(appWindow(page, 'agent')).toHaveAttribute('data-placement', 'hidden');
  });

  test('hardware keyboard shortcuts', async ({ page }) => {
    await openOrbit(page);
    await page.keyboard.press('Control+Shift+Digit1');
    await expect(appWindow(page, 'terminal')).toHaveAttribute('data-placement', 'full');
    await page.keyboard.press('Control+Shift+KeyA');
    await expect(page.getByRole('dialog', { name: 'App Switcher' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Shift+KeyH');
    await expect(page.getByRole('main', { name: 'Home' })).toHaveAttribute('data-hidden', 'false');
  });

  test('the line at the bottom is at least 44px, at home and inside an app', async ({ page }) => {
    await openOrbit(page);
    for (const where of ['home', 'app'] as const) {
      if (where === 'app') await openApp(page, 'settings');
      const box = (await indexButton(page).boundingBox())!;
      expect(box.width, `${where}: wide enough`).toBeGreaterThanOrEqual(44);
      expect(box.height, `${where}: tall enough`).toBeGreaterThanOrEqual(44);
    }
  });
});
