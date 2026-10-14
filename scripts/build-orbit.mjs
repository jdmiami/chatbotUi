// Builds the Orbit workspace (orbit/) into public/orbit so the web app serves it at /orbit,
// behind the same login (proxy.ts protects every path except /login and Next's own assets).
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
const cwd = new URL('../orbit/', import.meta.url).pathname;

if (!existsSync(`${cwd}node_modules`)) run('npm ci --no-audit --no-fund', { cwd });
run('npx tsc --noEmit', { cwd });
rmSync(new URL('../public/orbit', import.meta.url).pathname, { recursive: true, force: true });
run('npx vite build --outDir ../public/orbit --emptyOutDir', { cwd, env: { ...process.env, ORBIT_BASE: '/orbit/' } });
