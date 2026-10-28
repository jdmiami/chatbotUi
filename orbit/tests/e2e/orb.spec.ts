import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, openApp, expectValue } from './helpers';
import { aiMenu, mockAi } from './aiMocks';

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
    await openApp(page, 'settings');
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

  test('with the AI machine off, cloud AI plans what simple commands cannot', async ({ page }) => {
    const sent: string[] = [];
    await page.route('**/api/orb/ai', async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { configured: true, models: { agent: ['test'] } } });
      const body = route.request().postDataJSON() as { task: string; messages: { content: string }[] };
      sent.push(body.task, body.messages.map((m) => m.content).join('\n'));
      const step = sent.length > 2 ? { do: 'done', say: 'Settings are open.' } : { do: 'open', app: 'settings' };
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(step) } }] })}\n\ndata: [DONE]\n\n`;
      return route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-orb-model': 'test' }, body: sse });
    });
    const { errors } = await openWithOrb(page);
    const at = await settled(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    const panel = page.getByRole('dialog', { name: 'Ask the orb' });
    await panel.getByRole('textbox', { name: 'Tell the orb what to do' }).fill('I want to change how things look');
    await panel.getByRole('button', { name: 'Go' }).click();
    await expect(page.locator('.app-window[data-app="settings"]')).toBeVisible();
    await expect(panel).toContainText('Settings are open.');
    expect(sent[0]).toBe('agent');
    expect(sent[1]).toContain('Goal: I want to change how things look');
    expect(errors).toEqual([]);
  });

  test('cloud AI can be switched off in Settings; it says what is sent', async ({ page }) => {
    await page.route('**/api/orb/ai', (route) => route.fulfill({ json: { configured: true, models: {} } }));
    await openWithOrb(page);
    await openApp(page, 'settings');
    const status = page.getByTestId('cloud-ai-status');
    await status.scrollIntoViewIfNeeded();
    await expect(status).toContainText('Ready');
    await expect(page.getByText(/Never passwords/)).toBeVisible();
    await page.getByRole('switch', { name: 'Use cloud AI' }).click({ force: true });
    await expect(status).toContainText('Off');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit:shell:v1') ?? '{}').state.settings.cloudAi);
    expect(saved).toBe(false);
  });

  test('writing help: grey ghost text finishes the sentence, and selected words can be rewritten', async ({ page }) => {
    const rewrites: string[] = [];
    await page.route('**/api/orb/ai', async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { configured: true, models: {} } });
      const body = route.request().postDataJSON() as { task: string; messages: { content: string }[] };
      const ghost = body.messages[0].content.includes('next few words');
      if (!ghost) rewrites.push(body.task);
      const text = ghost ? ' milk and eggs' : 'Please remind me to buy milk and eggs tomorrow.';
      return route.fulfill({ json: { choices: [{ message: { content: text } }] } });
    });
    const { errors } = await openWithOrb(page);
    const at = await settled(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    const box = page.getByRole('dialog', { name: 'Ask the orb' }).getByRole('textbox', { name: 'Tell the orb what to do' });
    await box.click();
    await box.pressSequentially('remind me to buy', { delay: 20 });
    const ghost = page.locator('.wh-ghost');
    await expect(ghost).toHaveText(/milk and eggs/);
    await box.press('Tab');
    await expectValue(box, 'remind me to buy milk and eggs');
    await expect(ghost).toHaveCount(0);

    await box.selectText();
    await page.getByRole('button', { name: /Rewrite/ }).click();
    await page.getByRole('menuitem', { name: 'Fix' }).click();
    await expectValue(box, 'Please remind me to buy milk and eggs tomorrow.');
    // Rewrite is unfiltered writing: it does what you ask with your words (adults only, said on the site).
    expect(rewrites).toEqual(['free']);
    expect(errors).toEqual([]);
  });

  test('explain this screen: it reads what is shown and answers in plain words', async ({ page }) => {
    const asked: { task: string; text: string }[] = [];
    await page.route('**/api/orb/ai', async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { configured: true, models: {} } });
      const body = route.request().postDataJSON() as { task: string; messages: { content: unknown }[] };
      asked.push({ task: body.task, text: JSON.stringify(body.messages) });
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: 'This is your Orbit home: each line opens an app.' } }] })}\n\ndata: [DONE]\n\n`;
      return route.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: sse });
    });
    const { errors } = await openWithOrb(page);
    const at = await settled(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    const panel = page.getByRole('dialog', { name: 'Ask the orb' });
    await panel.getByRole('button', { name: 'Explain this screen' }).click();
    await expect(panel.getByRole('list', { name: 'What happened' })).toContainText('each line opens an app');
    expect(asked).toHaveLength(1);
    expect(asked[0].text).toContain('Text on screen');
    // What the home path shows: its greeting and where you are.
    expect(asked[0].text).toMatch(/Good (morning|afternoon|evening|night)\./);
    expect(asked[0].text).toContain('demo workspace');
    expect(errors).toEqual([]);
  });

  test('find across my stuff: it lists matching chats to open, and "bring me" drops one into the box I was in', async ({ page }) => {
    await mockAi(page, 'off');
    await page.addInitScript(() => {
      const now = Date.now();
      const chat = (id: string, title: string, answer: string) => ({
        id, title, model: 'm', createdAt: now, updatedAt: now,
        messages: [{ role: 'user', content: title }, { role: 'assistant', content: answer }],
      });
      localStorage.setItem('orbit:ai:v1', JSON.stringify({
        version: 1, activeId: null, model: 'm',
        chats: [chat('c1', 'Paris trip plan', 'Day 1: the Louvre. Day 2: Montmartre.'), chat('c2', 'Groceries', 'Milk, eggs, bread.')],
      }));
    });
    const { errors } = await openWithOrb(page);
    const ask = async (goal: string) => {
      await page.keyboard.press('Control+Shift+Space');
      const panel = page.getByRole('dialog', { name: 'Ask the orb' });
      await panel.getByRole('textbox', { name: 'Tell the orb what to do' }).fill(goal);
      await panel.getByRole('button', { name: 'Go' }).click();
      return panel;
    };
    const panel = await ask('find my chat about Paris');
    const found = panel.getByRole('list', { name: 'Found' });
    await expect(found).toContainText('Paris trip plan');
    await expect(found).not.toContainText('Groceries');
    await found.getByRole('button', { name: /Paris trip plan/ }).click();
    const win = page.locator('.app-window[data-app="ai"]');
    await expect(win).toBeVisible();
    await expect(win).toContainText('Montmartre');

    // Bring: into the message box I was typing in.
    await aiMenu(page, 'New conversation');
    const box = win.getByRole('textbox', { name: 'Message' });
    await box.click();
    await ask('bring me the paris plan');
    await expectValue(box, /Louvre.*Montmartre/);
    expect(errors).toEqual([]);
  });

  test('a face: it appears when needed (sleepy with no AI), cheers when done, and hides at rest', async ({ page }) => {
    const { errors } = await openWithOrb(page);
    const layer = page.locator('.orb-layer');
    await expect(layer).toHaveAttribute('data-face', 'off');
    await page.keyboard.press('Control+Shift+Space');
    // No cloud AI and the AI machine off in this preview: sleepy.
    await expect(layer).toHaveAttribute('data-face', 'sleepy');
    const panel = page.getByRole('dialog', { name: 'Ask the orb' });
    await panel.getByRole('textbox', { name: 'Tell the orb what to do' }).fill('light mode');
    await panel.getByRole('button', { name: 'Go' }).click();
    await expect(layer).toHaveAttribute('data-face', 'done');
    const gpu = page.locator('.orb-cursor canvas.ai-orb-gpu[data-live]');
    if (await gpu.count()) await expect(gpu).toHaveAttribute('data-face', 'on');
    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(layer).toHaveAttribute('data-face', /off|speaking|done/);
    await expect(layer).toHaveAttribute('data-face', 'off', { timeout: 6000 });
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
      // Only actions count (Orbit also reads the status on its own, for the turn-off warning).
      if (route.request().method() === 'POST') calls.push(route.request().postDataJSON());
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
    // A quick, decisive throw to the left (well past the middle even on a wide screen). The events carry
    // their own times, 12 ms apart, so the throw is as fast however busy the machine running the test is.
    const cdp = await page.context().newCDPSession(page);
    const t0 = Date.now() / 1000;
    const send = (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', i: number) =>
      cdp.send('Input.dispatchMouseEvent', {
        type,
        x: start.x - i * 60,
        y: start.y - i * 12,
        button: 'left',
        buttons: type === 'mouseReleased' ? 0 : 1,
        clickCount: type === 'mouseMoved' ? 0 : 1,
        timestamp: t0 + i * 0.012,
      });
    await send('mousePressed', 0);
    for (let i = 1; i <= 8; i++) await send('mouseMoved', i);
    await send('mouseReleased', 8);
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
    await openApp(page, 'ai');
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

  test('it glides from where it is into the caret, round until it lands, and back', async ({ page }) => {
    await mockAi(page, 'off');
    const { errors } = await openWithOrb(page);
    await openApp(page, 'ai');
    const box = page.locator('.app-window[data-app="ai"]').getByRole('textbox', { name: 'Message' });
    await expect(box).toBeVisible();
    await settled(page);
    // Every frame: where the orb is and how wide.
    const record = () =>
      page.evaluate(() => {
        const w = window as unknown as { trail: { x: number; y: number; w: number }[]; stop: boolean };
        w.trail = [];
        w.stop = false;
        const step = () => {
          const r = document.querySelector('.orb-cursor')!.getBoundingClientRect();
          w.trail.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width });
          if (!w.stop) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    const trail = async () => {
      await page.waitForTimeout(1600);
      return page.evaluate(() => {
        const w = window as unknown as { trail: { x: number; y: number; w: number }[]; stop: boolean };
        w.stop = true;
        return w.trail;
      });
    };
    await record();
    await box.click();
    const there = await trail();
    const start = there[0];
    const end = there[there.length - 1];
    expect(end.w).toBeLessThan(8);
    // It travelled (many frames in between), not a jump...
    const moving = there.filter((p) => Math.hypot(p.x - start.x, p.y - start.y) > 4 && Math.hypot(p.x - end.x, p.y - end.y) > 4);
    expect(moving.length).toBeGreaterThan(5);
    // ...staying a ball for the first part of the trip, narrowing only as it lands.
    const trip = Math.hypot(end.x - start.x, end.y - start.y);
    for (const p of there) if (Math.hypot(p.x - end.x, p.y - end.y) > trip * 0.6) expect(p.w).toBeGreaterThan(40);

    // Leaving the box: it rounds out first, then drifts home.
    await record();
    await box.evaluate((el) => (el as HTMLElement).blur());
    const back = await trail();
    const from = back[0];
    expect(back[back.length - 1].w).toBeGreaterThan(40);
    const firstMove = back.findIndex((p) => Math.hypot(p.x - from.x, p.y - from.y) > 6);
    if (firstMove > 0) expect(back[firstMove].w).toBeGreaterThan(30);
    expect(errors).toEqual([]);
  });

  test('in Code and Terminal too: the orb takes the place of their own cursor', async ({ page }) => {
    const { errors } = await openWithOrb(page);
    await openApp(page, 'editor');
    const editor = page.locator('.app-window[data-app="editor"] .cm-content');
    await editor.click();
    await expect(page.locator('.orb-layer')).toHaveAttribute('data-caret', 'true');
    await expect(page.locator('.app-window[data-app="editor"] .cm-cursorLayer')).toHaveCSS('visibility', 'hidden');
    await page.keyboard.type('abc');
    await expect.poll(async () => (await page.locator('.orb-cursor').boundingBox())!.width).toBeLessThan(8);
    // On the editor's own cursor.
    const cur = (await page.locator('.app-window[data-app="editor"] .cm-cursor-primary').boundingBox())!;
    await expect.poll(async () => {
      const o = (await page.locator('.orb-cursor').boundingBox())!;
      return Math.abs(o.x + o.width / 2 - cur.x) + Math.abs(o.y + o.height / 2 - (cur.y + cur.height / 2));
    }).toBeLessThan(6);

    await page.goto('/');
    await openApp(page, 'terminal');
    const term = page.locator('.app-window[data-app="terminal"] .xterm');
    await expect(term).toBeVisible();
    await term.click();
    await expect(page.locator('.orb-layer')).toHaveAttribute('data-caret', 'true');
    await page.keyboard.type('echo hi');
    // On the terminal's cursor cell, which moves as you type.
    const cell = async () => (await page.locator('.app-window[data-app="terminal"] .xterm-helper-textarea').boundingBox())!;
    await expect.poll(async () => {
      const o = (await page.locator('.orb-cursor').boundingBox())!;
      const c = await cell();
      return Math.abs(o.x + o.width / 2 - (c.x + 1.25)) + Math.abs(o.y + o.height / 2 - (c.y + c.height / 2));
    }).toBeLessThan(6);
    expect(errors).toEqual([]);
  });

  test('one orb: the AI has no orb of its own, the orb rests on its face, grown', async ({ page }) => {
    await mockAi(page, 'off');
    const { errors } = await openWithOrb(page);
    await openApp(page, 'ai');
    const spot = page.locator('.app-window[data-app="ai"] .ai-hello-spot');
    await expect(spot).toBeVisible();
    // Only one orb on the screen: the orb itself.
    await expect(page.locator('.ai-orb')).toHaveCount(1);
    await expect(page.locator('.orb-cursor .ai-orb')).toHaveCount(1);
    // On a short screen the face may be scrolled away (then the orb rests elsewhere): bring it into view.
    await spot.scrollIntoViewIfNeeded();
    // (The screen may still be settling in: measure the spot each time, not once.)
    await expect.poll(async () => {
      const s = (await spot.boundingBox())!;
      const o = (await page.locator('.orb-cursor').boundingBox())!;
      return Math.abs(o.x + o.width / 2 - (s.x + s.width / 2)) + Math.abs(o.y + o.height / 2 - (s.y + s.height / 2));
    }, { timeout: 8000 }).toBeLessThan(4);
    await expect.poll(async () => (await page.locator('.orb-cursor').boundingBox())!.width).toBeGreaterThan(70);
    expect(errors).toEqual([]);
  });

  test('on a stage (the voice orb) it shows through the dialog, grows, and taps go to the stage', async ({ page }) => {
    const { errors } = await openWithOrb(page);
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.setAttribute('role', 'dialog');
      d.setAttribute('aria-modal', 'true');
      d.innerHTML = '<button type="button" data-orb-spot="stage" data-orb-size="180" aria-label="Voice orb" style="position:fixed;left:60px;top:160px;width:180px;height:180px;border:0;background:none"></button>';
      // Where the real one lives: inside Orbit, under the orb.
      document.querySelector('.shell')!.append(d);
      const w = window as unknown as { taps: number };
      w.taps = 0;
      d.querySelector('button')!.addEventListener('click', () => w.taps++);
    });
    await expect.poll(async () => {
      const o = (await page.locator('.orb-cursor').boundingBox())!;
      return Math.abs(o.x + o.width / 2 - 150) + Math.abs(o.y + o.height / 2 - 250);
    }, { timeout: 8000 }).toBeLessThan(4);
    await expect.poll(async () => (await page.locator('.orb-cursor').boundingBox())!.width).toBeGreaterThan(170);
    // (Inside a modal dialog only the dialog is in the accessibility tree; the orb is found by its look.)
    const ball = page.locator('.orb-cursor');
    await expect(ball).toBeVisible();
    await ball.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { taps: number }).taps)).toBe(1);
    // Off the stage it goes back to a cursor's size.
    await page.evaluate(() => document.querySelector('[data-orb-spot="stage"]')!.closest('[role="dialog"]')!.remove());
    await expect.poll(async () => (await page.locator('.orb-cursor').boundingBox())!.width, { timeout: 8000 }).toBeLessThan(60);
    expect(errors).toEqual([]);
  });

  test('as a cursor: what it passes over lights up, and setting it down there presses it', async ({ page }) => {
    const { errors } = await openWithOrb(page, { orbFollow: false });
    const start = await settled(page);
    // The Begin link on the home path.
    const begin = page.getByRole('button', { name: 'Begin' });
    const r = (await begin.boundingBox())!;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 12 });
    await expect(begin).toHaveAttribute('data-orb-hover', '');
    await page.waitForTimeout(350);
    await page.mouse.up();
    // Pressed: the path scrolls on to its first chapter.
    await expect(page.getByRole('heading', { name: 'Continue' })).toBeInViewport();
    await expect(page.locator('[data-orb-hover]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('as a cursor: set down on a text box, you type right where it landed', async ({ page }) => {
    await mockAi(page, 'off');
    const { errors } = await openWithOrb(page, { orbFollow: false });
    await openApp(page, 'ai');
    const box = page.locator('.app-window[data-app="ai"]').getByRole('textbox', { name: 'Message' });
    await box.fill('hello world');
    await box.evaluate((el) => (el as HTMLElement).blur());
    // Leaving the box brings the machine banner back after a quiet moment: let the page settle.
    await page.waitForTimeout(1300);
    const start = await settled(page);
    const b = (await box.boundingBox())!;
    // Just inside the start of the text, on its first line (a narrow box wraps it).
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(b.x + 14, b.y + 18, { steps: 14 });
    await page.waitForTimeout(350);
    await page.mouse.up();
    await expect(box).toBeFocused();
    await expect(page.locator('.orb-layer')).toHaveAttribute('data-caret', 'true');
    // The caret landed near the start (a textarea's selectionStart; a plain box's selection offset).
    expect(await box.evaluate((el) => (el as HTMLTextAreaElement).selectionStart ?? window.getSelection()?.anchorOffset ?? 99)).toBeLessThan(3);
    await page.keyboard.type('>');
    await expectValue(box, /^.{0,2}>/);
    expect(errors).toEqual([]);
  });

  test('pinch it: stretched it zooms in, then bounces back to its own size', async ({ page }) => {
    const { errors } = await openWithOrb(page, { orbFollow: false });
    const c = await settled(page);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number; id: number }[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    const f1 = { x: Math.round(c.x), y: Math.round(c.y), id: 0 };
    await touch('touchStart', [f1]);
    await touch('touchStart', [f1, { x: f1.x - 60, y: f1.y, id: 1 }]);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [f1, { x: f1.x - 60 - i * 18, y: f1.y - i * 6, id: 1 }]);
    // Stretched while the fingers spread.
    expect((await page.locator('.orb-cursor').boundingBox())!.width).toBeGreaterThan(80);
    await touch('touchEnd', [f1]);
    await touch('touchEnd', []);
    // Text is bigger now, and the orb springs back to its size.
    await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--text-scale')))).toBeGreaterThan(1.05);
    await expect.poll(async () => Math.abs((await page.locator('.orb-cursor').boundingBox())!.width - 56), { timeout: 6000 }).toBeLessThan(3);
    expect(errors).toEqual([]);
  });
});
