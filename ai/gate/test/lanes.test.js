import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStudio } from '../src/studio.js';

// Model files come down several at once while that makes the total faster, and fewer when it doesn't.
const MB = 1024 * 1024;
const files = (n, size) => Array.from({ length: n }, (_, i) => ({ dir: 'loras', name: `f${i}.safetensors`, repo: 'o/r', path: `f${i}.safetensors`, size }));
const quiet = { warn() {}, info() {} };
const bigDisk = async () => ({ bavail: 1e6, bsize: MB });
const services = (u) => (u.pathname === '/api/ps' ? Response.json({ models: [] }) : Response.json({}));

/**
 * A stand-in for the model site. `perStream`: each connection gets this many bytes a second however many
 * are open (the site limits each one: more at once is faster). `line`: all connections share this many
 * (the machine's line is the limit: more at once is not faster).
 */
function site(opts) {
  const { perStream, line } = opts;
  const open = new Set();
  let most = 0;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname !== 'huggingface.co') return services(u);
    const size = opts.size ?? 6 * MB;
    let sent = 0;
    let timer;
    const me = {};
    const body = new ReadableStream({
      start(c) {
        open.add(me);
        most = Math.max(most, open.size);
        timer = setInterval(() => {
          const rate = perStream ?? line / open.size;
          const n = Math.min(size - sent, Math.round(rate * 0.05));
          sent += n;
          c.enqueue(new Uint8Array(n));
          if (sent >= size) {
            clearInterval(timer);
            open.delete(me);
            c.close();
          }
        }, 50);
        init.signal?.addEventListener('abort', () => {
          clearInterval(timer);
          open.delete(me);
          c.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      },
      cancel() {
        clearInterval(timer);
        open.delete(me);
      },
    });
    return new Response(body, { status: 200, headers: { 'content-length': String(size) } });
  };
  return { fetchImpl, most: () => most, open: () => open.size };
}

async function run(opts) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanes-'));
  const FILES = { image: files(opts.count ?? 8, opts.size ?? 6 * MB), video: [] };
  const s = site(opts);
  const studio = createStudio({ dir, files: FILES, fetchImpl: s.fetchImpl, WebSocketImpl: null, log: quiet, retryMs: 10, statfs: bigDisk, nsfwDelayMs: 1e9, tuneLanesMs: 200, laneWarmupMs: 400, ...opts.studio });
  studio.start();
  return { studio, site: s };
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

test('lanes: when each connection is limited, more files come down at once, up to four', async () => {
  const { studio, site: s } = await run({ perStream: 4 * MB, size: 24 * MB });
  await settle(400);
  // Two at once from the start, both in the download manager.
  const d = await studio.downloads();
  assert.equal(d.active.length, 2);
  assert.equal(d.state, 'downloading');
  assert.match(d.bottleneck, /2 files at once/);
  const end = Date.now() + 8000;
  while (s.most() < 4 && Date.now() < end) await settle(100);
  assert.equal(s.most(), 4, 'more lanes while it kept getting faster');
  const log = (await studio.downloads()).log.map((l) => l.text).join('\n');
  assert.match(log, /3 files at once: there is bandwidth to spare/);
  assert.match(log, /4 files at once: there is bandwidth to spare/);
  studio.pauseDownloads();
});

test('lanes: when the line itself is full, no more are added (and one comes off)', async () => {
  const { studio, site: s } = await run({ line: 8 * MB });
  await settle(4000);
  const d = await studio.downloads();
  assert.ok(s.most() <= 3, `at most one lane was tried beyond what helped (saw ${s.most()})`);
  assert.equal(d.lanes, 2);
  assert.match(d.log.map((l) => l.text).join('\n'), /2 files at once: one more didn't make it faster .* the line is full/);
  studio.pauseDownloads();
});

test('lanes: one at a time when asked (a global volume), and pause stops every lane', async () => {
  const { studio, site: s } = await run({ perStream: 4 * MB, studio: { maxDownloadLanes: 1 } });
  await settle(1500);
  assert.equal(s.most(), 1);
  const two = await run({ perStream: 4 * MB });
  await settle(500);
  assert.equal(two.site.open(), 2);
  two.studio.pauseDownloads();
  await settle(200);
  assert.equal(two.site.open(), 0, 'every lane stopped');
  assert.equal((await two.studio.downloads()).state, 'paused');
  studio.pauseDownloads();
});

test('lanes: everything arrives, every file once', async () => {
  const { studio } = await run({ perStream: 12 * MB, count: 6 });
  const end = Date.now() + 10_000;
  for (;;) {
    const d = await studio.downloads();
    if (d.state === 'idle') break;
    if (Date.now() > end) assert.fail(`still ${d.state}`);
    await settle(100);
  }
  const d = await studio.downloads();
  assert.equal(d.done, 6);
  assert.equal(d.queue.length, 0);
});
