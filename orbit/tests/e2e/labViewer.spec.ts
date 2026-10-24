import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, openApp } from './helpers';
import { mockAi, setShowNsfw } from './aiMocks';

// The owner's complaint: in the Lab, pressing play or holding a blurred video left the video controls
// over the picture for seconds (the first seconds looked dark), while Make played at once. The Lab
// now uses the same player as every gallery: it starts at once, nothing sits over it while it plays
// or while held, and a swipe goes to the next one.

const labRecord = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, title, prompt: `${title} prompt`, caption: `${title} caption`, hashtags: ['#fyp'], seconds: 30, movieId: `mv-${id}`,
  createdAt: '2026-10-21T10:00:00Z', url: `/_orbit/studio/file/${id}?t=tok`, score: null, why: '', status: 'judged', ...extra,
});
const LAB = {
  enabled: true, style: 'spicy', topics: [], quietMinutes: 0, readyScore: 75, minutesPerVideo: 34, minutesLeft: 50, madeLastHour: 1, lastError: null,
  making: null, queue: [],
  records: [
    labRecord('clear1', 'Rooftop glance', { style: 'spicy', score: 91, status: 'ready' }),
    labRecord('hot1', 'Pool night', { style: 'spicy', score: 70, nsfw: true }),
    labRecord('wait1', 'Gym crush energy', { style: 'spicy', status: 'made' }),
  ],
};

test('Lab viewer plays like Make: at once, nothing over the picture while it plays or is held, swipe to the next', async ({ page }) => {
  await mockAi(page, 'on');
  await page.route('**/fake-ai/_orbit/studio/lab**', (route) => route.fulfill({ json: LAB }));
  await page.route('**/fake-ai/_orbit/studio/file/**', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'video/mp4' }, body: '' }));
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, introSeen: true } }, version: 0 }));
    // play() and pause() that report like a real video (the test files are not real videos).
    const w = window as unknown as { plays: number };
    w.plays = 0;
    const paused = new WeakMap<HTMLMediaElement, boolean>();
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return paused.get(this) ?? true; } });
    HTMLMediaElement.prototype.play = function () {
      w.plays++;
      paused.set(this, false);
      this.dispatchEvent(new Event('play'));
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      if (paused.get(this) === false) {
        paused.set(this, true);
        this.dispatchEvent(new Event('pause'));
      }
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const plays = () => page.evaluate(() => (window as unknown as { plays: number }).plays);
  await page.goto('/');
  const win = await openApp(page, 'lab');
  await setShowNsfw(page, true);
  const gallery = win.getByRole('list', { name: 'Lab movies, best first' });
  await expect(gallery.getByRole('listitem')).toHaveCount(3);

  // A clear one: it plays the moment the viewer opens, with no browser controls and nothing over it.
  await gallery.getByRole('button', { name: 'Video: Rooftop glance' }).click();
  const viewer = page.getByRole('dialog', { name: 'Lab movie' });
  const player = viewer.locator('.ai-player');
  await expect(player).toHaveAttribute('data-playing', '');
  expect(await plays()).toBeGreaterThan(0);
  await expect(viewer.locator('video')).not.toHaveAttribute('controls', /.*/);
  await expect(player).not.toHaveAttribute('data-chrome', /.*/);
  expect(await viewer.locator('.ai-player-bar').evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await expect(viewer.getByRole('button', { name: 'Play video' })).toHaveCount(0);
  // Pause and play again: the play button is gone the moment it plays.
  await viewer.locator('video').click();
  await expect(viewer.getByRole('button', { name: 'Play video' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Play video' }).click();
  await expect(player).toHaveAttribute('data-playing', '');
  await expect(player).not.toHaveAttribute('data-chrome', /.*/);
  await expect(viewer.getByText('1 of 3')).toBeVisible();

  // Swipe to the next: the NSFW one, blurred, and it does not start by itself.
  const before = await plays();
  const sb = (await viewer.locator('.ai-viewer-stage').boundingBox())!;
  await page.mouse.move(sb.x + sb.width * 0.85, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width * 0.5, sb.y + sb.height / 2, { steps: 4 });
  await page.mouse.move(sb.x + sb.width * 0.1, sb.y + sb.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(viewer).toContainText('Pool night');
  await expect(viewer.getByText('2 of 3')).toBeVisible();
  const media = viewer.locator('.ai-viewer-media.censor');
  await expect(media).toBeVisible();
  await expect(viewer.locator('.ai-player')).not.toHaveAttribute('data-playing', /.*/);
  expect(await plays()).toBe(before);
  // Held: it plays at once and nothing is drawn over it; let go: it pauses and blurs again.
  const mb = (await media.boundingBox())!;
  await page.mouse.move(mb.x + mb.width / 2, mb.y + Math.min(mb.height / 2, 120));
  await page.mouse.down();
  await expect(media).toHaveAttribute('data-revealed', '');
  await expect(viewer.locator('.ai-player')).toHaveAttribute('data-playing', '');
  expect(await viewer.locator('.ai-player').evaluate((el) => getComputedStyle(el).filter)).toBe('none');
  await expect(viewer.getByRole('button', { name: 'Play video' })).toHaveCount(0);
  expect(await viewer.locator('.ai-player-bar').evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await expect(viewer.locator('video')).not.toHaveAttribute('controls', /.*/);
  await page.mouse.up();
  await expect(media).not.toHaveAttribute('data-revealed', '');
  await expect(viewer.locator('.ai-player')).not.toHaveAttribute('data-playing', /.*/);
  // The arrows go back and forth too.
  await viewer.getByRole('button', { name: 'Next' }).click();
  await expect(viewer).toContainText('Gym crush energy');
  await expect(viewer.getByRole('button', { name: 'Next' })).toBeDisabled();
  await viewer.getByRole('button', { name: 'Previous' }).click();
  await expect(viewer).toContainText('Pool night');
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
