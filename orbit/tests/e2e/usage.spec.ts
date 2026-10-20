import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, launchFromHome, openOrbit } from './helpers';

/** Settings → Usage: what the old status pill showed (money, machines, timers), with /api/status mocked. */

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
          { id: 'turbo', label: 'Turbo', gpuName: 'H100 80 GB', pricePerHour: 2.89 },
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

test.describe('Settings: usage', () => {
  test('no pill at the top; money, machines and timers are in Settings → Usage, with the switches', async ({ page }) => {
    const { calls } = await mockStatus(page);
    const errors = await openOrbit(page);
    await expect(page.locator('orbit-island')).toHaveCount(0);
    await launchFromHome(page, 'Settings');
    const win = page.locator('.app-window[data-app="settings"]');
    const usage = win.getByRole('region', { name: 'Usage' });
    await usage.scrollIntoViewIfNeeded();
    const money = usage.getByLabel('Money');
    await expect(money).toContainText('$41.20');
    await expect(money).toContainText('$0.840/h');
    await expect(money).toContainText('$2.75');
    const ai = usage.getByLabel('AI machine', { exact: true });
    await expect(ai).toContainText('$0.59/h');
    await expect(ai).toContainText('on for 1 h 2 min');
    await expect(ai).toContainText(/turns itself off in 2[45] min if unused/);
    await expect(ai.getByRole('meter', { name: 'AI machine GPU', exact: true })).toBeVisible();
    await ai.getByRole('button', { name: 'Keep on 30 more min' }).click();
    await expect(ai).toContainText(/turns itself off in 5[45] min/);
    const linux = usage.getByLabel('Linux machine', { exact: true });
    await linux.getByRole('button', { name: 'Turn off' }).click();
    // Asks first: it ends the terminals.
    await linux.getByRole('button', { name: 'Tap again: ends terminals' }).click();
    await expect(linux.getByRole('button', { name: 'Turn on' })).toBeVisible();
    expect(calls).toEqual([
      { machine: 'ai', action: 'extend', minutes: 30 },
      { machine: 'linux', action: 'stop', minutes: 30 },
    ]);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('without the site behind Orbit it says where the numbers come from', async ({ page }) => {
    await page.route('**/api/status**', (route) => route.fulfill({ status: 404, body: 'nope' }));
    const errors = await openOrbit(page);
    await launchFromHome(page, 'Settings');
    const usage = page.locator('.app-window[data-app="settings"]').getByRole('region', { name: 'Usage' });
    await expect(usage).toContainText('when Orbit is opened from your workspace site');
    expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
  });
});
