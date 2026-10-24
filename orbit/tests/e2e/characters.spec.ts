import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { expectNoHorizontalOverflow, openOrbit } from './helpers';
import { mockAi, openMakeApp } from './aiMocks';
import { DRAFT, READY, mockCharacters, mockStoredCharacters, portrait } from './charactersMocks';

/**
 * Characters in Make: the library (from cloud storage with the AI machine off), the walk-through that
 * makes one (with the machine's routes mocked), "Add a character" in Describe it, and "Pick one of
 * your characters" for Swap a person. CHARACTERS_SHOTS=<folder> keeps a screenshot of each screen.
 */
const SHOTS = process.env.CHARACTERS_SHOTS || '';
const shot = async (page: Page, name: string, project: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${project}-${name}.png`) });
};

const READY_STATE = { ready: true, downloaded: true, percent: 100 };
const MP4 = Buffer.from('00000018667479706d70343200000000', 'hex');
const MAKERS = [
  { id: 'qwen', kind: 'image', name: 'Qwen Uncensored', blurb: 'All-rounder.', for: null, builtIn: true, wanted: true, installed: true, percent: 100 },
  { id: 'ltx', kind: 'video', name: 'LTX 10Eros', blurb: 'Video with sound.', for: null, builtIn: true, wanted: true, installed: true, percent: 100 },
  { id: 'edit', kind: 'edit', name: 'Edit with words', blurb: 'Change a picture.', for: null, builtIn: true, wanted: true, installed: true, percent: 100 },
  { id: 'person-swap', kind: 'videoedit', name: 'Swap a person', blurb: 'Put someone from your photo in place of a person in your video.', for: null, needs: ['video', 'target', 'photo'], accepts: ['facePhoto'], builtIn: false, wanted: true, installed: true, percent: 100 },
].map((m) => ({ twoImages: false, size: 1e9, ...m }));

async function mockStudio(page: Page) {
  const requests: Record<string, unknown>[] = [];
  await page.route('**/fake-ai/_orbit/studio', (r) => r.fulfill({ json: { setup: 'running', running: true, image: READY_STATE, video: READY_STATE, downloading: null, downloadError: null, jobs: [] } }));
  await page.route('**/fake-ai/_orbit/studio/makers', (r) => r.fulfill({ json: { makers: MAKERS } }));
  await page.route('**/fake-ai/_orbit/studio/items', (r) => r.fulfill({ json: { items: [] } }));
  await page.route('**/fake-ai/_orbit/studio/lab**', (r) => r.fulfill({ status: 404, json: { error: 'Not found' } }));
  await page.route('**/fake-ai/_orbit/studio/uploads', (r) => r.fulfill({ json: { id: 'uvid1', kind: 'video', size: 10 } }));
  await page.route('**/fake-ai/_orbit/studio/jobs', (r) => {
    const body = r.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    return r.fulfill({ json: { id: `job${requests.length}`, kind: body.kind, prompt: body.prompt, status: 'queued', progress: 0, error: null, createdAt: '', item: null, position: 1, etaSeconds: 40 } });
  });
  await page.route('**/fake-ai/_orbit/studio/jobs/*', (r) => r.fulfill({ json: { id: 'job1', kind: 'image', prompt: 'x', status: 'running', progress: 40, error: null, createdAt: '', item: null } }));
  return requests;
}

async function noSiteStorage(page: Page) {
  // No site behind the preview: cloud storage answers with a page, not data.
  await page.route('**/api/characters', (r) => r.fulfill({ status: 404, contentType: 'text/html', body: '<html></html>' }));
}

async function openCharacters(page: Page) {
  const win = await openMakeApp(page);
  await win.getByRole('button', { name: 'Characters' }).click();
  const screen = win.getByRole('region', { name: 'Characters' });
  await expect(screen).toBeVisible();
  return { win, screen };
}

const pane = (win: Locator) => win.locator('.mk-pane[data-live]');
async function expectStep(win: Locator, title: string) {
  await expect(pane(win).getByRole('heading', { level: 3 })).toHaveText(title);
  await expect(win.locator('.mk-pane')).toHaveCount(1);
}

test.describe('Characters', () => {
  test('the header has a Characters button beside Cloud and Gallery; the library reads from cloud storage with the machine off', async ({ page }, testInfo) => {
    await mockAi(page, 'off');
    await page.route('**/fake-ai/_orbit/**', (r) => r.abort());
    await mockStoredCharacters(page, [READY('r1', 'Mira Vale', 34, 1), READY('r2', 'Tomas Reyes', 41, 2), DRAFT('d1', 'Ines Okafor', 29, 3)]);
    const errors = await openOrbit(page);
    const win = await openMakeApp(page);
    const header = win.locator('.mk-actions');
    await expect(header.getByRole('button')).toHaveText(['Cloud', 'Characters', 'Gallery']);
    for (const b of await header.getByRole('button').all()) {
      const box = (await b.boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalOverflow(page);
    await win.getByRole('button', { name: 'Characters' }).click();
    const screen = win.getByRole('region', { name: 'Characters' });
    await expect(screen).toBeVisible();
    await expect(screen.getByRole('heading', { name: 'Your characters' })).toBeVisible();
    // Photos still work as before; a character is needed for adult results: said in plain words.
    await expect(screen.getByText('Photos you upload still work as before; for adult results a character is needed.', { exact: false })).toBeVisible();
    const grid = screen.getByRole('list', { name: 'Your characters' });
    await expect(grid.getByRole('listitem')).toHaveCount(3);
    await expect(grid.getByRole('button', { name: 'Ines Okafor, 29, unfinished' })).toBeVisible();
    await expect(grid.getByText('Unfinished')).toBeVisible();
    await expect(screen.getByText('Showing what is saved in cloud storage.', { exact: false })).toBeVisible();
    // Thumbnails are the sheet pictures.
    await expect.poll(() => grid.locator('img').first().evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
    // Making and changing need the machine.
    await expect(screen.getByRole('button', { name: 'Create character' }).first()).toBeDisabled();
    await expectNoHorizontalOverflow(page);
    await shot(page, 'library-machine-off', testInfo.project.name);

    await grid.getByRole('button', { name: 'Mira Vale, 34' }).click();
    const detail = page.getByRole('dialog', { name: 'Mira Vale' });
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('list', { name: "Mira Vale's reference sheet" }).getByRole('listitem')).toHaveCount(8);
    await expect(detail.getByRole('button', { name: 'Use in Make' })).toBeDisabled();
    await expect(detail.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await expect(detail.getByText('Turn on the AI machine to use, change or delete characters.')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, 'detail-machine-off', testInfo.project.name);
    expect(errors.filter((e) => !/Failed to load resource|ERR_FAILED/.test(e))).toEqual([]);
  });

  test('storage that is not set up says so plainly', async ({ page }) => {
    await mockAi(page, 'off');
    await page.route('**/fake-ai/_orbit/**', (r) => r.abort());
    await mockStoredCharacters(page, [], false);
    await openOrbit(page);
    const { screen } = await openCharacters(page);
    await expect(screen.getByText('once storage keys are added', { exact: false })).toBeVisible();
    await expect(screen.getByText('No characters yet')).toBeVisible();
  });

  test('the library with the machine on: use in Make, rename, duplicate and delete behind a confirm sheet', async ({ page }, testInfo) => {
    await mockAi(page, 'on');
    await mockStudio(page);
    await noSiteStorage(page);
    const m = await mockCharacters(page, [READY('r1', 'Mira Vale', 34, 1), READY('r2', 'Tomas Reyes', 41, 2), DRAFT('d1', 'Ines Okafor', 29, 3)]);
    await openOrbit(page);
    const { win, screen } = await openCharacters(page);
    const grid = screen.getByRole('list', { name: 'Your characters' });
    await expect(grid.getByRole('listitem')).toHaveCount(3);
    await expect(screen.getByRole('button', { name: 'Create character' }).first()).toBeEnabled();
    await shot(page, 'library', testInfo.project.name);

    // Rename.
    await grid.getByRole('button', { name: 'Tomas Reyes, 41' }).click();
    let detail = page.getByRole('dialog', { name: 'Tomas Reyes' });
    await detail.getByRole('button', { name: 'Rename' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename' });
    await rename.getByLabel('Name').fill('Tomas Hale');
    await rename.getByRole('button', { name: 'Rename' }).click();
    await expect(grid.getByRole('button', { name: 'Tomas Hale, 41' })).toBeVisible();
    expect(m.calls.some((c) => c.method === 'POST' && c.path === '/r2/rename' && c.body?.name === 'Tomas Hale')).toBe(true);

    // Duplicate.
    await grid.getByRole('button', { name: 'Mira Vale, 34' }).click();
    detail = page.getByRole('dialog', { name: 'Mira Vale' });
    await detail.getByRole('button', { name: 'Duplicate' }).click();
    await expect(grid.getByRole('button', { name: 'Mira Vale copy, 34' })).toBeVisible();

    // Delete: a confirm sheet that says what stays.
    await grid.getByRole('button', { name: 'Mira Vale copy, 34' }).click();
    detail = page.getByRole('dialog', { name: 'Mira Vale copy' });
    await detail.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete Mira Vale copy?' });
    await expect(confirm).toContainText('Pictures and videos you already made with them stay in your gallery.');
    await shot(page, 'delete-confirm', testInfo.project.name);
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect(m.calls.some((c) => c.method === 'DELETE')).toBe(false);
    await expect(grid.getByRole('button', { name: 'Mira Vale copy, 34' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Mira Vale copy' }).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog', { name: 'Delete Mira Vale copy?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(grid.getByRole('button', { name: 'Mira Vale copy, 34' })).toHaveCount(0);
    expect(m.calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toHaveLength(1);

    // Use in Make: back on the steps, at Describe it, with the character attached.
    await grid.getByRole('button', { name: 'Mira Vale, 34' }).click();
    await page.getByRole('dialog', { name: 'Mira Vale' }).getByRole('button', { name: 'Use in Make' }).click();
    await expect(screen).toBeHidden();
    await expectStep(win, 'Describe it');
    await expect(win.getByRole('group', { name: 'Add a character' }).getByRole('button', { name: 'Mira Vale' })).toHaveAttribute('aria-pressed', 'true');
    // An unfinished character is not offered.
    await expect(win.getByRole('group', { name: 'Add a character' }).getByRole('button')).toHaveCount(2);
  });

  test('make a character, step by step: the rules are said, the sheet is made on the machine, then it is saved', async ({ page }, testInfo) => {
    await mockAi(page, 'on');
    await mockStudio(page);
    await noSiteStorage(page);
    const m = await mockCharacters(page, []);
    const errors = await openOrbit(page);
    const { win, screen } = await openCharacters(page);
    await expect(screen.getByText('No characters yet')).toBeVisible();
    await shot(page, 'library-empty', testInfo.project.name);
    await screen.getByRole('button', { name: 'Create character' }).first().click();
    const wiz = screen.getByTestId('character-wizard');
    await expect(screen.getByRole('heading', { name: 'Make a character' })).toBeVisible();
    const dots = wiz.getByRole('navigation', { name: 'Make a character, step by step' }).getByRole('button');
    await expect(dots).toHaveCount(7);
    await expectStep(wiz, 'Who are they?');
    await expect(wiz.getByText('A made-up grown-up, 25 or older.', { exact: false })).toBeVisible();

    // 1 · name and age: Hold to talk and Fill for me, and the age rule said straight away.
    await expect(wiz.getByRole('button', { name: 'Hold to talk: their name' })).toBeVisible();
    await wiz.getByRole('group', { name: 'Help with their name' }).getByRole('button', { name: 'Fill for me' }).click();
    await expect(wiz.getByRole('textbox', { name: 'Name' })).not.toHaveValue('');
    await wiz.getByRole('textbox', { name: 'Name' }).fill('Mira Vale');
    await wiz.getByRole('textbox', { name: 'Age' }).fill('20');
    await expect(wiz.getByRole('alert')).toContainText('A character must be 25 or older.');
    await shot(page, 'create-1-name-age-refused', testInfo.project.name);
    await wiz.getByRole('textbox', { name: 'Age' }).fill('34');
    await expect(wiz.getByRole('alert')).toHaveCount(0);
    // The one-line idea: Fill for me, and the whole character designed from it.
    const idea = wiz.getByRole('textbox', { name: 'A one-line idea' });
    await wiz.getByRole('group', { name: 'Help with the idea' }).getByRole('button', { name: 'Fill for me' }).click();
    await expect(idea).not.toHaveValue('');
    await expect(wiz.getByRole('button', { name: 'Design it for me' })).toBeEnabled();
    await shot(page, 'create-1-name-age', testInfo.project.name);

    // 2 · look
    await wiz.getByRole('button', { name: 'Next: Look' }).click();
    await expectStep(wiz, 'How do they look?');
    await wiz.getByRole('radiogroup', { name: 'Style' }).getByRole('radio', { name: 'Anime' }).click();
    await wiz.getByRole('radiogroup', { name: 'Shown as' }).getByRole('radio', { name: 'Man', exact: true }).click();
    await wiz.getByRole('radiogroup', { name: 'Build' }).getByRole('radio', { name: 'Athletic' }).click();
    await wiz.getByRole('radiogroup', { name: 'Height' }).getByRole('radio', { name: 'Tall' }).click();
    await wiz.getByRole('radiogroup', { name: 'Skin' }).getByRole('radio', { name: 'Olive' }).click();
    await expect(wiz.getByRole('radiogroup', { name: 'Style' }).getByRole('radio', { name: 'Anime' })).toBeChecked();
    await shot(page, 'create-2-look', testInfo.project.name);

    // 3 · face and hair, with own words and the marks box
    await wiz.getByRole('button', { name: 'Next: Face & hair' }).click();
    await expectStep(wiz, 'Face and hair');
    await wiz.getByRole('radiogroup', { name: 'Eyes' }).getByRole('radio', { name: 'Green' }).click();
    await wiz.getByRole('radiogroup', { name: 'Hair' }).getByRole('radio', { name: 'Own words' }).click();
    await wiz.getByRole('textbox', { name: 'Hair, in your own words' }).fill('Short silver hair with a fringe');
    await expect(wiz.getByRole('button', { name: 'Hold to talk: their distinguishing marks' })).toBeVisible();
    await wiz.getByRole('group', { name: 'Help with their distinguishing marks' }).getByRole('button', { name: 'Fill for me' }).click();
    await expect(wiz.getByRole('textbox', { name: 'Distinguishing marks' })).not.toHaveValue('');
    await shot(page, 'create-3-face-hair', testInfo.project.name);

    // 4 · outfit
    await wiz.getByRole('button', { name: 'Next: Outfit' }).click();
    await expectStep(wiz, 'What do they wear?');
    await wiz.getByRole('group', { name: 'Help with their outfit' }).getByRole('button', { name: 'Fill for me' }).click();
    await expect(wiz.getByRole('textbox', { name: 'Everyday outfit' })).not.toHaveValue('');
    await wiz.getByRole('button', { name: 'Add another outfit' }).click();
    await wiz.getByRole('textbox', { name: 'Another outfit 1' }).fill('A red silk shirt and black trousers');
    await shot(page, 'create-4-outfit', testInfo.project.name);

    // 5 · personality
    await wiz.getByRole('button', { name: 'Next: Personality' }).click();
    await expectStep(wiz, 'What are they like?');
    await wiz.getByRole('group', { name: 'Help with their personality' }).getByRole('button', { name: 'Fill for me' }).click();
    await expect(wiz.getByRole('textbox', { name: 'Personality notes' })).not.toHaveValue('');
    await shot(page, 'create-5-personality', testInfo.project.name);

    // 6 · the sheet: made on the machine, with progress, then accepted
    await wiz.getByRole('button', { name: 'Next: Reference sheet' }).click();
    await expectStep(wiz, 'Their reference sheet');
    await expect(wiz.getByText('Also make smiling, serious and other outfits', { exact: false })).toBeVisible();
    await shot(page, 'create-6-sheet-start', testInfo.project.name);
    await wiz.getByRole('button', { name: 'Make the reference sheet' }).click();
    const tiles = wiz.getByRole('list', { name: 'Reference sheet' });
    await expect(tiles.getByRole('listitem')).toHaveCount(8);
    expect(m.calls.find((c) => c.method === 'POST' && c.path === '/')?.body).toMatchObject({
      name: 'Mira Vale',
      age: '34',
      traits: { style: 'anime', gender: 'man', build: 'Athletic', height: 'Tall', skin: 'Olive', eyes: 'Green', hair: 'Short silver hair with a fringe' },
    });
    await expect(wiz.getByRole('status').filter({ hasText: /ready in about/ })).toBeVisible();
    await expect(wiz.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(tiles.getByText(/Making · 40%/)).toBeVisible({ timeout: 8000 });
    await shot(page, 'create-6-sheet-making', testInfo.project.name);
    await expect(wiz.getByRole('button', { name: 'Looks good' })).toBeVisible({ timeout: 15_000 });
    await expect(tiles.locator('img')).toHaveCount(8);
    await expect(tiles.getByText('Check this')).toHaveCount(1);
    await expect(wiz.getByRole('button', { name: 'Make the Back view again' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, 'create-6-sheet-done', testInfo.project.name);

    // Make one view again.
    await wiz.getByRole('button', { name: 'Make the Side view again' }).click();
    await expect.poll(() => m.calls.some((c) => c.method === 'POST' && c.path.endsWith('/sheet/side'))).toBe(true);
    await expect(wiz.getByRole('button', { name: 'Looks good' })).toBeVisible({ timeout: 15_000 });

    // 7 · save
    await wiz.getByRole('button', { name: 'Looks good' }).click();
    await expectStep(wiz, 'Save your character');
    await expect(wiz.getByText('Made-up adult · 34 · Anime')).toBeVisible();
    await shot(page, 'create-7-save', testInfo.project.name);
    await wiz.getByRole('button', { name: 'Save character' }).click();
    const grid = screen.getByRole('list', { name: 'Your characters' });
    await expect(grid.getByRole('button', { name: 'Mira Vale, 34' })).toBeVisible();
    await expect(grid.getByText('Unfinished')).toHaveCount(0);
    expect(m.calls.some((c) => c.method === 'POST' && c.path.endsWith('/accept'))).toBe(true);
    await expect(win.getByText('Mira Vale is saved.', { exact: false })).toBeVisible();
    await shot(page, 'library-saved', testInfo.project.name);
    expect(errors.filter((e) => !/status of (422|409)/.test(e))).toEqual([]);
  });

  test('the machine refuses what is not allowed, and it says why in plain words', async ({ page }) => {
    await mockAi(page, 'on');
    await mockStudio(page);
    await noSiteStorage(page);
    await mockCharacters(page, []);
    await openOrbit(page);
    const { screen } = await openCharacters(page);
    await screen.getByRole('button', { name: 'Create character' }).first().click();
    const wiz = screen.getByTestId('character-wizard');
    await wiz.getByRole('textbox', { name: 'Name' }).fill('Mira Vale');
    await wiz.getByRole('textbox', { name: 'Age' }).fill('34');
    await wiz.getByRole('button', { name: 'Next: Look' }).click();
    await wiz.getByRole('button', { name: 'Next: Face & hair' }).click();
    await wiz.getByRole('textbox', { name: 'Distinguishing marks' }).fill('looks like a famous actress');
    await expect(pane(wiz).getByRole('alert')).toContainText('never real or famous ones');
    await wiz.getByRole('textbox', { name: 'Distinguishing marks' }).fill('freckles');
    await expect(pane(wiz).getByRole('alert')).toHaveCount(0);
    // Nothing to make the sheet from yet: it says what is missing.
    await wiz.getByRole('button', { name: 'Next: Outfit' }).click();
    await wiz.getByRole('button', { name: 'Next: Personality' }).click();
    await wiz.getByRole('button', { name: 'Next: Reference sheet' }).click();
    await expect(wiz.getByRole('button', { name: 'Make the reference sheet' })).toBeDisabled();
    await expect(wiz.getByText('Say a little about how they look', { exact: false })).toBeVisible();
  });

  test('design a whole character from one line', async ({ page }) => {
    await mockAi(page, 'on');
    await mockStudio(page);
    await noSiteStorage(page);
    await mockCharacters(page, []);
    await openOrbit(page);
    const { screen } = await openCharacters(page);
    await screen.getByRole('button', { name: 'Create character' }).first().click();
    const wiz = screen.getByTestId('character-wizard');
    await expect(wiz.getByRole('button', { name: 'Design it for me' })).toBeDisabled();
    await wiz.getByRole('textbox', { name: 'A one-line idea' }).fill('a retired lighthouse keeper who restores old clocks, 63');
    await wiz.getByRole('button', { name: 'Design it for me' }).click();
    await expect(wiz.getByRole('textbox', { name: 'Name' })).not.toHaveValue('');
    await expect(wiz.getByRole('textbox', { name: 'Age' })).toHaveValue('63');
    await wiz.getByRole('button', { name: 'Next: Look' }).click();
    await expect(wiz.getByRole('radiogroup', { name: 'Build' }).getByRole('radio', { checked: true })).toHaveCount(1);
  });

  test('Add a character: chips with their face in Describe it, tap to attach and tap again to take off; the summary and the request carry it', async ({ page }, testInfo) => {
    await mockAi(page, 'on');
    const requests = await mockStudio(page);
    await noSiteStorage(page);
    await mockCharacters(page, [READY('r1', 'Mira Vale', 34, 1), READY('r2', 'Tomas Reyes', 41, 2), DRAFT('d1', 'Ines Okafor', 29, 3)]);
    await openOrbit(page);
    const win = await openMakeApp(page);
    await win.getByRole('radio', { name: /^A picture/ }).click();
    await expectStep(win, 'Who makes it');
    await win.getByRole('button', { name: 'Next: Describe it' }).click();
    await expectStep(win, 'Describe it');
    const group = win.getByRole('group', { name: 'Add a character' });
    await expect(group.getByRole('button')).toHaveCount(2);
    await expect.poll(() => group.locator('img').first().evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
    await expect(win.getByText('Photos you upload work as before; for adult results use a character.', { exact: false })).toBeVisible();
    await win.getByRole('textbox', { name: 'Describe it' }).fill('walking a dog in the park');
    const mira = group.getByRole('button', { name: 'Mira Vale' });
    await expect(mira).toHaveAttribute('aria-pressed', 'false');
    await mira.click();
    await expect(mira).toHaveAttribute('aria-pressed', 'true');
    await expectNoHorizontalOverflow(page);
    await shot(page, 'describe-chip', testInfo.project.name);
    await mira.click();
    await expect(mira).toHaveAttribute('aria-pressed', 'false');
    await group.getByRole('button', { name: 'Tomas Reyes' }).click();
    await expect(group.getByRole('button', { name: 'Tomas Reyes' })).toHaveAttribute('aria-pressed', 'true');
    await expect(mira).toHaveAttribute('aria-pressed', 'false');

    await win.getByRole('navigation', { name: 'Make, step by step' }).getByRole('button', { name: /: Check & make$/ }).click();
    await expectStep(win, 'Check, then make it');
    const summary = win.getByRole('list', { name: 'Your choices' });
    await expect(summary).toContainText('Tomas Reyes');
    await expect(summary.getByRole('button', { name: /^Character: Tomas Reyes/ })).toBeVisible();
    await shot(page, 'check-with-character', testInfo.project.name);
    await win.getByRole('button', { name: 'Make image' }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toMatchObject({ kind: 'image', prompt: 'walking a dog in the park', character: 'r2' });
    // A summary row goes back to the chips.
    await summary.getByRole('button', { name: /^Character:/ }).click();
    await expectStep(win, 'Describe it');
    await group.getByRole('button', { name: 'Tomas Reyes' }).click();
    await win.getByRole('navigation', { name: 'Make, step by step' }).getByRole('button', { name: /: Check & make$/ }).click();
    await win.getByRole('button', { name: 'Make image' }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].character).toBeUndefined();
  });

  test('with no characters the chip row offers to make one', async ({ page }) => {
    await mockAi(page, 'on');
    await mockStudio(page);
    await noSiteStorage(page);
    await mockCharacters(page, []);
    await openOrbit(page);
    const win = await openMakeApp(page);
    await win.getByRole('radio', { name: /^A picture/ }).click();
    await win.getByRole('button', { name: 'Next: Describe it' }).click();
    await expectStep(win, 'Describe it');
    await win.getByRole('button', { name: 'Make a character' }).click();
    await expect(win.getByRole('region', { name: 'Characters' })).toBeVisible();
  });

  test('Swap a person: pick one of your characters as the new person, beside the photo; never both', async ({ page }, testInfo) => {
    await mockAi(page, 'on');
    const requests = await mockStudio(page);
    await noSiteStorage(page);
    await mockCharacters(page, [READY('r1', 'Mira Vale', 34, 1), READY('r2', 'Tomas Reyes', 41, 2)]);
    await openOrbit(page);
    const win = await openMakeApp(page);
    await win.getByRole('radio', { name: /^Edit a video/ }).click();
    await win.getByRole('radiogroup', { name: 'Maker' }).getByRole('radio', { name: 'Swap a person' }).click();
    await expect(pane(win).getByRole('heading', { level: 3 })).toHaveText('The video');
    await page.locator('input[aria-label="Video file"]').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: MP4 });
    await expect(page.locator('video[aria-label="Video to work on"]')).toBeVisible();
    await win.getByRole('navigation', { name: 'Make, step by step' }).getByRole('button', { name: /: Who to replace$/ }).click();
    await expect(pane(win).getByRole('heading', { level: 3 })).toHaveText('Who to replace?');
    await win.getByRole('textbox', { name: 'Who to replace' }).fill('the man in the red jacket');
    await win.getByRole('navigation', { name: 'Make, step by step' }).getByRole('button', { name: /: The new person$/ }).click();
    await expect(pane(win).getByRole('heading', { level: 3 })).toHaveText('Who takes their place');
    const group = win.getByRole('group', { name: 'Pick one of your characters' });
    await expect(group.getByRole('button')).toHaveCount(2);
    await expect(pane(win).getByText('For adult results a character is needed', { exact: false })).toBeVisible();
    await expect(pane(win).getByText('Photos of real people work as before.', { exact: false })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, 'swap-pick-character', testInfo.project.name);
    // A photo first, then a character: the photo goes.
    await page.locator('input[aria-label="Photo of the new person"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: portrait(1) });
    await expect(page.getByRole('img', { name: 'The new person' })).toBeVisible();
    await group.getByRole('button', { name: 'Mira Vale' }).click();
    await expect(group.getByRole('button', { name: 'Mira Vale' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('img', { name: 'The new person' })).toHaveCount(0);
    // A character first, then a photo: the character goes.
    await page.locator('input[aria-label="Photo of the new person"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: portrait(2) });
    await expect(group.getByRole('button', { name: 'Mira Vale' })).toHaveAttribute('aria-pressed', 'false');
    await group.getByRole('button', { name: 'Mira Vale' }).click();

    await win.getByRole('navigation', { name: 'Make, step by step' }).getByRole('button', { name: /: Check & make$/ }).click();
    const summary = win.getByRole('list', { name: 'Your choices' });
    await expect(summary).toContainText('Mira Vale, a character');
    await shot(page, 'swap-check-character', testInfo.project.name);
    await win.getByRole('button', { name: 'Swap the person' }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toMatchObject({ kind: 'video', maker: 'person-swap', videoUpload: 'uvid1', target: 'the man in the red jacket', character: 'r1' });
    expect(requests[0].image).toBeUndefined();
    expect(requests[0].images).toBeUndefined();
  });

  test('an unfinished character continues where it was; a changed look asks for the sheet again', async ({ page }) => {
    await mockAi(page, 'on');
    await mockStudio(page);
    await noSiteStorage(page);
    const m = await mockCharacters(page, [READY('r1', 'Mira Vale', 34, 1), DRAFT('d1', 'Ines Okafor', 29, 3)]);
    await openOrbit(page);
    const { screen } = await openCharacters(page);
    const grid = screen.getByRole('list', { name: 'Your characters' });
    await grid.getByRole('button', { name: 'Ines Okafor, 29, unfinished' }).click();
    await page.getByRole('dialog', { name: 'Ines Okafor' }).getByRole('button', { name: 'Continue' }).click();
    const wiz = screen.getByTestId('character-wizard');
    await expect(screen.getByRole('heading', { name: 'Edit Ines Okafor' })).toBeVisible();
    await expectStep(wiz, 'Their reference sheet');
    await expect(wiz.getByRole('button', { name: 'Make the rest' })).toBeVisible();
    await expect(wiz.getByRole('list', { name: 'Reference sheet' }).getByRole('listitem')).toHaveCount(2);

    // Edit a ready character's hair: the old sheet no longer fits.
    await screen.getByRole('button', { name: 'Your characters' }).click();
    await grid.getByRole('button', { name: 'Mira Vale, 34' }).click();
    await page.getByRole('dialog', { name: 'Mira Vale' }).getByRole('button', { name: 'Edit' }).click();
    await wiz.getByRole('navigation', { name: 'Make a character, step by step' }).getByRole('button', { name: /: Face & hair$/ }).click();
    await wiz.getByRole('radiogroup', { name: 'Hair' }).getByRole('radio', { name: 'Own words' }).click();
    await wiz.getByRole('textbox', { name: 'Hair, in your own words' }).fill('Cropped grey hair');
    await wiz.getByRole('navigation', { name: 'Make a character, step by step' }).getByRole('button', { name: /: Reference sheet$/ }).click();
    await wiz.getByRole('button', { name: 'Make the sheet again' }).click();
    expect(m.calls.some((c) => c.method === 'PUT' && c.path === '/r1')).toBe(true);
    await expect.poll(() => m.calls.some((c) => c.method === 'POST' && c.path === '/r1/sheet' && c.body?.redo === true)).toBe(true);
    await expect(wiz.getByRole('button', { name: 'Looks good' })).toBeVisible({ timeout: 15_000 });
  });
});
