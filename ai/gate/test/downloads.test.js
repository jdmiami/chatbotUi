import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStudio } from '../src/studio.js';

// The built-in image maker's files come down first; one of them is missing here.
const FILES = {
  image: [
    { dir: 'diffusion_models', name: 'img.safetensors', repo: 'o/r', path: 'img.safetensors', size: 8 },
    { dir: 'text_encoders', name: 'te.safetensors', repo: 'o/r', path: 'te.safetensors', size: 4 },
  ],
  video: [{ dir: 'checkpoints', name: 'vid.safetensors', repo: 'o/r', path: 'vid.safetensors', size: 4 }],
};
const quiet = { warn() {}, info() {} };
const bigDisk = async () => ({ bavail: 1e6, bsize: 1024 ** 2 });

async function place(dir, file) {
  const p = path.join(dir, 'models', file.dir, file.name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, Buffer.alloc(file.size));
}
async function dirWithout(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-'));
  for (const f of [...FILES.image, ...FILES.video]) if (f.name !== name) await place(dir, f);
  return dir;
}
const services = (u) => (u.pathname === '/api/ps' ? Response.json({ models: [] }) : Response.json({}));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('downloads: a connection that stops sending is cut and the file picks up where it was', async () => {
  const dir = await dirWithout('img.safetensors');
  const ranges = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname !== 'huggingface.co') return services(u);
    const range = init.headers?.range ?? null;
    ranges.push(range);
    if (!range) {
      // Half the file, then silence (until the watchdog cuts it).
      const body = new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([1, 2, 3, 4]));
          init.signal?.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-length': '8' } });
    }
    assert.equal(range, 'bytes=4-');
    return new Response(new Uint8Array([5, 6, 7, 8]), { status: 206 });
  };
  const studio = createStudio({ dir, files: FILES, fetchImpl, WebSocketImpl: null, log: quiet, retryMs: 10, stallDownloadMs: 80, statfs: bigDisk, nsfwDelayMs: 1e9 });
  studio.start();
  await until(async () => (await studio.makers()).find((m) => m.id === 'qwen')?.installed);
  assert.deepEqual(ranges, [null, 'bytes=4-']);
  assert.deepEqual([...(await fs.readFile(path.join(dir, 'models', 'diffusion_models', 'img.safetensors')))], [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('downloads: a full disk says so (and the number stops for a reason you can read)', async () => {
  const dir = await dirWithout('img.safetensors');
  let asked = 0;
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'huggingface.co') asked++;
    return services(u);
  };
  const studio = createStudio({ dir, files: FILES, fetchImpl, WebSocketImpl: null, log: quiet, retryMs: 10, statfs: async () => ({ bavail: 1, bsize: 1024 }), nsfwDelayMs: 1e9 });
  studio.start();
  await until(async () => (await studio.makers()).find((m) => m.id === 'qwen')?.status === 'disk');
  const qwen = (await studio.makers()).find((m) => m.id === 'qwen');
  assert.match(qwen.problem, /Not enough disk space for img\.safetensors \(0 GB free, needs about 3 GB\)/);
  assert.equal(asked, 0, 'nothing is fetched that cannot fit');
});

test('downloads: adding a maker that cannot fit is refused up front, with how much it needs', async () => {
  const dir = await dirWithout('none');
  const studio = createStudio({ dir, files: FILES, fetchImpl: async (url) => services(new URL(url)), WebSocketImpl: null, log: quiet, statfs: async () => ({ bavail: 10 * 1024, bsize: 1024 ** 2 }), nsfwDelayMs: 1e9 });
  // H3 Max is about 52 GB; 10 GB are free.
  await assert.rejects(studio.installMaker('h3-max'), (err) => err.status === 507 && /Not enough disk space for H3 Max: needs about \d+ GB, 10 GB free/.test(err.message));
  assert.equal((await studio.makers()).find((m) => m.id === 'h3-max').wanted, false);
});
