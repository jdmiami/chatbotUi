import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

export default defineConfig({
  root: 'example',
  plugins: [react()],
  resolve: { alias: { 'orbit-design': fileURLToPath(new URL('./src', import.meta.url)) } },
  // node_modules may be a symlink (it is in this package's own checkout): let Vite serve the real folder too.
  server: { port: 5300, fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), realpathSync(fileURLToPath(new URL('./node_modules', import.meta.url)))] } },
  build: { outDir: '../dist', emptyOutDir: true },
});
