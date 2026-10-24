import { expect, test, type Page } from '@playwright/test';

/**
 * The orb on a walkthrough (shell/orb/assist.ts), on a test page with three steps that register the
 * way the Make walkthrough does: a box of several lines, a group of choices, a one-line box.
 */

const PICTURES = [
  'A lighthouse on black cliffs in a storm, one warm window glowing',
  'A fox asleep in fresh snow at dawn, soft pink light',
  'A neon noodle stall in the rain at night, steam rising',
  'A koi pond from above, orange fish under lily pads',
];
const NAMES = ['Storm Light', 'Snow Fox', 'Night Noodles', 'Koi Pond'];

/** Cloud AI, mocked: ideas by number, a pick, and the next few words. */
async function mockCloud(page: Page, opts: { configured?: boolean; pick?: string } = {}) {
  const asked: string[] = [];
  await page.route('**/api/orb/ai', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { configured: opts.configured ?? true, models: {} } });
    const body = route.request().postDataJSON() as { messages: { content: string }[] };
    const system = body.messages[0].content;
    const user = body.messages[body.messages.length - 1].content;
    asked.push(user);
    let text = '';
    if (system.includes('one idea for the text box')) {
      const n = Number(user.match(/Idea number (\d+)/)?.[1] ?? 1) - 1;
      text = (user.includes('Name it') ? NAMES : PICTURES)[n % 4];
    } else if (system.includes('choose for the person')) text = opts.pick ?? '3';
    else if (system.includes('next few words')) text = ' with glowing lanterns';
    return route.fulfill({ json: { choices: [{ message: { content: text } }] } });
  });
  return asked;
}

async function openHarness(page: Page, settings: Record<string, unknown> = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((s) => {
    localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { motion: 'full', motionPicked: true, introSeen: true, ...s } }, version: 0 }));
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
  }, settings);
  await page.goto('/tests/harness/orb-assist.html');
  if (settings.orb !== false) await expect(page.getByRole('button', { name: /^Orb:/ })).toBeVisible();
  return errors;
}

type Box = { left: number; top: number; right: number; bottom: number };

async function orbBox(page: Page): Promise<Box & { x: number; y: number }> {
  return page.locator('.orb-cursor').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

/** The part of a box the words are in (inside its padding). */
async function textArea(page: Page, selector: string): Promise<Box> {
  return page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const px = (v: string) => parseFloat(v) || 0;
    return { left: r.left + px(s.paddingLeft), top: r.top + px(s.paddingTop), right: r.right - px(s.paddingRight), bottom: r.bottom - px(s.paddingBottom) };
  });
}

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

async function settled(page: Page) {
  let prev = await orbBox(page);
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(80);
    const now = await orbBox(page);
    if (Math.hypot(now.x - prev.x, now.y - prev.y) < 0.5) return now;
    prev = now;
  }
  return prev;
}

/** Where the orb was, every frame, for `ms`. */
async function orbPath(page: Page, ms: number) {
  return page.evaluate(
    (ms) =>
      new Promise<{ x: number; y: number; left: number; top: number; right: number; bottom: number }[]>((resolve) => {
        const out: { x: number; y: number; left: number; top: number; right: number; bottom: number }[] = [];
        const el = document.querySelector('.orb-cursor')!;
        const t0 = performance.now();
        const step = () => {
          const r = el.getBoundingClientRect();
          out.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
          if (performance.now() - t0 < ms) requestAnimationFrame(step);
          else resolve(out);
        };
        requestAnimationFrame(step);
      }),
    ms,
  );
}

async function tapOrb(page: Page) {
  const at = await settled(page);
  await page.mouse.click(at.x, at.y);
}

test.describe('the orb on a walkthrough step', () => {
  test('it sits beside the text box, never over it; tapping in offers an idea, and each tap a new one', async ({ page }) => {
    await mockCloud(page);
    const errors = await openHarness(page);
    const box = page.getByRole('textbox', { name: 'Describe it' });
    await expect(box).toBeVisible();
    await settled(page);
    expect(overlap(await orbBox(page), await textArea(page, 'textarea'))).toBe(0);

    await box.click();
    const ghost = page.locator('.oa-ghost');
    await expect(ghost).toHaveText(PICTURES[0]);
    // While it offers it travels round the box, and never over the words.
    const inner = await textArea(page, 'textarea');
    const path = await orbPath(page, 1500);
    expect(Math.max(...path.map((p) => overlap(p, inner)))).toBeLessThan(1);
    const travelled = path.reduce((d, p, i) => (i ? d + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) : 0), 0);
    expect(travelled).toBeGreaterThan(40);
    // The box's own hint steps aside.
    await expect(box).toHaveAttribute('data-orb-offer', 'append');

    // The more you tap, the more the idea changes.
    await box.click();
    await expect(ghost).toHaveText(PICTURES[1]);
    await box.click({ position: { x: 20, y: 120 } });
    await expect(ghost).toHaveText(PICTURES[2]);

    // Tap the words to take them.
    await ghost.click();
    await expect(box).toHaveValue(PICTURES[2]);
    await expect(ghost).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('typing: the offer steps aside and the usual ghost text finishes the sentence', async ({ page }) => {
    await mockCloud(page);
    const errors = await openHarness(page);
    const box = page.getByRole('textbox', { name: 'Describe it' });
    await box.click();
    await expect(page.locator('.oa-ghost')).toBeVisible();
    await box.pressSequentially('a castle on a hill', { delay: 15 });
    await expect(page.locator('.oa-ghost')).toHaveCount(0);
    await expect(page.locator('.wh-ghost')).toHaveText(/glowing lanterns/);
    // Now it is the text cursor again.
    await expect(page.locator('.orb-layer')).toHaveAttribute('data-caret', 'true');
    expect(errors).toEqual([]);
  });

  test('tap the orb and it writes an idea in for you', async ({ page }) => {
    await mockCloud(page);
    await openHarness(page);
    const box = page.getByRole('textbox', { name: 'Describe it' });
    await expect(box).toBeVisible();
    await tapOrb(page);
    await expect(box).toHaveValue(PICTURES[0]);
    // Say (or type) "write it for me" to the orb: the next idea.
    const at = await settled(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    const panel = page.getByRole('dialog', { name: 'Ask the orb' });
    await expect(panel.getByRole('button', { name: 'Write it for me' })).toBeVisible();
    await panel.getByRole('textbox', { name: 'Tell the orb what to do' }).fill('another idea please');
    await panel.getByRole('button', { name: 'Go' }).click();
    await expect(box).toHaveValue(PICTURES[1]);
  });

  test('a one-line box: the orb rides its edge, sliding over the words it offers', async ({ page }) => {
    await mockCloud(page);
    const errors = await openHarness(page);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('radio', { name: 'Film photo' }).click();
    const box = page.getByRole('textbox', { name: 'Name it' });
    await expect(box).toBeVisible();
    await box.click();
    await expect(page.locator('.oa-ghost')).toHaveText(NAMES[0]);
    const inner = await textArea(page, 'input');
    const path = await orbPath(page, 2200);
    expect(Math.max(...path.map((p) => overlap(p, inner)))).toBeLessThan(1);
    const xs = path.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(20);
    // Tap the orb to take them.
    await page.mouse.click(path[path.length - 1].x, path[path.length - 1].y);
    await expect(box).toHaveValue(NAMES[0]);
    expect(errors).toEqual([]);
  });

  test('approve: the orb flies to what you picked, a ring of light goes round it, then it lands beside the next step', async ({ page }) => {
    await mockCloud(page);
    const errors = await openHarness(page);
    await page.getByRole('button', { name: 'Next' }).click();
    const pick = page.getByRole('radio', { name: 'Neon glow' });
    await expect(pick).toBeVisible();
    await settled(page);
    const r = await pick.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { right: b.right, top: b.top };
    });
    const pathP = orbPath(page, 2600);
    await pick.click();
    await expect(page.locator('.orb-fx-ring')).toHaveCount(1);
    const path = await pathP;
    // It went to the pick's corner…
    const nearest = Math.min(...path.map((p) => Math.hypot(p.x - (r.right - 6), p.y - (r.top + 6))));
    expect(nearest).toBeLessThan(24);
    // …and came back to sit beside the next step's box, not over it.
    const box = page.getByRole('textbox', { name: 'Name it' });
    await expect(box).toBeVisible();
    const end = await settled(page);
    expect(Math.hypot(end.x - (r.right - 6), end.y - (r.top + 6))).toBeGreaterThan(40);
    expect(overlap(end, await textArea(page, 'input'))).toBe(0);
    const b = await box.boundingBox();
    expect(Math.hypot(end.x - (b!.x + b!.width / 2), end.y - (b!.y + b!.height / 2))).toBeLessThan(Math.max(b!.width, 200));
    expect(errors).toEqual([]);
  });

  test('choose for me: tap the orb on a choice step and it picks, approves and moves on', async ({ page }) => {
    const asked = await mockCloud(page, { pick: '3' });
    const errors = await openHarness(page);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('radio', { name: 'Paper cut' })).toBeVisible();
    await tapOrb(page);
    await expect(page.getByRole('textbox', { name: 'Name it' })).toBeVisible({ timeout: 8000 });
    expect(asked.some((q) => q.includes('Options:') && q.includes('3. Paper cut'))).toBe(true);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByTestId('summary')).toContainText('Paper cut');
    expect(errors).toEqual([]);
  });

  test('"choose for me", said to the orb, works on a choice step too', async ({ page }) => {
    await mockCloud(page, { pick: '2' });
    await openHarness(page);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('radio', { name: 'Film photo' })).toBeVisible();
    const at = await settled(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    const panel = page.getByRole('dialog', { name: 'Ask the orb' });
    await expect(panel.getByRole('button', { name: 'Choose for me' })).toBeVisible();
    await panel.getByRole('textbox', { name: 'Tell the orb what to do' }).fill('you choose for me');
    await panel.getByRole('button', { name: 'Go' }).click();
    await expect(page.getByRole('textbox', { name: 'Name it' })).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByTestId('summary')).toContainText('Film photo');
  });

  test('without cloud AI it still offers written ideas, different each tap, and says nothing alarming', async ({ page }) => {
    await mockCloud(page, { configured: false });
    const errors = await openHarness(page);
    const box = page.getByRole('textbox', { name: 'Describe it' });
    await box.click();
    const ghost = page.locator('.oa-ghost');
    await expect(ghost).toHaveText(/\w{3,}.{20,}/);
    const first = await ghost.textContent();
    await box.click();
    await expect(ghost).not.toHaveText(first!);
    await expect(page.locator('.orb-caption, .toast')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Motion off: the idea still shows, but the orb stays put; approving does not hold the step up', async ({ page }) => {
    await mockCloud(page);
    await openHarness(page, { motion: 'reduce' });
    const box = page.getByRole('textbox', { name: 'Describe it' });
    await box.click();
    await expect(page.locator('.oa-ghost')).toHaveText(PICTURES[0]);
    const path = await orbPath(page, 600);
    expect(Math.max(...path.map((p) => p.x)) - Math.min(...path.map((p) => p.x))).toBeLessThan(2);
    expect(overlap(path[path.length - 1], await textArea(page, 'textarea'))).toBe(0);
    await page.getByRole('button', { name: 'Next' }).click();
    const t0 = Date.now();
    await page.getByRole('radio', { name: 'Dark brush' }).click();
    await expect(page.getByRole('textbox', { name: 'Name it' })).toBeVisible();
    expect(Date.now() - t0).toBeLessThan(1500);
    await expect(page.locator('.orb-fx-ring')).toHaveCount(0);
  });

  test('with the orb off, "Fill for me" still gets an idea and picking moves on at once', async ({ page }) => {
    await mockCloud(page);
    const errors = await openHarness(page, { orb: false });
    await expect(page.locator('.orb-cursor')).toHaveCount(0);
    const box = page.getByRole('textbox', { name: 'Describe it' });
    await page.getByRole('button', { name: 'Fill for me' }).click();
    await expect(box).toHaveValue(PICTURES[0]);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('radio', { name: 'Paper cut' }).click();
    await expect(page.getByRole('textbox', { name: 'Name it' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
