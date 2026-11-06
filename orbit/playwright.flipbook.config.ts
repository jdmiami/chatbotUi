import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/** Flipbook's own site (flipbook-site/), on the same emulated devices as Orbit's tests (Chromium, not Safari). */
const sandboxChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = process.env.PW_CHROMIUM_PATH || (existsSync(sandboxChromium) ? sandboxChromium : undefined);
const port = Number(process.env.FLIPBOOK_E2E_PORT || 4180);
const on = (device: (typeof devices)[string]) => ({
  ...device,
  // Drawn in software here: plain sharpness keeps each frame of the bending paper cheap.
  deviceScaleFactor: 1,
  browserName: 'chromium' as const,
  defaultBrowserType: 'chromium' as const,
  // The bending paper needs WebGL2: in a machine without a graphics chip, Chromium draws it in software.
  launchOptions: { ...(executablePath ? { executablePath } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
});

export default defineConfig({
  testDir: 'tests/flipbook-site',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  timeout: 45_000,
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure', contextOptions: { reducedMotion: 'reduce' } },
  projects: [
    { name: 'iphone-portrait', use: on(devices['iPhone 14 Pro Max']) },
    { name: 'ipad-portrait', use: on(devices['iPad Pro 11']) },
    { name: 'ipad-landscape', use: on(devices['iPad Pro 11 landscape']) },
  ],
  webServer: {
    command: `npx vite build --config vite.flipbook.config.ts && npx vite preview --config vite.flipbook.config.ts --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
