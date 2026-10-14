import { expect, test } from '@playwright/test';
import { appWindow, dock, expectNoHorizontalOverflow, isTablet, launchFromHome, openOrbit } from './helpers';

test.describe('shell', () => {
  test('first-run sheet discloses what is simulated', async ({ page }) => {
    await openOrbit(page, { keepIntro: true });
    const sheet = page.getByRole('dialog', { name: /Welcome to Orbit/ });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('not connected to an Ubuntu machine');
    await expect(sheet).toContainText('does not sync');
    await sheet.getByRole('button', { name: 'Got it' }).click();
    await page.reload();
    await expect(page.getByRole('dialog', { name: /Welcome to Orbit/ })).toHaveCount(0);
  });

  test('home screen shows apps, demo state and no horizontal overflow', async ({ page }) => {
    const errors = await openOrbit(page);
    for (const name of ['Terminal', 'Code', 'Antigravity', 'Settings']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${name}\\.`) })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: /Demo mode/ })).toBeVisible();
    await expect(page.getByText('Not connected', { exact: true })).toBeVisible();
    await expect(dock(page)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('dock launches apps, shows Home, and returns home', async ({ page }) => {
    await openOrbit(page);
    await dock(page).getByRole('button', { name: /^Terminal/ }).click();
    await expect(appWindow(page, 'terminal')).toHaveAttribute('data-placement', 'full');
    await dock(page).getByRole('button', { name: /^Code/ }).click();
    await expect(appWindow(page, 'editor')).toHaveAttribute('data-placement', 'full');
    await expect(appWindow(page, 'terminal')).toHaveAttribute('data-placement', 'hidden');
    // running indicator: Terminal stays open
    await expect(dock(page).getByRole('button', { name: 'Terminal (open)' })).toBeVisible();
    await dock(page).getByRole('button', { name: 'Home screen' }).click();
    await expect(page.locator('main.home')).toHaveAttribute('data-hidden', 'false');
  });

  test('App Switcher lists open apps and closes them', async ({ page }) => {
    await openOrbit(page);
    await launchFromHome(page, 'Settings');
    await dock(page).getByRole('button', { name: /^Terminal/ }).click();
    await dock(page).getByRole('button', { name: 'App Switcher' }).click();
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

  test('Control Center toggles theme and accent, Escape closes it', async ({ page }) => {
    await openOrbit(page);
    await dock(page).getByRole('button', { name: 'Control Center' }).click();
    const cc = page.getByRole('dialog', { name: 'Control Center' });
    await expect(cc).toBeVisible();
    await expect(cc).toContainText('Demo mode');
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
    const splitIcon = page.getByRole('button', { name: /^Code and Chat\./ });
    if (!isTablet(testInfo)) {
      await expect(splitIcon).toHaveCount(0);
      await expect(dock(page).getByRole('button', { name: /side by side/ })).toHaveCount(0);
      return;
    }
    await splitIcon.click();
    await expect(appWindow(page, 'editor')).toHaveAttribute('data-placement', 'split-left');
    await expect(appWindow(page, 'agent')).toHaveAttribute('data-placement', 'split-right');
    const divider = page.getByRole('separator', { name: /Resize split view/ });
    await expect(divider).toBeVisible();
    const before = Number(await divider.getAttribute('aria-valuenow'));
    await divider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(divider).toHaveAttribute('aria-valuenow', String(before + 5));
    // leaving split keeps both apps open
    await dock(page).getByRole('button', { name: /Leave Code and Chat split view/ }).click();
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
    await expect(page.locator('main.home')).toHaveAttribute('data-hidden', 'false');
  });

  test('dock targets are at least 44px', async ({ page }) => {
    await openOrbit(page);
    const sizes = await dock(page)
      .getByRole('button')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.width, r.height]));
    for (const [w, h] of sizes) {
      expect(w).toBeGreaterThanOrEqual(44);
      expect(h).toBeGreaterThanOrEqual(44);
    }
  });
});
