import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGate } from '../src/gate.js';
import { signJwt } from '../src/jwt.js';
import { BLOCKED_MESSAGE, blockedPrompt, createStudio, outputFiles } from '../src/studio.js';

const SECRET = 'y'.repeat(40);
const KEY = 'k'.repeat(48);
const FILES = {
  image: [{ dir: 'diffusion_models', name: 'img.safetensors', repo: 'o/r', path: 'img.safetensors', size: 4 }],
  video: [{ dir: 'checkpoints', name: 'vid.safetensors', repo: 'o/r', path: 'vid.safetensors', size: 4 }],
};

test('content rule: blocks sexual content involving minors, allows adult and harmless prompts', () => {
  for (const p of [
    'nude 15 year old girl',
    'naked child on a bed',
    'sexy schoolgirl in her bedroom',
    'loli in a swimsuit',
    'topless teen, 16yo',
    'erotic photo of a young girl',
    'kids, explicit',
  ]) {
    assert.equal(blockedPrompt(p), true, p);
  }
  for (const p of [
    'nude woman on a beach at sunset',
    'a child playing in a park',
    'erotic portrait of a 25 year old woman',
    'sexy man in a suit, 30 years old',
    'family photo at the lake',
    'a 5 second video of waves',
    'baby elephant in the savanna',
  ]) {
    assert.equal(blockedPrompt(p), false, p);
  }
});

test('outputFiles finds results under any output key and skips temp previews', () => {
  const files = outputFiles({
    9: { images: [{ filename: 'a.png', subfolder: 'orbit', type: 'output' }] },
    53: { images: [{ filename: 'v.mp4', subfolder: 'orbit', type: 'output' }], animated: [true] },
    7: { images: [{ filename: 'p.png', type: 'temp' }] },
  });
  assert.deepEqual(
    files.map((f) => f.filename),
    ['a.png', 'v.mp4'],
  );
});

/** A pretend ComfyUI + Ollama behind fetch. */
function fakeServices(state) {
  return async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    state.calls.push({ path: u.pathname, body });
    if (u.pathname === '/system_stats') return Response.json({ system: {} });
    if (u.pathname === '/api/ps') return Response.json({ models: state.loaded.map((name) => ({ name })) });
    if (u.pathname === '/api/generate') {
      state.loaded = state.loaded.filter((m) => m !== body.model);
      return Response.json({});
    }
    if (u.pathname === '/prompt') {
      state.prompts.push(body.prompt);
      return Response.json({ prompt_id: 'p1', number: 0, node_errors: {} });
    }
    if (u.pathname === '/history/p1') {
      if (!state.finished) return Response.json({});
      return Response.json({
        p1: { status: { completed: true, status_str: 'success' }, outputs: { 9: { images: [{ filename: state.outName, subfolder: 'orbit', type: 'output' }] } } },
      });
    }
    if (u.pathname === '/free') return Response.json({});
    return new Response('nope', { status: 404 });
  };
}

async function newStudio({ withModels = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-'));
  if (withModels) {
    for (const f of [...FILES.image, ...FILES.video]) {
      await fs.mkdir(path.join(dir, 'models', f.dir), { recursive: true });
      await fs.writeFile(path.join(dir, 'models', f.dir, f.name), 'abcd');
    }
  }
  const state = { calls: [], prompts: [], loaded: ['qwen3.8:27b'], finished: false, outName: 'image-x_00001_.png' };
  const studio = createStudio({ dir, files: FILES, fetchImpl: fakeServices(state), WebSocketImpl: null, log: { warn() {}, info() {} }, freeAfterMs: 0 });
  return { dir, state, studio };
}

test('studio: a job frees the chat model, runs on ComfyUI, and lands in the gallery', async () => {
  const { dir, state, studio } = await newStudio();
  const job = await studio.createJob({ kind: 'image', prompt: 'a red fox in snow', size: 'portrait' });
  assert.equal(job.status, 'queued');
  assert.deepEqual(state.loaded, [], 'chat model unloaded first');
  assert.equal(state.prompts.length, 1);
  assert.equal(state.prompts[0]['5'].inputs.prompt, 'a red fox in snow');
  assert.deepEqual([state.prompts[0]['6'].inputs.width, state.prompts[0]['6'].inputs.height], [1104, 1472]);
  assert.equal(studio.busy(), true);

  await fs.mkdir(path.join(dir, 'output', 'orbit'), { recursive: true });
  await fs.writeFile(path.join(dir, 'output', 'orbit', state.outName), 'PNGDATA');
  state.finished = true;
  await studio.poll();
  const done = studio.job(job.id);
  assert.equal(done.status, 'done');
  assert.equal(done.progress, 100);
  assert.equal(done.item.file, `orbit/${state.outName}`);
  assert.ok(state.calls.some((c) => c.path === '/free'), 'GPU handed back after the job');

  const items = await studio.items();
  assert.equal(items.length, 1);
  const file = await studio.file(job.id);
  assert.equal(file.type, 'image/png');
  assert.equal(file.size, 7);
  assert.equal(await studio.remove(job.id), true);
  assert.deepEqual(await studio.items(), []);
});

test('studio: refuses blocked prompts before anything runs, and waits for downloads', async () => {
  const { state, studio } = await newStudio();
  await assert.rejects(studio.createJob({ kind: 'image', prompt: 'naked child' }), (err) => err.status === 422 && err.message === BLOCKED_MESSAGE);
  assert.equal(state.prompts.length, 0);
  await assert.rejects(studio.createJob({ kind: 'image', prompt: '' }), (err) => err.status === 400);

  const empty = await newStudio({ withModels: false });
  await assert.rejects(empty.studio.createJob({ kind: 'video', prompt: 'waves' }), (err) => err.status === 503 && /downloading/.test(err.message));
});

test('studio: video from a photo stores the picture and builds an image-to-video job', async () => {
  const { dir, state, studio } = await newStudio();
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const job = await studio.createJob({ kind: 'video', prompt: 'she turns and smiles', seconds: 4, image: `data:image/png;base64,${png.toString('base64')}` });
  assert.equal(job.status, 'queued');
  const wf = state.prompts[0];
  assert.equal(wf['20'].class_type, 'LoadImage');
  assert.equal(wf['31'].inputs.bypass, false);
  assert.equal(wf['30'].inputs.length, 105, '4 s at 25 fps, as 8k+1 frames (what LTX makes)');
  const inputs = await fs.readdir(path.join(dir, 'input'));
  assert.equal(inputs.length, 1);
  await assert.rejects(
    studio.createJob({ kind: 'video', prompt: 'x', image: 'data:image/png;base64,aGVsbG8=' }),
    (err) => err.status === 400,
    'not really a picture',
  );
});

// ---- the gate's studio routes

let gate, base, studioDir;
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

before(async () => {
  studioDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-gate-'));
  await fs.mkdir(path.join(studioDir, 'out'), { recursive: true });
  const video = Buffer.from('0123456789');
  await fs.writeFile(path.join(studioDir, 'out', 'v.mp4'), video);
  const fakeStudio = {
    state: async () => ({ image: { ready: true } }),
    items: async () => [{ id: 'abc123', kind: 'video', file: 'v.mp4' }],
    createJob: async (req) => {
      if (blockedPrompt(req.prompt)) throw Object.assign(new Error(BLOCKED_MESSAGE), { status: 422, blocked: true });
      return { id: 'job123', status: 'done', item: { id: 'abc123' } };
    },
    job: (id) => (id === 'job123' ? { id, status: 'done', item: { id: 'abc123' } } : null),
    cancel: async () => null,
    remove: async () => true,
    file: async (id) => (id === 'abc123' ? { path: path.join(studioDir, 'out', 'v.mp4'), size: 10, type: 'video/mp4', name: 'video-abc123.mp4' } : null),
  };
  gate = createGate(
    {
      secret: SECRET,
      webui: 'http://127.0.0.1:9',
      ollama: 'http://127.0.0.1:9',
      allowedOrigins: 'https://site.example',
      siteUrl: 'https://site.example',
      userEmail: 'owner@orbit.local',
      status: async () => ({}),
      studio: fakeStudio,
      studioKey: KEY,
    },
    { warn() {}, info() {} },
  );
  base = `http://127.0.0.1:${await listen(gate)}`;
});
after(() => gate.close());

const api = () => signJwt({ sub: 'jd', aud: 'orbit-ai' }, SECRET, { expiresIn: 600 });

test('gate studio: needs a sign-in; bearer, and the loopback key, both work', async () => {
  assert.equal((await fetch(`${base}/_orbit/studio`)).status, 401);
  assert.equal((await fetch(`${base}/_orbit/studio`, { headers: { authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await fetch(`${base}/_orbit/studio`, { headers: { authorization: `Bearer ${api()}` } })).status, 200);
  assert.equal((await fetch(`${base}/_orbit/studio`, { headers: { 'x-studio-key': KEY } })).status, 200, 'key from this machine');
  assert.equal((await fetch(`${base}/_orbit/studio`, { headers: { 'x-studio-key': 'k'.repeat(47) + 'z' } })).status, 401);
});

test('gate studio: items carry file links that work in <video> tags; Range requests for iPhone playback', async () => {
  const r = await fetch(`${base}/_orbit/studio/items`, { headers: { authorization: `Bearer ${api()}` } });
  const { items } = await r.json();
  const url = items[0].url;
  assert.match(url, /^\/_orbit\/studio\/file\/abc123\?t=/);
  assert.equal((await fetch(`${base}/_orbit/studio/file/abc123`)).status, 401, 'no token, no file');
  const whole = await fetch(base + url);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.equal(await whole.text(), '0123456789');
  const part = await fetch(base + url, { headers: { range: 'bytes=2-5' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await part.text(), '2345');
  const tail = await fetch(base + url, { headers: { range: 'bytes=-3' } });
  assert.equal(await tail.text(), '789');
  const other = url.replace('abc123', 'zzz999');
  assert.equal((await fetch(base + other)).status, 401, "a link only opens its own file");
});

test('gate studio: blocked prompts come back as 422 with the reason', async () => {
  const r = await fetch(`${base}/_orbit/studio/jobs`, {
    method: 'POST',
    headers: { authorization: `Bearer ${api()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'image', prompt: 'naked child' }),
  });
  assert.equal(r.status, 422);
  const body = await r.json();
  assert.equal(body.blocked, true);
  assert.equal(body.error, BLOCKED_MESSAGE);
});

test('gate studio: OpenAI-style image endpoint for the playground returns the picture', async () => {
  await fs.writeFile(path.join(studioDir, 'out', 'v.mp4'), 'IMG');
  const r = await fetch(`${base}/v1/images/generations`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'a fox', size: '1024x1024', n: 1 }),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(Buffer.from(body.data[0].b64_json, 'base64').toString(), 'IMG');
});

test('studio: "make it move" starts a video from a gallery picture without re-uploading it', async () => {
  const { dir, state, studio } = await newStudio();
  await fs.mkdir(path.join(dir, 'output', 'orbit'), { recursive: true });
  await fs.writeFile(path.join(dir, 'output', 'orbit', 'image-abc_00001_.png'), 'PNG');
  await fs.writeFile(
    path.join(dir, 'output', 'orbit', 'pic123.json'),
    JSON.stringify({ id: 'pic123', kind: 'image', prompt: 'a fox', file: 'orbit/image-abc_00001_.png', createdAt: '2026-10-16T00:00:00Z' }),
  );
  const job = await studio.createJob({ kind: 'video', prompt: 'the fox runs', fromItem: 'pic123' });
  assert.equal(job.status, 'queued');
  const wf = state.prompts[0];
  assert.equal(wf['20'].class_type, 'LoadImage');
  assert.equal(await fs.readFile(path.join(dir, 'input', wf['20'].inputs.image), 'utf8'), 'PNG');
  await assert.rejects(studio.createJob({ kind: 'video', prompt: 'x', fromItem: 'gone99' }), (err) => err.status === 404);
});
