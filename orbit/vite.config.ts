/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The end-to-end tests also build a few test pages (tests/harness); the real site never has them.
const harness = process.env.ORBIT_HARNESS === '1';
const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Served at /orbit/ by the web app; '/' for local dev and tests.
  base: process.env.ORBIT_BASE || '/',
  plugins: [react()],
  build: {
    target: 'safari16',
    chunkSizeWarningLimit: 1500,
    rollupOptions: harness ? { input: { main: at('./index.html'), orbAssist: at('./tests/harness/orb-assist.html') } } : undefined,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/unit/setup.ts'],
  },
});
