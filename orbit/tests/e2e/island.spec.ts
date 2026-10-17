import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, openOrbit } from './helpers';

/** The glass status pill and task manager (public/island.js) inside Orbit, with /api/status mocked. */

function status(over: Record<string, unknown> = {}) {
  const offAt = new Date(Date.now() + 24 * 60_000 + 10_000).toISOString();
  return {
    at: new Date().toISOString(),
    canPower: true,
    money: { balance: 41.2, spendPerHour: 0.84, today: 2.75, spendLimit: 80 },
    machines: [
      {
        id: 'ai',
        name: 'AI machine',
        state: 'on',
        costPerHour: 0.59,
        uptimeSeconds: 3725,
        offAt,
        autoOff: true,
        tier: 'standard',
        tiers: [
          { id: 'standard', label: 'Standard', gpuName: 'A40 48 GB', pricePerHour: 0.59 },
          { id: 'turbo', label: 'Turbo', gpuName: 'H100 80 GB', pricePerHour: 3.99 },
        ],
        gpuName: 'A40 48 GB',
        live: { cpu: 12, memory: 30, gpu: 64, gpuMemory: 48 },
        stats: {
          cpu: { percent: 14.5, cores: 9 },
          memory: { used: 18e9, total: 50e9 },
          disks: [{ label: 'Saved storage', path: '/workspace', total: 150e9, free: 15e9 }],
          network: { rxPerSec: 2.5e6, txPerSec: 4e5 },
          processes: [
            { name: 'AI chat model', cpu: 9.5, memory: 2.1e9, count: 1 },
            { name: 'AI playground (Open WebUI)', cpu: 1.2, memory: 9e8, count: 3 },
          ],
          gpus: [{ name: 'NVIDIA A40', percent: 64, memoryUsed: 23e9, memoryTotal: 48e9, temperature: 55, watts: 180 }],
          users: [
            { kind: 'model', name: 'qwen3.8:27b', label: 'Chat model: qwen3.8:27b', memory: 20e9 },
            { kind: 'studio', name: 'studio', label: 'Image & video maker', memory: 3e9 },
          ],
          idle: { limitMinutes: 30, offAt },
        },
      },
      {
        id: 'linux',
        name: 'Linux machine',
        state: 'on',
        costPerHour: 0.24,
        uptimeSeconds: 86000,
        offAt: null,
        autoOff: false,
        live: { cpu: 3, memory: 22, gpu: null, gpuMemory: null },
        stats: {
          cpu: { percent: 3.1, cores: 4 },
          memory: { used: 4e9, total: 16e9 },
          disks: [{ label: 'Saved storage', path: '/workspace', total: 50e9, free: 31e9 }],
          network: { rxPerSec: 1e4, txPerSec: 2e3 },
          processes: [{ name: 'VS Code (code-server)', cpu: 1.5, memory: 6e8, count: 4 }],
        },
      },
    ],
    ...over,
  };
}

async function mockStatus(page: Page, calls: Record<string, unknown>[] = []) {
  let current = status();
  await page.route('**/api/status**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as Record<string, unknown>;
      calls.push(body);
      if (body.action === 'extend') {
        const m = current.machines[0] as { offAt: string };
        m.offAt = new Date(new Date(m.offAt).getTime() + 30 * 60_000).toISOString();
      }
      if (body.action === 'stop') (current.machines[1] as { state: string }).state = 'off';
    }
    await route.fulfill({ json: current });
  });
  return { calls, set: (s: ReturnType<typeof status>) => (current = s) };
}

const pill = (page: Page) => page.locator('orbit-island').getByRole('button', { name: /Open money and machines/ });

test.describe('glass status pill', () => {
  test('shows money, the AI countdown and machine dots; Orbit makes room for it', async ({ page }) => {
    await mockStatus(page);
    const errors = await openOrbit(page);
    await expect(pill(page)).toBeVisible();
    await expect(pill(page)).toContainText('$41.20');
    await expect(pill(page)).toHaveAccessibleName(/AI machine On, turns off in 2\d:\d\d/);
    await expect(page.locator('.shell')).toHaveAttribute('data-island', 'true');
    // The home screen starts below the pill.
    const pillBox = await pill(page).boundingBox();
    const topbar = await page.locator('.shell-topbar').boundingBox();
    expect(topbar!.y).toBeGreaterThanOrEqual(pillBox!.y + pillBox!.height - 1);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('opens into the task manager: money, timers, graphs, what is using the GPU; safe actions', async ({ page }, testInfo) => {
    const { calls } = await mockStatus(page);
    await openOrbit(page);
    await pill(page).click();
    const panel = page.locator('orbit-island').getByRole('dialog', { name: 'Money and machines' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Runpod balance');
    await expect(panel).toContainText('$0.84/h');
    await expect(panel).toContainText('Spent today');
    await expect(panel).toContainText('$2.75');
    await expect(panel).toContainText('Lasts about');
    await expect(panel).toContainText('Chat model: qwen3.8:27b');
    await expect(panel).toContainText('Image & video maker');
    await expect(panel).toContainText('23.0 GB / 48.0 GB');
    await expect(panel).toContainText('Always on');
    await expect(panel).toContainText('VS Code (code-server) (4)');
    await expect(panel.getByRole('timer')).toBeVisible();
    // The panel fits the screen.
    const box = await panel.boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
    await page.screenshot({ path: testInfo.outputPath('island-open.png') });

    await panel.getByRole('button', { name: '+30 min' }).click();
    await expect.poll(() => calls.find((c) => c.action === 'extend')).toEqual({ machine: 'ai', action: 'extend', minutes: 30 });
    await panel.getByRole('button', { name: 'Unload' }).click();
    await expect.poll(() => calls.find((c) => c.action === 'unload')).toEqual({ machine: 'ai', action: 'unload', model: 'qwen3.8:27b' });

    // Turning off asks twice.
    const off = panel.getByRole('button', { name: 'Turn off' }).nth(1);
    await off.click();
    await expect(panel.getByRole('button', { name: 'Tap again to turn off' })).toBeVisible();
    expect(calls.some((c) => c.action === 'stop')).toBe(false);
    await panel.getByRole('button', { name: 'Tap again to turn off' }).click();
    await expect.poll(() => calls.find((c) => c.action === 'stop')).toEqual({ machine: 'linux', action: 'stop' });

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('hides itself, and Orbit takes no room for it, when there is no site behind Orbit', async ({ page }) => {
    await page.route('**/api/status**', (route) => route.fulfill({ status: 404, body: 'not here' }));
    await openOrbit(page);
    await page.waitForTimeout(500);
    await expect(page.locator('orbit-island')).toBeHidden();
    await expect(page.locator('.shell')).toHaveAttribute('data-island', 'false');
  });
});
