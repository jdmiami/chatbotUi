// The drawing machine (AI_ROLE=canvas): its own volume for software and models, the gallery in R2
// (GALLERY=r2), and only its own short list of makers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStudio } from '../src/studio.js';
import { keptInR2, machineRole } from '../src/cloud.js';
import { memoryR2 } from './fakes/memoryR2.js';

const FILES = {
  image: [{ dir: 'diffusion_models', name: 'img.safetensors', repo: 'o/r', path: 'img.safetensors', size: 8 }],
  video: [{ dir: 'checkpoints', name: 'vid.safetensors', repo: 'o/r', path: 'vid.safetensors', size: 4 }],
};
const quiet = { warn() {}, info() {} };
const bigDisk = async () => ({ bavail: 1e6, bsize: 1024 ** 2 });
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('what is kept in R2: everything with STORAGE=r2, the gallery only with GALLERY=r2, nothing otherwise', () => {
  assert.deepEqual(keptInR2({ STORAGE: 'r2' }), { all: true, gallery: true });
  assert.deepEqual(keptInR2({ STORAGE: 'r2', GALLERY: 'r2' }), { all: true, gallery: true });
  assert.deepEqual(keptInR2({ STORAGE: 'volume', GALLERY: 'r2' }), { all: false, gallery: true });
  assert.deepEqual(keptInR2({ STORAGE: 'volume' }), { all: false, gallery: false });
  assert.deepEqual(keptInR2({}), { all: false, gallery: false });
  assert.equal(machineRole({ AI_ROLE: 'canvas' }), 'canvas');
  assert.equal(machineRole({ AI_ROLE: 'helper' }), 'helper');
  assert.equal(machineRole({}), 'main');
  assert.equal(machineRole({ AI_ROLE: 'something' }), 'main');
});

test('drawing machine: models stay on its volume, only its makers come down, the gallery goes to R2', async () => {
  const { r2, objects, log } = memoryR2();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-'));
  await fs.writeFile(path.join(dir, 'state-canvas'), 'running');
  const fetched = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'huggingface.co') {
      fetched.push(u.pathname.split('/').pop());
      const size = FILES.video.concat(FILES.image).find((f) => u.pathname.endsWith(f.path)).size;
      return new Response(new Uint8Array(size), { status: 200, headers: { 'content-length': String(size) } });
    }
    return u.pathname === '/api/ps' ? Response.json({ models: [] }) : Response.json({});
  };
  const studio = createStudio({ dir, files: FILES, role: 'canvas', gallery: r2, makers: ['ltx'], fetchImpl, WebSocketImpl: null, log: quiet, retryMs: 10, statfs: bigDisk, nsfwDelayMs: 1e9 });
  studio.start();
  await until(async () => (await studio.makers()).find((m) => m.id === 'ltx')?.installed);
  // Only the short list: the built-in picture maker is not downloaded here.
  assert.deepEqual(fetched, ['vid.safetensors']);
  const makers = await studio.makers();
  assert.equal(makers.find((m) => m.id === 'ltx').wanted, true);
  assert.equal(makers.find((m) => m.id === 'qwen').wanted, false);
  // Its own state file (studio.sh writes state-canvas).
  assert.equal((await studio.state()).setup, 'running');

  const item = await studio.importItem({ url: `data:image/png;base64,${PNG}`, kind: 'image', prompt: 'a lighthouse' });
  const keys = [...objects.keys()].sort();
  // The picture, its note and its thumbnail for the gallery grid (all in the gallery's R2 folder).
  assert.deepEqual(keys, [`gallery/${item.file.split(path.sep).join('/')}`, `gallery/orbit/${item.id}.json`, `gallery/thumbs/${item.id}.webp`].sort());
  // Model files and settings never touch R2 on this machine.
  assert.ok(!log.some((l) => / (models|state)\//.test(l)), log.join('\n'));

  // The main AI machine (everything in R2) sees it in the one gallery.
  const mainDir = await fs.mkdtemp(path.join(os.tmpdir(), 'main-'));
  const main = createStudio({ dir: mainDir, files: FILES, r2, fetchImpl: async () => Response.json({}), WebSocketImpl: null, log: quiet, statfs: bigDisk, nsfwDelayMs: 1e9 });
  assert.ok((await main.items()).some((i) => i.id === item.id && i.prompt === 'a lighthouse'));
  assert.ok(await main.itemPath(item.id));
});

test('a machine without R2 keeps its gallery on its own disk', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-'));
  const studio = createStudio({ dir, files: FILES, fetchImpl: async () => Response.json({}), WebSocketImpl: null, log: quiet, statfs: bigDisk, nsfwDelayMs: 1e9 });
  assert.equal(studio.mirror, null);
  const item = await studio.importItem({ url: `data:image/png;base64,${PNG}`, kind: 'image', prompt: 'x' });
  assert.ok((await studio.items()).some((i) => i.id === item.id));
});
