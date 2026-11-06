import { expect, test, type Page } from '@playwright/test';

/**
 * Flipbook's own site: opens straight to the desk with no sign-in, installs as its own app (manifest
 * and icons), keeps drawings after a reload, and still opens with no connection once it has been
 * opened. iPhone gets the viewer.
 */

const isTablet = (name: string) => name.startsWith('ipad');

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  return errors;
}

test('opens with no sign-in, as its own app: title, manifest, icons', async ({ page, request }, info) => {
  const errors = await open(page);
  await expect(page).toHaveTitle('Flipbook');
  expect(page.url()).not.toContain('login');
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'Flipbook', display: 'standalone' });
  for (const icon of ['/icon.svg', '/apple-touch-icon.png', '/icon-512.png']) expect((await request.get(icon)).status()).toBe(200);
  if (isTablet(info.project.name)) await expect(page.locator('.fb-desk')).toBeVisible();
  else await expect(page.getByRole('heading', { name: 'Flipbook draws on iPad' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test('iPad: a pen line stays after a reload, and the app opens offline', async ({ page, context }, info) => {
  test.skip(!isTablet(info.project.name), 'drawing is on iPad');
  const errors = await open(page);
  const b = (await page.locator('.fb-ink').boundingBox())!;
  const fire = (type: string, u: number, v: number) =>
    page.evaluate(
      ([type, x, y]) =>
        document.querySelector('.fb-desk')!.dispatchEvent(new PointerEvent(type as string, { clientX: x as number, clientY: y as number, pointerType: 'pen', pointerId: 9, bubbles: true, isPrimary: true, pressure: 0.6, buttons: 1 })),
      [type, b.x + u * b.width, b.y + v * b.height] as const,
    );
  await fire('pointerdown', 0.2, 0.5);
  for (let i = 1; i <= 6; i++) await fire('pointermove', 0.2 + i * 0.1, 0.5);
  await fire('pointerup', 0.8, 0.5);
  const ink = () =>
    page.locator('.fb-ink').evaluate((cv: HTMLCanvasElement) => {
      const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) n++;
      return n;
    });
  await expect.poll(ink).toBeGreaterThan(20);
  // The offline worker is in charge once the page has loaded.
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready.then(() => true)), { timeout: 10_000 }).toBe(true);
  await page.waitForTimeout(500);
  await page.reload();
  await expect.poll(ink).toBeGreaterThan(20);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.fb-desk')).toBeVisible();
  await expect.poll(ink).toBeGreaterThan(20);
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
