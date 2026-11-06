import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Flipbook as its own site (flipbook-site/): the same app as in Orbit, built on its own, with its
 * own page, icons, web manifest and offline worker. `npm run build:flipbook` → dist-flipbook/.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./flipbook-site', import.meta.url)),
  base: process.env.FLIPBOOK_BASE || '/',
  plugins: [react()],
  build: {
    target: 'safari16',
    outDir: fileURLToPath(new URL('./dist-flipbook', import.meta.url)),
    emptyOutDir: true,
  },
});
