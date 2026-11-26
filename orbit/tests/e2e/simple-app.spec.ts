import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';

// Simple (the site's light page, /lite) opens inside Orbit as an app, and can be made the full-screen look.
test('Simple opens from the Index in an Orbit window; Full screen makes it the look of this device', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/lite', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Simple</title><h1>What will it be?</h1>' }));
  let chose = '';
  await page.route('**/choose?**', (route) => {
    chose = new URL(route.request().url()).search;
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Simple</title><p>Simple full screen</p>' });
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, introSeen: true } }, version: 0 }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  const list = page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list');
  await expect(list.locator('svg.app-art[data-app="simple"]')).toHaveCount(1);
  await list.getByRole('button', { name: /Simple/ }).click();
  const win = page.locator('.app-window[data-app="simple"]');
  const frame = win.locator('iframe[title="Simple"]');
  await expect(frame).toHaveAttribute('src', '/lite');
  await expect(page.frameLocator('.app-window[data-app="simple"] iframe').getByRole('heading', { name: 'What will it be?' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await win.getByRole('button', { name: 'Full screen' }).click();
  await expect(page.getByText('Simple full screen')).toBeVisible();
  expect(chose).toBe('?ui=simple');
  expect(errors).toEqual([]);
});
