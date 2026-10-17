import { expect, type Page } from '@playwright/test';

/** Mocks of the site's AI endpoints and the AI machine, shared by the AI test files. */
export const MODELS = ['qwen3.6:35b', 'qwen3.8-obliterated:27b', 'qwen3.8:27b'];
export const LONG_LINE = `const data = [${Array.from({ length: 60 }, (_, i) => `"item-${i}"`).join(', ')}];`;
export const REPLY = `Here is the answer.\n\n\`\`\`js\n${LONG_LINE}\nconsole.log(data.length);\n\`\`\`\n\nDone.`;

export function sse(text: string) {
  const parts = text.match(/[\s\S]{1,24}/g) ?? [];
  return (
    [
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'Thinking about it.' } }] })}`,
      ...parts.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}`),
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 80 } })}`,
      'data: [DONE]',
    ].join('\n\n') + '\n\n'
  );
}

export const TIERS = [
  { id: 'standard', label: 'Standard', gpuName: 'A40 48 GB', pricePerHour: 0.59, idleMinutes: 30, speed: 'normal speed' },
  { id: 'turbo', label: 'Turbo', gpuName: 'H100 80 GB', pricePerHour: 3.99, idleMinutes: 10, speed: 'about 4–6× faster' },
];

export const INSTALLED = [
  { name: 'qwen3.6:35b', size: 22.6e9, loaded: false, vision: true, tools: true, thinking: true, family: 'qwen35moe', params: '35.5B', quant: 'Q4_K_M' },
  { name: 'qwen3.8-obliterated:27b', size: 23.4e9, loaded: false, vision: true, tools: true, thinking: true, family: 'qwen35', params: '27.3B', quant: 'Q6_K' },
  { name: 'qwen3.8:27b', size: 17.7e9, loaded: true, vision: true, tools: true, thinking: true, family: 'qwen35', params: '27.3B', quant: 'Q4_K_M' },
];

/** The AI machine's model store, with installs that take three seconds. */
export async function mockStore(page: Page) {
  const installed = INSTALLED.map((m) => ({ ...m }));
  const pulls: { name: string; status: string; percent: number; error: null; done: boolean; at: number }[] = [];
  const calls: { path: string; body?: unknown }[] = [];
  const featured = [
    { spec: 'qwen3.8:27b', title: 'Qwen 3.8 27B', blurb: 'Best all-rounder.', tags: ['general'], size: 17.7e9 },
    { spec: 'defiant-fable:9b=hf.co/x/y:Q6_K', title: 'Defiant Fable 9B', blurb: 'Small, fast storyteller.', tags: ['uncensored', 'fast'], size: 9.5e9 },
  ];
  const nameOf = (spec: string) => spec.split('=')[0];
  await page.route('**/fake-ai/_orbit/models**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/_orbit\/models/, '');
    const body = req.method() === 'POST' ? req.postDataJSON() : undefined;
    calls.push({ path: `${req.method()} ${path}${url.search}`, body });
    if (req.method() === 'GET' && path === '') {
      for (const p of pulls) {
        p.percent = Math.min(100, Math.floor(((Date.now() - p.at) / 3000) * 100));
        if (p.percent >= 100 && !installed.some((m) => m.name === p.name)) {
          installed.push({ ...INSTALLED[0], name: p.name, loaded: false, size: 9.5e9 });
        }
      }
      const live = pulls.filter((p) => p.percent < 100);
      pulls.splice(0, pulls.length, ...live);
      return route.fulfill({
        json: { installed, pulls: pulls.map(({ at: _, ...p }) => p), disk: { total: 150e9, free: 15e9 } },
      });
    }
    if (path === '/featured') {
      return route.fulfill({ json: { models: featured.map((m) => ({ ...m, name: nameOf(m.spec), installed: installed.some((i) => i.name === nameOf(m.spec)) })) } });
    }
    if (path === '/search') return route.fulfill({ json: { results: [{ repo: 'org/Cool-Model-GGUF', downloads: 12000, likes: 300, updatedAt: null }] } });
    if (path === '/files') {
      return route.fulfill({
        json: { files: [{ quant: 'Q4_K_M', file: 'a.gguf', size: 9e9 }, { quant: 'Q8_0', file: 'b.gguf', size: 16e9 }] },
      });
    }
    if (path === '/install') {
      const b = body as { spec?: string; repo?: string; quant?: string };
      const name = b.spec ? nameOf(b.spec) : `cool-model:${b.quant!.toLowerCase()}`;
      pulls.push({ name, status: 'pulling', percent: 0, error: null, done: false, at: Date.now() });
      return route.fulfill({ status: 202, json: { name } });
    }
    if (path === '/load' || path === '/dismiss') return route.fulfill({ json: { ok: true } });
    if (req.method() === 'DELETE') {
      const name = decodeURIComponent(path.slice(1));
      installed.splice(installed.findIndex((m) => m.name === name), 1);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: { error: 'nope' } });
  });
  return calls;
}

export async function mockAi(page: Page, initial: 'off' | 'on', powerCalls: Record<string, unknown>[] = []) {
  let state: string = initial;
  let tier = 'standard';
  await page.route('**/api/ai', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { tier?: string };
      powerCalls.push(body);
      state = 'on';
      tier = body.tier ?? tier;
    }
    await route.fulfill({
      json: {
        state,
        costPerHour: state === 'on' ? TIERS.find((t) => t.id === tier)!.pricePerHour : null,
        models: state === 'on' ? MODELS : [],
        idle: state === 'on' ? { limitMinutes: 30, idleMinutes: 0 } : null,
        tier,
        tiers: TIERS,
      },
    });
  });
  await page.route('**/api/ai/token', (route) =>
    route.fulfill({ json: { url: new URL('/fake-ai', page.url()).href, token: 'test', expiresIn: 3600 } }),
  );
  await page.route('**/fake-ai/v1/models', (route) => route.fulfill({ json: { data: MODELS.map((id) => ({ id })) } }));
  await page.route('**/fake-ai/v1/chat/completions', (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(REPLY) }),
  );
  return mockStore(page);
}

export async function openAi(page: Page) {
  // After a reload Orbit reopens the app that was open.
  const win = page.locator('.app-window[data-app="ai"]');
  const icon = page.getByRole('button', { name: /^AI\./ });
  await expect(win.or(icon).first()).toBeVisible();
  if (!(await win.isVisible())) await icon.click();
  await expect(win.locator('.ai-composer')).toBeVisible();
  await expect(page.locator('.app-window[data-app="ai"]')).toBeVisible();
}

/** Every visible button in the AI window is on screen and at least `min` px tall and wide. */
export async function expectTappable(page: Page, min = 44) {
  const boxes = await page.locator('.app-window[data-app="ai"] button:visible').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label') || el.textContent?.trim() || '?', x: r.x, right: r.right, w: r.width, h: r.height };
    }),
  );
  const vw = page.viewportSize()!.width;
  for (const b of boxes) {
    expect(b.x, `${b.name} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(b.right, `${b.name} ends on screen`).toBeLessThanOrEqual(vw + 1);
    expect(Math.min(b.w, b.h), `${b.name} is big enough to tap`).toBeGreaterThanOrEqual(min);
  }
}

/** Every chat request the AI machine received, as JSON. */
export async function recordChats(page: Page, reply = REPLY) {
  const bodies: { model: string; messages: { role: string; content: unknown }[] }[] = [];
  await page.route('**/fake-ai/v1/chat/completions', (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(reply) });
  });
  return bodies;
}

export async function sendText(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message' }).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.ai-msg-assistant').last()).toContainText('Done.');
}

