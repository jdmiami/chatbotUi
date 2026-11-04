import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStudio } from '../src/studio.js';
import { memoryR2 } from './fakes/memoryR2.js';

// An AI machine told to load only some makers (ONLY_MAKERS on GPU.ai: Qwen Image and H3 Max) keeps
// just those, in that order, even when another machine added more to the shared list in R2.

const FILES = {
  image: [
    { dir: 'diffusion_models', name: 'img.safetensors', repo: 'o/r', path: 'img.safetensors', size: 4 },
    { dir: 'text_encoders', name: 'te.safetensors', repo: 'o/r', path: 'te.safetensors', size: 4 },
    { dir: 'vae', name: 'vae.safetensors', repo: 'o/r', path: 'vae.safetensors', size: 4 },
  ],
  video: [{ dir: 'checkpoints', name: 'vid.safetensors', repo: 'o/r', path: 'vid.safetensors', size: 4 }],
};
const quiet = { warn() {}, info() {}, log() {} };
const bigDisk = async () => ({ bavail: 1e6, bsize: 1024 ** 2 });
const noNet = async (url) => (new URL(url).pathname === '/api/ps' ? Response.json({ models: [] }) : Response.json({}));

test('a strict short list ignores what was added elsewhere; a plain short list still adds it', async () => {
  const { r2 } = memoryR2();
  // Another machine added Anime and the H3 maker to the shared list.
  await r2.putJson('state/makers.json', { wanted: ['anime', 'h3-max'] });

  const wantedOf = async (studio) => (await studio.makers()).filter((m) => m.wanted).map((m) => m.id);
  const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

  const strictDir = await fs.mkdtemp(path.join(os.tmpdir(), 'only-'));
  const strict = createStudio({ dir: strictDir, files: FILES, role: 'helper', r2, makers: ['qwen', 'h3-max', 'edit'], strictMakers: true, fetchImpl: noNet, WebSocketImpl: null, log: quiet, statfs: bigDisk, nsfwDelayMs: 1e9 });
  strict.start();
  await settle();
  // The shared list was read (start) and ignored: only the short list, in its order.
  assert.deepEqual(await wantedOf(strict), ['qwen', 'h3-max', 'edit']);

  const looseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loose-'));
  const loose = createStudio({ dir: looseDir, files: FILES, role: 'helper', r2, makers: ['qwen'], fetchImpl: noNet, WebSocketImpl: null, log: quiet, statfs: bigDisk, nsfwDelayMs: 1e9 });
  loose.start();
  await settle();
  assert.deepEqual((await wantedOf(loose)).sort(), ['anime', 'h3-max', 'qwen']);
});
