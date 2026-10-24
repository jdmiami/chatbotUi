import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { expectNoHorizontalOverflow, openApp } from './helpers';
import { mockAi } from './aiMocks';

/** Gallery: Held for review. The owner sees what the machine set aside; approve, or keep it held with a note. No delete. */
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'gallery');
const SHOTS = process.env.HELD_SHOTS || '';
const R2 = 'https://acct.r2.cloudflarestorage.com/orbit-models';

const held = (id: string, file: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: file.endsWith('.webm') ? 'video' : 'image',
  prompt: `Swapped a person: the man in the red jacket (${id})`,
  nsfw: true,
  reason: "The safety check couldn't look at this result, so nobody has seen it yet.",
  category: 'checker-unavailable',
  heldAt: '2026-10-23T10:00:00Z',
  madeBy: 'You',
  character: { id: 'anna01', name: 'Anna' },
  notes: [],
  canApprove: true,
  url: `${R2}/held/${file}?X-Amz-Signature=abc`,
  ...extra,
});
const ITEMS = [
  held('held0001', 'clip.webm', { seconds: 4 }),
  held('held0002', 'city.jpg', {
    category: 'flagged',
    reason: "The safety check says this is adult content, on a swap that is not allowed to be adult (it has a real person's photo, or a video not made here).",
    madeBy: 'A studio member',
    character: undefined,
    canApprove: false,
    heldAt: '2026-10-22T10:00:00Z',
    notes: [{ at: '2026-10-22T12:00:00Z', by: 'owner', text: 'Waiting on the new check.' }],
  }),
];

async function serveFiles(page: Page) {
  await page.route(`${R2}/held/**`, (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!);
    const file = path.join(FIX, name);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, headers: { 'content-type': name.endsWith('.webm') ? 'video/webm' : 'image/jpeg' }, body: fs.readFileSync(file) });
  });
}

async function start(page: Page, opts: { heldStatus?: number; items?: unknown[] } = {}) {
  await mockAi(page, 'off');
  const posts: Record<string, unknown>[] = [];
  let items = (opts.items ?? ITEMS) as { id: string; notes: unknown[] }[];
  await page.route('**/api/gallery', (route) => route.fulfill({ json: { configured: true, items: [] } }));
  await page.route('**/api/held', async (route) => {
    const req = route.request();
    if (opts.heldStatus && opts.heldStatus !== 200) return route.fulfill({ status: opts.heldStatus, json: { error: 'Unauthorized' } });
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as { action: string; id: string; text?: string };
      posts.push(body);
      if (body.action === 'approve') items = items.filter((i) => i.id !== body.id);
      if (body.action === 'note') items = items.map((i) => (i.id === body.id ? { ...i, notes: [...i.notes, { at: '2026-10-24T09:00:00Z', by: 'owner', text: body.text }] } : i));
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { configured: true, items } });
  });
  await page.route('**/fake-ai/_orbit/**', (route) => route.abort());
  await serveFiles(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, introSeen: true } }, version: 0 }));
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const win = await openApp(page, 'gallery');
  return { win, posts, errors };
}

const shot = async (page: Page, name: string, project: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${project}-${name}.png`) });
};

test('Held for review: the owner sees a tab with a count, blurred previews to hold, the reason, who made it; approve and keep held; no delete', async ({ page }, testInfo) => {
  const { win, posts, errors } = await start(page);
  const tab = win.getByRole('radio', { name: /^Held for review/ });
  await expect(tab).toBeVisible();
  await expect(tab.getByLabel('2 held')).toBeVisible();
  expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await tab.click();

  const cards = win.getByTestId('held-item');
  await expect(cards).toHaveCount(2);
  const first = cards.first();
  await expect(first).toContainText('Made by You · character: Anna');
  await expect(first).toContainText("The safety check couldn't look at this result");
  await expect(first).toContainText('man in the red jacket (held0001)');
  await expect(cards.nth(1)).toContainText('Made by A studio member');
  await expect(cards.nth(1)).toContainText('Waiting on the new check.');
  // Nothing here deletes.
  await expect(win.getByRole('button', { name: /delete/i })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await shot(page, 'list', testInfo.project.name);
  await first.scrollIntoViewIfNeeded();
  if (SHOTS) await first.screenshot({ path: path.join(SHOTS, `${testInfo.project.name}-card.png`) });

  // Blurred until held.
  const thumb = first.locator('.held-thumb');
  await expect(thumb).toHaveAttribute('data-censored', '');
  await expect(thumb).not.toHaveAttribute('data-revealed', /.*/);
  expect(await thumb.locator('.ai-tile').evaluate((el) => getComputedStyle(el).filter)).toContain('blur');
  const b = (await thumb.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect(thumb).toHaveAttribute('data-revealed', '');
  await page.waitForTimeout(250);
  await shot(page, 'revealed', testInfo.project.name);
  await page.mouse.up();
  await expect(thumb).not.toHaveAttribute('data-revealed', /.*/);

  // The shared viewer: locked blurred, no NSFW switch, no delete.
  await thumb.locator('.ai-tile').click();
  const viewer = page.getByRole('dialog', { name: 'Held result' });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole('switch', { name: 'NSFW', exact: true })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: /delete/i })).toHaveCount(0);
  await expect(viewer.locator('.ai-viewer-media')).toHaveAttribute('data-censored', '');
  await expect(viewer.getByText('1 of 2')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // A real person's photo or an outside video: no Approve, said plainly.
  await expect(cards.nth(1).getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(cards.nth(1)).toContainText("It can't be approved");

  // Keep held, with a note.
  await first.getByRole('textbox', { name: /Note for/ }).fill('Looks fine, wait for the check');
  await first.getByRole('button', { name: 'Keep held' }).click();
  await expect.poll(() => posts).toContainEqual({ action: 'note', id: 'held0001', text: 'Looks fine, wait for the check' });
  await expect(first).toContainText('Looks fine, wait for the check');

  // Approve asks first, then it leaves the list.
  await first.getByRole('button', { name: 'Approve' }).click();
  const ask = page.getByRole('dialog', { name: 'Approve this?' });
  await expect(ask).toContainText('still blurred until held');
  await shot(page, 'approve', testInfo.project.name);
  await ask.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => posts).toContainEqual({ action: 'approve', id: 'held0001' });
  await expect(cards).toHaveCount(1);
  await expect(tab.getByLabel('1 held')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Held for review is hidden when nothing is held, and for anyone who is not the owner', async ({ page }) => {
  const none = await start(page, { items: [] });
  await expect(none.win.getByRole('radiogroup', { name: 'Made in' })).toBeVisible();
  await expect(none.win.getByRole('radio', { name: /Held for review/ })).toHaveCount(0);
  await expect(none.win.getByText('Held for review')).toHaveCount(0);
});

test('Held for review is hidden when the site says it is not the owner (401)', async ({ page }) => {
  const { win } = await start(page, { heldStatus: 401 });
  await expect(win.getByRole('radiogroup', { name: 'Made in' })).toBeVisible();
  await page.waitForTimeout(400);
  await expect(win.getByRole('radio', { name: /Held for review/ })).toHaveCount(0);
});
