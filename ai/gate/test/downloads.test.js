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

test('downloads: a stopped maker resumes when it is added again (Resume)', async () => {
  const dir = await dirWithout('img.safetensors');
  let free = 1; // the disk is full at first, so the download gives up on the file
  let asked = 0;
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.hostname !== 'huggingface.co') return services(u);
    asked++;
    return new Response(new Uint8Array(8), { status: 200, headers: { 'content-length': '8' } });
  };
  const studio = createStudio({ dir, files: FILES, fetchImpl, WebSocketImpl: null, log: quiet, retryMs: 10, statfs: async () => ({ bavail: free, bsize: 1024 ** 3 }), nsfwDelayMs: 1e9 });
  studio.start();
  await until(async () => (await studio.makers()).find((m) => m.id === 'qwen')?.status === 'disk');
  assert.equal(asked, 0);
  // Room was made (a maker removed, a bigger disk): Resume picks it up again.
  free = 100;
  await studio.installMaker('qwen');
  await until(async () => (await studio.makers()).find((m) => m.id === 'qwen')?.installed);
  assert.equal(asked, 1);
});


test('downloads: resuming counts only what is left of a file half-way down', async () => {
  const { FILES: ALL, MAKERS } = await import('../src/workflows.js');
  const dir = await dirWithout('none');
  const h3 = MAKERS.find((m) => m.id === 'h3-max');
  const files = h3.files.map((k) => ALL[k]);
  const total = files.reduce((t, f) => t + f.size, 0);
  // The biggest file is 20 GB down already (a sparse .part, so the test machine's disk doesn't care).
  const big = files[0];
  const part = path.join(dir, 'models', big.dir, `${big.name}.part`);
  await fs.mkdir(path.dirname(part), { recursive: true });
  await fs.writeFile(part, '');
  await fs.truncate(part, big.size - 1024 ** 3);
  const left = total - (big.size - 1024 ** 3);
  // Room for what is left plus the 2 GB reserve, but not for the whole maker again.
  const freeGb = Math.ceil(left / 1024 ** 3) + 3;
  assert.ok(freeGb * 1024 ** 3 < total + 2 * 1024 ** 3);
  let checks = 0;
  const studio = createStudio({ dir, files: FILES, fetchImpl: async (url) => services(new URL(url)), WebSocketImpl: null, log: quiet, statfs: async () => ({ bavail: checks++ ? 0 : freeGb, bsize: 1024 ** 3 }), nsfwDelayMs: 1e9 });
  // Only the up-front check gets the room; the download that follows then stops (so the test ends).
  const list = await studio.installMaker('h3-max');
  assert.equal(list.find((m) => m.id === 'h3-max').wanted, true);
});
