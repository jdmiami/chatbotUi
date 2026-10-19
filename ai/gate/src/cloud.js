// The AI machine without a network volume: its disk is wiped every time it stops, so everything worth
// keeping lives in Cloudflare R2 and comes back down at start.
//
//   ollama/<path>        chat models (Ollama's blobs and manifests, file for file)
//   models/<dir>/<name>  image and video model files (studio.js)
//   gallery/<path>       pictures, videos and their notes (studio.js)
//   state/*.json         makers, timings
//   state/open-webui.tar the playground's chats and settings (a consistent snapshot)
//   env/studio-*.tar     the image and video maker's Python environment (ai/studio.sh)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { downloadFile, uploadFile, uploadStream } from './r2.js';

/** Every file under `root` as [{ rel, abs, size }] (forward slashes in rel). */
export async function walk(root, skip = () => false) {
  const out = [];
  async function go(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (skip(rel, e)) continue;
      if (e.isDirectory()) await go(abs);
      else if (e.isFile()) out.push({ rel, abs, size: (await fsp.stat(abs)).size });
    }
  }
  await go(root);
  return out;
}

/**
 * Keeps a folder of write-once files (Ollama's models) in R2. `first` orders transfers so that what
 * points at other files (manifests) always travels after what it points at (blobs).
 */
export function createDirSync({ r2, root, prefix, skip = () => false, first = () => 0, log = console }) {
  let restored = false;
  let running = null;
  const order = (a, b) => first(a.rel) - first(b.rel);
  const localPath = (rel) => path.join(root, ...rel.split('/'));

  async function restore(onProgress = () => {}) {
    const remote = (await r2.list(prefix)).map((o) => ({ rel: o.key.slice(prefix.length), key: o.key, size: o.size })).filter((o) => o.rel && !skip(o.rel));
    const todo = [];
    for (const o of remote) if ((await fsp.stat(localPath(o.rel)).catch(() => null))?.size !== o.size) todo.push(o);
    todo.sort(order);
    const total = todo.reduce((n, o) => n + o.size, 0);
    let completed = 0;
    for (const o of todo) {
      const abs = localPath(o.rel);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      const part = `${abs}.r2part`;
      if (o.size === 0) await fsp.writeFile(part, '');
      else await downloadFile(r2, o.key, part, { onBytes: (n) => onProgress({ completed: (completed += n), total }) });
      await fsp.rename(part, abs);
    }
    restored = true;
    if (todo.length) log.info?.(`[r2] restored ${todo.length} files (${Math.round(total / 1e9)} GB) into ${root}`);
    return { files: todo.length, bytes: total };
  }

  async function backupOnce() {
    const remote = new Map((await r2.list(prefix)).map((o) => [o.key, o.size]));
    const local = (await walk(root, (rel) => skip(rel))).filter((f) => remote.get(prefix + f.rel) !== f.size).sort(order);
    for (const f of local) {
      if (f.size > 256 * 1024 * 1024) await uploadFile(r2, f.abs, prefix + f.rel);
      else await r2.put(prefix + f.rel, await fsp.readFile(f.abs));
    }
    if (local.length) log.info?.(`[r2] saved ${local.length} files from ${root}`);
    return local.length;
  }

  return {
    restore,
    restored: () => restored,
    /** Upload what R2 doesn't have yet (one run at a time; a second call waits for the first). */
    backup() {
      // Saving before the restore finished could only add what R2 already has, but never hurts.
      const next = (running || Promise.resolve()).then(backupOnce, backupOnce);
      const mine = next.finally(() => {
        if (running === mine) running = null;
      });
      running = mine;
      return mine;
    },
    /** Delete from R2 what was deleted here (only once everything was restored, or it would delete it all). */
    async prune() {
      if (!restored) return 0;
      const have = new Set((await walk(root, (rel) => skip(rel))).map((f) => prefix + f.rel));
      const gone = (await r2.list(prefix)).filter((o) => !have.has(o.key) && !skip(o.key.slice(prefix.length)));
      // Manifests go first, so R2 never holds a manifest without its blobs.
      gone.sort((a, b) => first(b.key.slice(prefix.length)) - first(a.key.slice(prefix.length)));
      for (const o of gone) await r2.remove(o.key);
      return gone.length;
    },
    busy: () => Boolean(running),
  };
}

/** Ollama's folder: blobs (content-addressed, never change) then manifests (small, point at blobs). */
export function createOllamaSync({ r2, dir, log }) {
  return createDirSync({
    r2,
    root: dir,
    prefix: 'ollama/',
    log,
    // Half-finished pulls and our own half-finished restores.
    skip: (rel) => /-partial(-\d+)?$|\.r2part$/.test(rel),
    first: (rel) => (rel.startsWith('blobs/') ? 0 : 1),
  });
}

function run(cmd, args, { input, timeoutMs = 30 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', reject);
    p.on('close', (code) => {
      clearTimeout(t);
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.trim().slice(-300)}`));
    });
    if (input) p.stdin.end(input);
  });
}

// Copies the playground's folder, using SQLite's backup for databases so a chat being written right
// now can't leave a half-written file in the snapshot. Skips caches (they rebuild themselves).
const SNAPSHOT_PY = `
import os, shutil, sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
for base, dirs, files in os.walk(src):
    rel = os.path.relpath(base, src)
    dirs[:] = [d for d in dirs if not (rel == 'data' and d == 'cache')]
    os.makedirs(os.path.join(dst, rel), exist_ok=True)
    for f in files:
        a, b = os.path.join(base, f), os.path.join(dst, rel, f)
        if f.endswith(('-wal', '-shm', '-journal')):
            continue
        with open(a, 'rb') as h:
            head = h.read(16)
        if head == b'SQLite format 3\\x00':
            s, d = sqlite3.connect(a), sqlite3.connect(b)
            s.backup(d)
            d.close(); s.close()
        else:
            shutil.copy2(a, b)
`;

/**
 * The playground's chats and settings ($P/open-webui): a snapshot every few minutes when something
 * changed, and one more before the machine turns itself off. ai/setup.sh restores it at start.
 */
export function createWebuiBackup({ r2, dir, key = 'state/open-webui.tar', tmp = '/tmp/orbit-webui-snapshot', log = console }) {
  let lastSig = null;
  let running = null;

  async function signature() {
    const files = await walk(dir, (rel) => rel === 'data/cache' || rel.startsWith('data/cache/'));
    let latest = 0;
    let bytes = 0;
    for (const f of files) {
      bytes += f.size;
      latest = Math.max(latest, (await fsp.stat(f.abs)).mtimeMs);
    }
    return `${files.length}:${bytes}:${latest}`;
  }

  async function snapshotOnce(force) {
    if (!fs.existsSync(path.join(dir, 'data'))) return false;
    const sig = await signature();
    if (!force && sig === lastSig) return false;
    await fsp.rm(tmp, { recursive: true, force: true });
    await run('python3', ['-c', SNAPSHOT_PY, dir, tmp]);
    const tar = spawn('tar', ['-c', '-C', tmp, '.'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const done = new Promise((resolve, reject) => tar.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`tar exited ${c}`)))));
    await uploadStream(r2, tar.stdout, key, { ready: () => done });
    await fsp.rm(tmp, { recursive: true, force: true });
    lastSig = sig;
    log.info?.('[r2] saved the playground (chats and settings)');
    return true;
  }

  const snapshot = (force = false) => {
    const next = (running || Promise.resolve()).then(() => snapshotOnce(force), () => snapshotOnce(force));
    const mine = next.finally(() => {
      if (running === mine) running = null;
    });
    running = mine;
    return mine;
  };

  return {
    snapshot,
    /** Check every `everyMs`; the first check only records what was restored, so it isn't uploaded straight back. */
    start(everyMs = 5 * 60_000) {
      void signature().then((s) => (lastSig = s), () => {});
      const t = setInterval(() => void snapshot().catch((err) => log.warn?.(`[r2] could not save the playground: ${err.message}`)), everyMs);
      t.unref?.();
    },
    busy: () => Boolean(running),
  };
}
