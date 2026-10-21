import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNsfwCheck, frameTimes, NSFW_THRESHOLD } from '../src/nsfwcheck.js';
import { createStudio } from '../src/studio.js';

const quiet = { warn() {}, info() {} };

/** A stand-in for nsfw_worker.py: the same protocol, scoring by file name. */
const FAKE_WORKER = `
const rl = require('node:readline').createInterface({ input: process.stdin });
console.log(JSON.stringify({ ready: true }));
rl.on('line', (line) => {
  const req = JSON.parse(line);
  if (req.paths.some((p) => p.includes('broken'))) return console.log(JSON.stringify({ id: req.id, error: 'cannot read' }));
  const score = Math.max(0, ...req.paths.map((p) => (/nude|frame-2/.test(require('node:fs').readFileSync(p, 'utf8')) ? 0.97 : 0.02)));
  console.log(JSON.stringify({ id: req.id, score }));
});`;

async function fakeChecker() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfw-'));
  const script = path.join(dir, 'worker.cjs');
  await fs.writeFile(script, FAKE_WORKER);
  const ffmpegCalls = [];
  const check = createNsfwCheck({
    python: process.execPath,
    script,
    log: quiet,
    // Frames: the third frame of the video is the NSFW one.
    ffmpeg: async (args) => {
      ffmpegCalls.push(args);
      const out = args.at(-1);
      await fs.writeFile(out, `frame-${ffmpegCalls.length - 1}`);
    },
  });
  return { dir, check, ffmpegCalls };
}

test('the checker: pictures and video frames, a broken picture answers null, a missing Python never throws', async () => {
  const { dir, check, ffmpegCalls } = await fakeChecker();
  const safe = path.join(dir, 'fox.png');
  const nude = path.join(dir, 'beach.png');
  await fs.writeFile(safe, 'a red fox');
  await fs.writeFile(nude, 'nude on the beach');
  assert.deepEqual(await check.check(safe), { nsfw: false, score: 0.02 });
  assert.deepEqual(await check.check(nude), { nsfw: true, score: 0.97 });
  assert.equal(await check.check(path.join(dir, 'broken.png')), null);

  const video = path.join(dir, 'clip.mp4');
  await fs.writeFile(video, 'video');
  const v = await check.check(video, { kind: 'video', seconds: 8 });
  assert.equal(v.nsfw, true, 'one NSFW frame makes the clip NSFW');
  assert.equal(ffmpegCalls.length, frameTimes(8).length, 'looks at several frames across the clip');
  assert.deepEqual(frameTimes(8), [0.3, 2, 4, 6, 7.6]);
  check.stop();

  const none = createNsfwCheck({ python: '/nowhere/python', script: '/nowhere/worker.py', log: quiet });
  assert.equal(await none.check(safe), null);
  assert.ok(NSFW_THRESHOLD > 0 && NSFW_THRESHOLD < 0.5, 'leans towards blurring');
});

// ---- the studio uses it: every new picture is looked at, things made from NSFW stay NSFW, old ones get checked

const FILES = {
  image: [{ dir: 'diffusion_models', name: 'img.safetensors', repo: 'o/r', path: 'img.safetensors', size: 4 }],
  video: [{ dir: 'checkpoints', name: 'vid.safetensors', repo: 'o/r', path: 'vid.safetensors', size: 4 }],
};

/** A pretend ComfyUI + Ollama: each queued prompt gets its own id and finishes when told. */
function fakeServices(state) {
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/system_stats') return Response.json({ system: {} });
    if (u.pathname === '/api/ps') return Response.json({ models: [] });
    if (u.pathname === '/prompt') {
      state.n += 1;
      return Response.json({ prompt_id: `p${state.n}`, number: 0, node_errors: {} });
    }
    const m = /^\/history\/(p\d+)$/.exec(u.pathname);
    if (m) {
      const id = m[1];
      if (!state.done.has(id)) return Response.json({});
      return Response.json({ [id]: { status: { completed: true, status_str: 'success' }, outputs: { 9: { images: [{ filename: state.names[id], subfolder: 'orbit', type: 'output' }] } } } });
    }
    if (u.pathname === '/free' || u.pathname === '/api/generate') return Response.json({});
    return new Response('nope', { status: 404 });
  };
}

async function newStudio(nsfw) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-nsfw-'));
  for (const f of [...FILES.image, ...FILES.video]) {
    await fs.mkdir(path.join(dir, 'models', f.dir), { recursive: true });
    await fs.writeFile(path.join(dir, 'models', f.dir, f.name), 'abcd');
  }
  const state = { n: 0, done: new Set(), names: {} };
  const studio = createStudio({ dir, files: FILES, fetchImpl: fakeServices(state), WebSocketImpl: null, log: quiet, freeAfterMs: 0, nsfw });
  return { dir, state, studio };
}

async function make(ctx, req, content) {
  const { dir, state, studio } = ctx;
  const job = await studio.createJob(req);
  const pid = `p${state.n}`;
  state.names[pid] = `${job.id}.png`;
  await fs.mkdir(path.join(dir, 'output', 'orbit'), { recursive: true });
  await fs.writeFile(path.join(dir, 'output', 'orbit', `${job.id}.png`), content);
  state.done.add(pid);
  for (let i = 0; i < 20 && studio.job(job.id).status !== 'done'; i++) await studio.poll();
  return studio.job(job.id);
}

const until = async (fn) => {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out');
};

test('studio: every new picture is checked and the answer saved; made from an NSFW one = NSFW; old ones get checked', async () => {
  const seen = [];
  const nsfw = {
    async check(file) {
      const text = await fs.readFile(file, 'utf8');
      seen.push(path.basename(file));
      return /nude/.test(text) ? { nsfw: true, score: 0.9 } : { nsfw: false, score: 0.01 };
    },
  };
  const ctx = await newStudio(nsfw);
  const { studio } = ctx;
  const item = async (id) => (await studio.items()).find((i) => i.id === id);

  // An innocent prompt, an NSFW picture: the check catches what the words don't.
  const a = await make(ctx, { kind: 'image', prompt: 'a woman at the beach', size: 'portrait' }, 'nude pixels');
  assert.equal(a.status, 'done');
  await until(async () => (await item(a.id))?.nsfw === true);
  assert.equal((await item(a.id)).nsfwScore, 0.9);

  const b = await make(ctx, { kind: 'image', prompt: 'a red fox', size: 'portrait' }, 'fox pixels');
  await until(async () => (await item(b.id))?.nsfw === false);

  // Edited from the NSFW picture: NSFW straight away, no need to look.
  const before = seen.length;
  const c = await make(ctx, { kind: 'image', maker: 'edit', prompt: 'make it night', fromItem: a.id }, 'anything');
  assert.equal(c.item.nsfw, true);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(seen.length, before, 'not looked at again');

  // A picture from before the check existed: rateAll finds and checks it.
  const old = { id: 'oldpic123', kind: 'image', prompt: 'old', file: 'orbit/old.png', createdAt: '2026-01-01T00:00:00Z' };
  await fs.writeFile(path.join(ctx.dir, 'output', 'orbit', 'old.png'), 'nude old');
  await fs.writeFile(path.join(ctx.dir, 'output', 'orbit', 'oldpic123.json'), JSON.stringify(old));
  await studio.rateAll();
  assert.equal((await item('oldpic123')).nsfw, true);
});

test('studio: without a checker nothing changes', async () => {
  const ctx = await newStudio(undefined);
  const a = await make(ctx, { kind: 'image', prompt: 'a red fox', size: 'portrait' }, 'fox');
  assert.equal(a.item.nsfw, undefined);
  await ctx.studio.rateAll();
  assert.equal((await ctx.studio.items())[0].nsfw, undefined);
});

test('studio: your own say (held to blur, or the switch) is saved, survives the check, and can be handed back', async () => {
  const nsfw = { async check() { await new Promise((r) => setTimeout(r, 20)); return { nsfw: false, score: 0.02 }; } };
  const ctx = await newStudio(nsfw);
  const { studio } = ctx;
  const item = async (id) => (await studio.items()).find((i) => i.id === id);

  const a = await make(ctx, { kind: 'image', prompt: 'a red fox', size: 'portrait' }, 'fox pixels');
  // Marked while the check is still looking: the check's answer must not wipe it.
  assert.equal((await studio.markNsfw(a.id, true)).nsfwUser, true);
  await until(async () => (await item(a.id))?.nsfw === false);
  assert.equal((await item(a.id)).nsfwUser, true);

  await studio.markNsfw(a.id, false);
  assert.equal((await item(a.id)).nsfwUser, false);
  await studio.markNsfw(a.id, null);
  assert.equal('nsfwUser' in (await item(a.id)), false);

  assert.equal(await studio.markNsfw('nosuchitem1', true), null);
});
