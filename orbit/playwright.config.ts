import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Emulated-device interaction tests (Chromium). These approximate iPhone/iPad viewports, touch and
 * mobile UA; they are NOT Safari/WebKit. Real Safari behaviour must be checked on the devices.
 */
const sandboxChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = process.env.PW_CHROMIUM_PATH || (existsSync(sandboxChromium) ? sandboxChromium : undefined);
const port = Number(process.env.ORBIT_E2E_PORT || 4173);

const chromiumWith = (device: (typeof devices)[string]) => ({
  ...device,
  // Device descriptors for iPhone/iPad default to WebKit; force Chromium (the only engine here).
  browserName: 'chromium' as const,
  defaultBrowserType: 'chromium' as const,
  launchOptions: executablePath ? { executablePath } : {},
});

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  timeout: 45_000,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'iphone-portrait', use: chromiumWith(devices['iPhone 14 Pro Max']) },
    { name: 'iphone-landscape', use: chromiumWith(devices['iPhone 14 Pro Max landscape']) },
    { name: 'ipad-portrait', use: chromiumWith(devices['iPad Pro 11']) },
    { name: 'ipad-landscape', use: chromiumWith(devices['iPad Pro 11 landscape']) },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
