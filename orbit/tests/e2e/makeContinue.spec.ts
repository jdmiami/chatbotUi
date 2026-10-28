import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, openApp, openOrbit, expectValue } from './helpers';
import { mockAi, openMakeApp } from './aiMocks';

/**
 * Carrying on from a creation with the AI machine off: Make's own gallery shows what cloud storage
 * keeps (made on the machine or the serverless machine), and the Gallery app's viewer offers the same
 * "Use prompt", "Make it move" and "Edit" buttons as Make's, handing the picture over to Make.
 */
const R2 = 'https://acct.r2.cloudflarestorage.com/orbit-models/gallery';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const stored = (id: string, kind: 'image' | 'video', prompt: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind,
  source: 'make',
  prompt,
  lab: false,
  createdAt: '2026-10-27T12:00:00Z',
  url: `${R2}/${id}.${kind === 'image' ? 'png' : 'webm'}?X-Amz-Signature=abc`,
  downloadUrl: `${R2}/${id}.png?X-Amz-Signature=abc&response-content-disposition=attachment`,
  bytes: 1000,
  width: 1328,
  height: 1328,
  ...extra,
});
const ITEMS = [stored('fox01', 'image', 'a red fox in snow'), stored('bike01', 'image', 'a bicycle in a sunlit alley'), stored('lab01', 'image', 'Rooftop glance', { source: 'lab', lab: true })];

async function offWithGallery(page: Page) {
  await mockAi(page, 'off');
  const deleted: string[] = [];
  let items = ITEMS;
  await page.route('**/api/gallery', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { action: string; id: string };
      if (body.action === 'delete') {
        deleted.push(body.id);
        items = items.filter((i) => i.id !== body.id);
      }
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { configured: true, items } });
  });
  await page.route(`${R2}/**`, (route) => route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: Buffer.from(PNG, 'base64') }));
  await page.route('**/fake-ai/_orbit/**', (route) => route.abort());
  await page.route('**/api/make/serverless**', (route) => route.fulfill({ json: { configured: true, ready: true, pricePerHour: { from: 1.22, to: 1.75 }, wanted: [] } }));
  return { deleted };
}

test('Make with the AI machine off: its gallery shows what cloud storage keeps, and a picture can be reused, carried on and deleted', async ({ page }) => {
  const { deleted } = await offWithGallery(page);
  const errors = await openOrbit(page);
  const win = await openMakeApp(page);
  await win.getByRole('button', { name: /^Gallery:/ }).click();
  const grid = win.getByRole('list', { name: 'Your creations' });
  // Lab results stay in the Lab; the two pictures are here.
  await expect(grid.getByRole('listitem')).toHaveCount(2);
  await expectNoHorizontalOverflow(page);

  // Open one: the same buttons as with the machine on, and "Make it move" starts a video from it.
  await grid.getByRole('button', { name: 'Image: a red fox in snow' }).click();
  const viewer = page.getByRole('dialog', { name: 'Image' });
  await expect(viewer.getByRole('button', { name: 'Use prompt' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Make it move' }).click();
  await expect(page.getByText('Describe how it should move, then make the video.')).toBeVisible();
  await expect(win.locator('.mk-pane[data-step="describe"]')).toBeVisible();

  // Delete goes to cloud storage.
  await win.getByRole('button', { name: /^Gallery:/ }).click();
  await grid.getByRole('button', { name: 'Image: a bicycle in a sunlit alley' }).click();
  await page.getByRole('dialog', { name: 'Image' }).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
  await expect.poll(() => deleted).toEqual(['bike01']);
  await expect(grid.getByRole('listitem')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Gallery app: "Use prompt", "Make it move" and "Edit" hand a creation to Make', async ({ page }) => {
  await offWithGallery(page);
  const errors = await openOrbit(page);
  const gallery = await openApp(page, 'gallery');
  await gallery.getByRole('list', { name: 'All your creations' }).getByRole('button', { name: 'Image: a red fox in snow' }).click();
  const viewer = page.getByRole('dialog', { name: 'Picture' });
  await expect(viewer.getByRole('button', { name: 'Make it move' })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await viewer.getByRole('button', { name: 'Use prompt' }).click();

  // Make opens on the words, with the picture's prompt filled in.
  const make = page.locator('.app-window[data-app="make"]');
  await expect(make).toBeVisible();
  await expectValue(make.getByRole('textbox', { name: 'Describe it' }), 'a red fox in snow');
  await expect(make.locator('.mk-pane[data-step="describe"]')).toBeVisible();

  // Back to the Gallery: "Edit" opens Make on the edit, with the picture in place.
  await openApp(page, 'gallery');
  await gallery.getByRole('list', { name: 'All your creations' }).getByRole('button', { name: 'Image: a red fox in snow' }).click();
  await page.getByRole('dialog', { name: 'Picture' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(make).toBeVisible();
  await expect(page.getByText('Describe the change, then make the edit.')).toBeVisible();
  await expect(make.locator('.mk-pane[data-step="describe"]')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('Make: words typed on the edit step stay when you go Next and come back (plain box, as on an iPhone)', async ({ page }) => {
  await offWithGallery(page);
  // The plain box every iPhone and iPad gets (the page's root is not there yet when this runs).
  await page.addInitScript(() => {
    const mark = () => document.documentElement?.setAttribute('data-textbox', 'plain');
    if (document.documentElement) mark();
    else new MutationObserver((_, o) => void (document.documentElement && (mark(), o.disconnect()))).observe(document, { childList: true });
  });
  const errors = await openOrbit(page);
  const win = await openMakeApp(page);
  await win.getByRole('radiogroup', { name: 'What to make' }).getByRole('radio', { name: /^An edit/ }).click();
  await win.getByRole('radiogroup', { name: 'Maker' }).getByRole('radio', { name: /^Edit with words/ }).click();
  await expect(win.locator('.mk-pane')).toHaveCount(1);
  const box = win.getByRole('textbox', { name: 'Describe it' });
  await expect(box).toHaveAttribute('contenteditable', /plaintext-only|true/);
  await box.click();
  await page.keyboard.type('make it snow over the hills');
  await expectValue(box, 'make it snow over the hills');
  await win.getByRole('button', { name: /^Next:/ }).click();
  await expect(win.locator('.mk-pane')).toHaveCount(1);
  await win.getByRole('button', { name: /^Back:/ }).click();
  await expect(win.locator('.mk-pane')).toHaveCount(1);
  await expectValue(win.getByRole('textbox', { name: 'Describe it' }), 'make it snow over the hills');
  // And the last step shows the words.
  await win.getByRole('navigation', { name: 'Make, step by step' }).getByRole('button', { name: /Check & make$/ }).click();
  await expect(win.locator('.mk-pane[data-step="check"]')).toContainText('make it snow over the hills');
  expect(errors).toEqual([]);
});
