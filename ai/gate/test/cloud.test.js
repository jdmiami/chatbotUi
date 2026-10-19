import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createMirror, downloadStream, uploadStream } from '../src/r2.js';
import { memoryR2 } from './fakes/memoryR2.js';
import { createOllamaSync, walk } from '../src/cloud.js';

const quiet = { info() {}, warn() {} };
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'cloud-'));

test('listing follows pages; whole objects and JSON go up and come back; a link is signed for GET', async () => {
  const { r2 } = memoryR2();
  for (const k of ['a/1', 'a/2', 'a/3 & 4', 'b/1']) await r2.put(k, k);
  assert.deepEqual((await r2.list('a/')).map((o) => o.key), ['a/1', 'a/2', 'a/3 & 4']);
  await r2.putJson('state/x.json', { wanted: ['angles'] });
  assert.deepEqual(await r2.getJson('state/x.json'), { wanted: ['angles'] });
  assert.equal(await r2.getJson('state/missing.json'), null);
  const link = new URL(r2.presign('gallery/orbit/a b.png', 600, new Date('2026-01-02T03:04:05Z')));
  assert.equal(link.pathname, '/orbit-models/gallery/orbit/a%20b.png');
  assert.equal(link.searchParams.get('X-Amz-Expires'), '600');
  assert.match(link.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
});

test('a stream goes up in parts and comes back in order; a failed source leaves nothing behind', async () => {
  const { r2, objects } = memoryR2();
  const data = crypto.randomBytes(3 * 1024 * 1024 + 77);
  const chunks = [];
  for (let i = 0; i < data.length; i += 100_000) chunks.push(data.subarray(i, i + 100_000));
  const n = await uploadStream(r2, Readable.from(chunks), 'env/x.tar', { partMiB: 1, concurrency: 2 });
  assert.equal(n, data.length);
  assert.deepEqual(objects.get('env/x.tar'), data);
  const back = [];
  for await (const c of downloadStream(r2, 'env/x.tar', { chunkMiB: 1, concurrency: 3 })) back.push(c);
  assert.deepEqual(Buffer.concat(back), data);

  await assert.rejects(uploadStream(r2, Readable.from([data]), 'env/bad.tar', { partMiB: 1, ready: async () => Promise.reject(new Error('tar exited 2')) }), /tar exited 2/);
  assert.equal(objects.has('env/bad.tar'), false);
});

test('Ollama models: blobs before manifests both ways, skipping half-done files; prune only after a restore', async () => {
  const { r2, objects, log } = memoryR2();
  const a = await tmp();
  await fs.mkdir(path.join(a, 'blobs'), { recursive: true });
  await fs.mkdir(path.join(a, 'manifests/registry.ollama.ai/library/qwen'), { recursive: true });
  await fs.writeFile(path.join(a, 'blobs/sha256-1'), 'weights');
  await fs.writeFile(path.join(a, 'blobs/sha256-2-partial'), 'half');
  await fs.writeFile(path.join(a, 'manifests/registry.ollama.ai/library/qwen/27b'), '{"layers":[]}');
  const up = createOllamaSync({ r2, dir: a, log: quiet });
  assert.equal(await up.prune(), 0, 'nothing pruned before a restore');
  await up.backup();
  assert.deepEqual([...objects.keys()].sort(), ['ollama/blobs/sha256-1', 'ollama/manifests/registry.ollama.ai/library/qwen/27b']);
  const puts = log.filter((l) => l.startsWith('PUT ollama/'));
  assert.ok(puts[0].includes('blobs/'), 'the blob went up before the manifest');
  log.length = 0;
  await up.backup();
  assert.equal(log.filter((l) => l.startsWith('PUT')).length, 0, 'nothing new: nothing uploaded');

  // A fresh machine: everything comes back, blob first.
  const b = await tmp();
  const down = createOllamaSync({ r2, dir: b, log: quiet });
  const seen = [];
  const r = await down.restore((p) => seen.push(p));
  assert.equal(r.files, 2);
  assert.deepEqual((await walk(b)).map((f) => f.rel).sort(), ['blobs/sha256-1', 'manifests/registry.ollama.ai/library/qwen/27b']);
  assert.equal(await fs.readFile(path.join(b, 'blobs/sha256-1'), 'utf8'), 'weights');
  assert.equal((await down.restore()).files, 0, 'already here: nothing downloaded');

  // Deleted here after the restore: deleted from R2 too.
  await fs.rm(path.join(b, 'manifests/registry.ollama.ai/library/qwen/27b'));
  await fs.rm(path.join(b, 'blobs/sha256-1'));
  assert.equal(await down.prune(), 2);
  assert.equal(objects.size, 0);
});

test('mirror: save, fetch on another machine, pull only new notes, drop', async () => {
  const { r2, objects } = memoryR2();
  const a = await tmp();
  await fs.mkdir(path.join(a, 'orbit'), { recursive: true });
  await fs.writeFile(path.join(a, 'orbit/x1.json'), '{"id":"x1"}');
  await fs.writeFile(path.join(a, 'pic.png'), 'png');
  const m = createMirror({ r2, root: a, prefix: 'gallery/', log: quiet });
  await m.save(path.join(a, 'orbit/x1.json'));
  await m.save(path.join(a, 'pic.png'));
  assert.deepEqual([...objects.keys()].sort(), ['gallery/orbit/x1.json', 'gallery/pic.png']);
  assert.throws(() => m.keyOf('/etc/passwd'), /outside/);

  const b = await tmp();
  const m2 = createMirror({ r2, root: b, prefix: 'gallery/', log: quiet });
  assert.deepEqual(await m2.pull('orbit/', (rel) => rel.endsWith('.json')), ['orbit/x1.json']);
  assert.equal(await fs.readFile(path.join(b, 'orbit/x1.json'), 'utf8'), '{"id":"x1"}');
  assert.equal(await m2.fetch(path.join(b, 'pic.png')), true);
  assert.equal(await m2.fetch(path.join(b, 'nope.png')), false);
  await m2.drop(path.join(b, 'pic.png'));
  assert.deepEqual([...objects.keys()], ['gallery/orbit/x1.json']);
});

test('model keeper: brings saved models back before downloading, and saves each new one', async () => {
  const { createModelKeeper } = await import('../src/machine.js');
  const order = [];
  const have = new Set();
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/api/tags') return Response.json({ models: [...have].map((name) => ({ name })) });
    if (u.pathname === '/api/pull') {
      const { model } = JSON.parse(init.body);
      order.push(`pull ${model}`);
      have.add(model);
      return new Response(`${JSON.stringify({ status: 'success' })}\n`);
    }
    return Response.json({});
  };
  const keeper = createModelKeeper({
    ollama: 'http://ollama',
    wanted: ['a:1', 'b:2'],
    fetchImpl,
    restore: async () => {
      order.push('restore');
      have.add('a:1');
    },
    saved: async () => order.push('save'),
  });
  keeper.start();
  for (let i = 0; i < 200 && order.length < 3; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(order, ['restore', 'pull b:2', 'save']);
});
