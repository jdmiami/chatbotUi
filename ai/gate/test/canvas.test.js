import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createGate } from '../src/gate.js';
import { signJwt } from '../src/jwt.js';
import { BLOCKED_MESSAGE, PHOTO_MESSAGE, createStudio } from '../src/studio.js';
import { createLiveWorker } from '../src/live.js';
import { ANIMATE_MAKERS, FINISH_MAKER, canvasPicture, createCanvas } from '../src/canvas.js';
import { FILES as REAL, MAKERS } from '../src/workflows.js';

// Live Draw's engines (canvas.js) with a pretend canvas_worker.py (no graphics card in tests): the
// frame flow and its newest-only rule per socket, the content rules, loading, errors, the POST
// fallback, the sketch reader, Finish as a studio job, and the owner's and studio members' doors.

const SECRET = 'x'.repeat(40);
const quiet = { warn() {}, info() {} };
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG = `data:image/png;base64,${PNG_B64}`;
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]).toString('base64');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await wait(5);
  }
  throw new Error('timed out');
}

/**
 * A pretend canvas_worker.py: ready at once; `load` takes loadMs (with progress lines), `frame` frameMs;
 * pose on the fast engine answers its plain message; `crash()` ends it.
 */
function fakeWorker({ loadMs = 10, frameMs = 0, failLoad = null } = {}) {
  const made = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.requests = [];
    child.env = opts.env;
    child.kill = () => setImmediate(() => child.emit('exit', null, 'SIGTERM'));
    child.crash = () => setImmediate(() => child.emit('exit', 1, null));
    const say = (o) => child.stdout.write(`${JSON.stringify(o)}\n`);
    let buf = '';
    child.stdin.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const req = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        child.requests.push(req);
        if (req.op === 'load') {
          say({ engine: req.engine, state: 'loading' });
          say({ loading: `Downloading ${req.engine}: 1.0 of 2.0 GB`, engine: req.engine });
          setTimeout(() => {
            if (failLoad === req.engine) {
              say({ engine: req.engine, state: 'error', error: 'no space left' });
              return say({ id: req.id, error: 'no space left' });
            }
            say({ engine: req.engine, state: 'ready' });
            say({ id: req.id, ok: true, ms: loadMs });
          }, loadMs);
        } else if (req.op === 'frame') {
          setTimeout(() => {
            if (req.engine === 'fast' && req.pose) return say({ id: req.id, error: 'Pose works with the Members engine.', user: true });
            if (req.prompt === 'explode') return say({ id: req.id, error: 'CUDA error: device-side assert' });
            say({ id: req.id, image: WEBP, ms: 33 });
          }, frameMs);
        } else if (req.op === 'read') {
          say({ id: req.id, guesses: [{ label: 'Cat', prompt: 'a cat on a chair' }, { label: 'Nude schoolgirl', prompt: 'a nude schoolgirl' }, { label: 'Fox', prompt: 'a red fox' }, { label: 'Owl', prompt: 'an owl' }] });
        }
      }
    });
    setImmediate(() => {
      say({ loading: 'Starting the drawing engines' });
      say({ ready: true });
    });
    made.push(child);
    return child;
  };
  return { spawn, made };
}

async function fakePython() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-'));
  const python = path.join(dir, 'python');
  const script = path.join(dir, 'canvas_worker.py');
  await fs.writeFile(python, '');
  await fs.writeFile(script, '');
  return { python, script };
}

async function canvasWith(o = {}) {
  const fake = fakeWorker(o);
  const { python, script } = await fakePython();
  const calls = { activity: 0, room: 0 };
  let worker;
  const canvas = createCanvas({
    makeWorker: (onEvent) => (worker = createLiveWorker({ name: 'Live Draw engines', python, script, spawn: fake.spawn, onEvent, log: quiet, env: { HF_HOME: '/v/hf' } })),
    studio: o.studio || null,
    makeRoom: async () => void calls.room++,
    paused: () => o.paused?.() ?? null,
    activity: () => void calls.activity++,
    gpu: async () => ({ name: 'NVIDIA H200', memoryGb: 141 }),
    log: quiet,
  });
  return { canvas, fake, calls, worker: () => worker };
}

function page(canvas, opts) {
  const got = [];
  const conn = canvas.open((m) => got.push(m), opts);
  const next = async (pred) => {
    const match = typeof pred === 'string' ? (m) => m.type === pred : pred;
    await until(() => got.some(match));
    return got.splice(got.findIndex(match), 1)[0];
  };
  return { conn, got, next };
}

const frame = (extra = {}) => ({ type: 'frame', id: 1, engine: 'fast', mode: 'live', prompt: 'a cat', seed: 7, follow: 0.4, strength: 0.6, size: 512, sketch: PNG, ...extra });

test('pictures: PNG, JPEG or WebP data URLs or bare base64; anything else or too large is refused', () => {
  assert.equal(canvasPicture(PNG, 'drawing').b64, PNG_B64);
  assert.equal(canvasPicture(PNG_B64, 'drawing').kind, 'png');
  assert.equal(canvasPicture(`data:image/webp;base64,${WEBP}`, 'picture').kind, 'webp');
  assert.equal(canvasPicture(undefined, 'x'), null);
  assert.throws(() => canvasPicture(`data:image/webp;base64,${WEBP}`, 'drawing', { kinds: ['png'] }), /must be a PNG/);
  assert.throws(() => canvasPicture('data:image/gif;base64,R0lGODlh', 'drawing'), (e) => e.status === 400);
  assert.throws(() => canvasPicture(PNG, 'drawing', { max: 10 }), (e) => e.status === 413);
});

test('socket: the first frame starts loading its engine, says so, and is made as soon as the engine is ready', async () => {
  const { canvas, fake, calls, worker } = await canvasWith({ loadMs: 40 });
  const p = page(canvas);
  const s0 = await p.next('state');
  assert.deepEqual(s0.engines, { fast: 'off', licensed: 'off' });
  await p.conn.message(frame());
  const e = await p.next('error');
  assert.deepEqual([e.id, e.status, e.loading], [1, 503, true]);
  assert.match(e.error, /Fast engine is loading/);
  // Progress from the worker reaches the page.
  const loading = await p.next((m) => m.type === 'state' && /Downloading fast/.test(m.loading || ''));
  assert.equal(loading.engines.fast, 'loading');
  // Once ready, the newest refused frame is made without the page sending it again.
  const f = await p.next('frame');
  assert.equal(f.id, 1);
  assert.equal(f.ms, 33);
  assert.equal(f.image, `data:image/webp;base64,${WEBP}`);
  assert.deepEqual(canvas.engines(), { fast: 'ready', licensed: 'off' });
  const child = fake.made[0];
  assert.deepEqual(child.requests[0], { op: 'load', engine: 'fast', id: child.requests[0].id });
  const req = child.requests.find((r) => r.op === 'frame');
  assert.deepEqual(
    { engine: req.engine, mode: req.mode, prompt: req.prompt, seed: req.seed, follow: req.follow, strength: req.strength, size: req.size, sketch: req.sketch },
    { engine: 'fast', mode: 'live', prompt: 'a cat', seed: 7, follow: 0.4, strength: 0.6, size: 512, sketch: PNG_B64 },
  );
  assert.equal(calls.room, 1);
  assert.ok(calls.activity >= 1);
  // The worker never sees the gate's secrets; it gets its HF_HOME.
  assert.equal(child.env.GATEWAY_SECRET, undefined);
  assert.equal(child.env.HF_HOME, '/v/hf');
  // Both engines stay loaded once used.
  await p.conn.message({ type: 'warm', engine: 'licensed' });
  await until(() => canvas.engines().licensed === 'ready');
  assert.deepEqual(canvas.engines(), { fast: 'ready', licensed: 'ready' });
  p.conn.close();
  worker().close();
});

test('socket: only the newest frame waits; older waiting ones are dropped; each socket has its own lane', async () => {
  const { canvas, fake, worker } = await canvasWith({ frameMs: 40 });
  canvas.warm('fast');
  await until(() => canvas.engines().fast === 'ready');
  const a = page(canvas);
  const b = page(canvas);
  await Promise.all([
    a.conn.message(frame({ id: 1, prompt: 'one' })),
    (async () => {
      await wait(5);
      await Promise.all([a.conn.message(frame({ id: 2, prompt: 'two' })), a.conn.message(frame({ id: 3, prompt: 'three' })), b.conn.message(frame({ id: 9, prompt: 'other page' }))]);
    })(),
  ]);
  await until(() => a.got.filter((m) => m.type === 'frame').length === 2);
  assert.deepEqual(a.got.filter((m) => m.type === 'frame').map((m) => m.id), [1, 3]);
  assert.deepEqual(a.got.filter((m) => m.type === 'dropped').map((m) => m.id), [2]);
  assert.equal(b.got.find((m) => m.type === 'frame').id, 9);
  const prompts = fake.made[0].requests.filter((r) => r.op === 'frame').map((r) => r.prompt);
  assert.deepEqual(prompts.sort(), ['one', 'other page', 'three']);
  assert.equal(canvas.busy(), false);
  a.conn.close();
  b.conn.close();
  worker().close();
});

test('content rules: the words, each region’s words, and a style reference with sexual words are refused before any work', async () => {
  const { canvas, fake, worker } = await canvasWith();
  const p = page(canvas);
  const blocked = async (msg, message = BLOCKED_MESSAGE) => {
    await p.conn.message(msg);
    const e = await p.next('error');
    assert.equal(e.status, 422);
    assert.equal(e.blocked, true);
    assert.equal(e.error, message);
  };
  await blocked(frame({ prompt: 'nude schoolgirl' }));
  await blocked(frame({ prompt: 'a beach', regions: [{ mask: PNG, prompt: 'a fox' }, { mask: PNG, prompt: 'loli' }] }));
  // Split across the words and a region, still caught.
  await blocked(frame({ prompt: 'naked', regions: [{ mask: PNG, prompt: 'a little girl' }] }));
  await blocked(frame({ prompt: 'a sexy woman', ref: { image: PNG, weight: 0.5 } }), PHOTO_MESSAGE);
  // Shapes of the request.
  await p.conn.message(frame({ sketch: undefined }));
  assert.match((await p.next('error')).error, /drawing is missing/);
  await p.conn.message(frame({ mode: 'paint', base: PNG }));
  assert.match((await p.next('error')).error, /Paint over needs/);
  await p.conn.message(frame({ regions: [{ mask: PNG, prompt: '' }] }));
  assert.match((await p.next('error')).error, /own words/);
  await p.conn.message({ type: 'nope', id: 4 });
  assert.equal((await p.next('error')).status, 400);
  assert.equal(fake.made.length, 0, 'nothing reached the graphics card');
  p.conn.close();
  worker()?.close();
});

test('errors: a plain message from the worker, a crash, a failed load and a paused machine each answer plainly', async () => {
  let pausedWhy = null;
  const { canvas, fake, worker } = await canvasWith({ failLoad: 'licensed', paused: () => pausedWhy });
  canvas.warm('fast');
  await until(() => canvas.engines().fast === 'ready');
  const p = page(canvas);
  await p.conn.message(frame({ pose: PNG }));
  const user = await p.next('error');
  assert.deepEqual([user.status, user.error], [400, 'Pose works with the Members engine.']);
  await p.conn.message(frame({ prompt: 'explode' }));
  const crash = await p.next('error');
  assert.equal(crash.status, 503);
  assert.match(crash.error, /hit a problem: CUDA error/);
  // A licensed engine that can't load says why.
  canvas.warm('licensed');
  await until(() => canvas.engines().licensed === 'error');
  await p.conn.message(frame({ engine: 'licensed' }));
  const failed = await p.next((m) => m.type === 'error' && /could not load/.test(m.error));
  assert.match(failed.error, /Members engine could not load: no space left/);
  assert.equal((await canvas.state()).detail.licensed, 'no space left');
  pausedWhy = 'Your AI machine is making a video: Live Draw waits until it is done.';
  await p.conn.message(frame());
  const paused = await p.next('error');
  assert.deepEqual([paused.status, paused.paused], [409, true]);
  pausedWhy = null;
  // The worker crashing: engines are off again, and the next frame loads them again.
  fake.made[0].crash();
  await until(() => canvas.engines().fast === 'off');
  p.conn.close();
  worker().close();
});

test('sketch reader: guesses come back without anything the content rules refuse, at most three', async () => {
  const { canvas, fake, worker } = await canvasWith();
  const out = await canvas.read(PNG);
  assert.deepEqual(out.guesses, [
    { label: 'Cat', prompt: 'a cat on a chair' },
    { label: 'Fox', prompt: 'a red fox' },
    { label: 'Owl', prompt: 'an owl' },
  ]);
  assert.equal(fake.made[0].requests.find((r) => r.op === 'read').image, PNG_B64);
  assert.deepEqual(fake.made[0].requests[0], { op: 'load', engine: 'reader', id: fake.made[0].requests[0].id });
  assert.equal((await canvas.state()).reader, 'ready');
  await assert.rejects(canvas.read('nope'), (e) => e.status === 400);
  worker().close();
});

// ---- Finish: a normal studio job (Sketch finish), starting from the canvas picture

async function place(dir, file) {
  const p = path.join(dir, 'models', file.dir, file.name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const h = await fs.open(p, 'w');
  await h.truncate(file.size);
  await h.close();
}

async function studioSetup({ engines = ['canvas-fast', 'canvas-licensed', 'canvas-reader'] } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-studio-'));
  const FILES = { image: [{ dir: 'diffusion_models', name: 'img.safetensors', repo: 'o/r', path: 'img.safetensors', size: 4 }], video: [] };
  for (const f of FILES.image) await place(dir, f);
  for (const id of [FINISH_MAKER, ...engines]) for (const k of MAKERS.find((m) => m.id === id).files) await place(dir, REAL[k]);
  const state = { prompts: [] };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/system_stats') return Response.json({});
    if (u.pathname === '/prompt') {
      state.prompts.push(JSON.parse(init.body).prompt);
      return Response.json({ prompt_id: `p${state.prompts.length}` });
    }
    return Response.json({});
  };
  const studio = createStudio({ dir, comfy: 'http://127.0.0.1:8188', ollama: 'http://127.0.0.1:11434', role: 'canvas', files: FILES, fetchImpl, WebSocketImpl: null, log: quiet, retryMs: 20, nsfw: { check: async () => null } });
  return { dir, state, studio };
}

test('Finish: Sketch finish starts from the canvas picture and follows the strokes, laid on white', async () => {
  const s = await studioSetup();
  const { canvas, worker } = await canvasWith({ studio: s.studio });
  const job = await canvas.finish({ image: PNG, sketch: PNG, prompt: 'a fox in the snow', engine: 'fast', size: 'portrait', follow: 1 });
  assert.equal(job.maker, FINISH_MAKER);
  assert.equal(job.kind, 'image');
  const wf = s.state.prompts[0];
  assert.equal(wf[1].inputs.unet_name, REAL.zImageUnet.name);
  // The strokes (transparent PNG) go onto white before ControlNet reads them inverted.
  assert.equal(wf[16].class_type, 'EmptyImage');
  assert.deepEqual([wf[16].inputs.width, wf[16].inputs.height, wf[16].inputs.color], [1, 1, 0xffffff]);
  assert.deepEqual(wf[17].inputs.mask, ['5', 1]);
  assert.deepEqual(wf[6].inputs.image, ['18', 0]);
  // The canvas picture is where the picture starts (img2img), not noise.
  assert.equal(wf[21].class_type, 'VAEEncode');
  assert.deepEqual(wf[13].inputs.latent_image, ['21', 0]);
  assert.equal(wf[13].inputs.denoise, 0.7);
  assert.equal(wf[12], undefined);
  assert.notEqual(wf[19].inputs.image, wf[5].inputs.image);
  assert.deepEqual([wf[20].inputs.width, wf[20].inputs.height], [832, 1216]);
  assert.equal(wf[8].inputs.strength, 1);
  // Words the content rules refuse never become a job; nothing drawn is refused too.
  await assert.rejects(canvas.finish({ sketch: PNG, prompt: 'nsfw loli' }), (e) => e.blocked);
  await assert.rejects(canvas.finish({ prompt: 'a fox' }), /Draw something first/);
  worker()?.close();
});

test('state: engines, the live video makers behind Animate and Living canvas, Finish and the card', async () => {
  const s = await studioSetup();
  const { canvas, worker } = await canvasWith({ studio: s.studio });
  const st = await canvas.state();
  assert.deepEqual(st.engines, { fast: 'off', licensed: 'off' });
  assert.equal(st.finish, 'ready');
  // Not installed on this test machine (not wanted): off.
  assert.equal(st.animate, 'off');
  assert.equal(st.living, 'off');
  assert.deepEqual(st.gpu, { name: 'NVIDIA H200', memoryGb: 141 });
  assert.deepEqual(ANIMATE_MAKERS, { owner: 'live-krea', member: 'live-sdv2' });
  worker()?.close();
});

test('engines load from the studio’s catalog files: a missing maker says where to add it, and none is loaded', async () => {
  const s = await studioSetup({ engines: ['canvas-fast'] });
  const { canvas, fake, worker } = await canvasWith({ studio: s.studio });
  assert.equal(await s.studio.makerInstalled('canvas-fast'), true);
  canvas.warm('licensed');
  await until(() => canvas.engines().licensed === 'error');
  const st = await canvas.state();
  assert.match(st.detail.licensed, /The Members engine is not installed: add “Live Draw: Members engine” in the Store/);
  assert.equal(fake.made.length, 0, 'the worker was not even started for it');
  // The fast engine's files are here: it loads.
  canvas.warm('fast');
  await until(() => canvas.engines().fast === 'ready');
  // The catalog pins every Live Draw file to a commit (sizes are checked exactly).
  for (const id of ['canvas-fast', 'canvas-licensed', 'canvas-reader']) {
    for (const k of MAKERS.find((m) => m.id === id).files) {
      const f = REAL[k];
      assert.ok(f.url || /^[0-9a-f]{40}$/.test(f.revision || '') || f.repo === 'stabilityai/sd-turbo', `${id}: ${k} is pinned`);
      if (id !== 'canvas-fast') assert.match(f.dir, /^live\/canvas\//, `${k} lives with Live Draw's files`);
    }
  }
  worker().close();
});

// ---- the gate: owner's door (/_orbit/canvas) and studio members' door (/_studio/canvas)

async function gateWith(canvas) {
  const server = createGate({ secret: SECRET, webui: 'http://127.0.0.1:9', ollama: 'http://127.0.0.1:9', allowedOrigins: 'https://site.example', siteUrl: 'https://site.example', canvas }, quiet);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `127.0.0.1:${server.address().port}` };
}
const ownerToken = () => signJwt({ sub: 'owner', aud: 'orbit-ai' }, SECRET, { expiresIn: 600 });
const memberToken = (sub = 'ann') => signJwt({ sub, aud: 'studio-member' }, SECRET, { expiresIn: 600 });
const post = (base, p, body, token, origin) =>
  fetch(`http://${base}${p}`, { method: 'POST', body: JSON.stringify(body), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) } });

test('gate: POST /_orbit/canvas/frame is the socket’s fallback; it needs the owner’s token and an allowed origin', async () => {
  const { canvas, fake, worker } = await canvasWith();
  const { server, base } = await gateWith(canvas);
  try {
    const body = frame({ id: 5 });
    assert.equal((await post(base, '/_orbit/canvas/frame', body)).status, 401);
    assert.equal((await post(base, '/_orbit/canvas/frame', body, memberToken())).status, 401, 'a member key is not an owner token');
    assert.equal((await post(base, '/_orbit/canvas/frame', body, ownerToken(), 'https://evil.example')).status, 403);
    // First: the engine loads (503 + loading), then the frame comes back as a CanvasReply.
    const first = await post(base, '/_orbit/canvas/frame', body, ownerToken(), 'https://site.example');
    assert.equal(first.status, 503);
    assert.deepEqual(await first.json().then((j) => [j.type, j.id, j.loading]), ['error', 5, true]);
    await until(() => canvas.engines().fast === 'ready');
    const ok = await post(base, '/_orbit/canvas/frame', body, ownerToken(), 'https://site.example');
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { type: 'frame', id: 5, image: `data:image/webp;base64,${WEBP}`, ms: 33 });
    // The owner chooses the engine.
    await post(base, '/_orbit/canvas/warm', { engine: 'licensed' }, ownerToken());
    await until(() => canvas.engines().licensed === 'ready');
    assert.equal((await post(base, '/_orbit/canvas/frame', frame({ engine: 'licensed' }), ownerToken())).status, 200);
    assert.equal(fake.made[0].requests.filter((r) => r.op === 'frame').at(-1).engine, 'licensed');
    const blocked = await post(base, '/_orbit/canvas/frame', frame({ prompt: 'loli' }), ownerToken());
    assert.equal(blocked.status, 422);
    assert.equal((await blocked.json()).blocked, true);
    const st = await (await fetch(`http://${base}/_orbit/canvas`, { headers: { authorization: `Bearer ${ownerToken()}` } })).json();
    assert.deepEqual(st.engines, { fast: 'ready', licensed: 'ready' });
    assert.equal(st.animate, 'off');
    const read = await post(base, '/_orbit/canvas/read', { image: PNG }, ownerToken());
    assert.equal((await read.json()).guesses.length, 3);
    assert.equal((await post(base, '/_orbit/canvas/warm', { engine: 'turbo' }, ownerToken())).status, 400);
  } finally {
    server.close();
    worker().close();
  }
});

test('gate: a studio member always gets the licensed engine, can’t send a style reference, and their Finish is theirs', async () => {
  const s = await studioSetup();
  const { canvas, fake, worker } = await canvasWith({ studio: s.studio });
  const { server, base } = await gateWith(canvas);
  try {
    assert.equal((await post(base, '/_studio/canvas/frame', frame())).status, 401);
    assert.equal((await post(base, '/_studio/canvas/frame', frame(), ownerToken())).status, 401, 'the owner’s token is not a member key');
    // Asking for the fast engine: loads (and gets) the licensed one.
    const first = await post(base, '/_studio/canvas/frame', frame({ engine: 'fast' }), memberToken());
    assert.match((await first.json()).error, /Members engine is loading/);
    await until(() => canvas.engines().licensed === 'ready');
    const ok = await post(base, '/_studio/canvas/frame', frame({ engine: 'fast' }), memberToken());
    assert.equal((await ok.json()).type, 'frame');
    assert.deepEqual(fake.made[0].requests.filter((r) => r.op === 'load').map((r) => r.engine), ['licensed']);
    assert.deepEqual(fake.made[0].requests.filter((r) => r.op === 'frame').map((r) => r.engine), ['licensed']);
    assert.equal(canvas.engines().fast, 'off');
    await post(base, '/_studio/canvas/warm', { engine: 'fast' }, memberToken());
    await wait(30);
    assert.equal(canvas.engines().fast, 'off', 'warm is forced to licensed too');
    // No pictures of their own as a style reference.
    const ref = await post(base, '/_studio/canvas/frame', frame({ ref: { image: PNG, weight: 0.7 } }), memberToken());
    assert.equal(ref.status, 403);
    assert.match((await ref.json()).error, /Style references/);
    // Finish: tagged with the member, and they see only the member view of the job.
    const fin = await post(base, '/_studio/canvas/finish', { image: PNG, sketch: PNG, prompt: 'a fox', engine: 'fast' }, memberToken('ann'));
    assert.equal(fin.status, 200);
    const view = await fin.json();
    assert.ok(view.id && view.status);
    assert.equal(view.workflow, undefined);
    assert.equal(view.maker, undefined);
    assert.equal(s.studio.job(view.id).owner, 'm:ann');
    const st = await (await fetch(`http://${base}/_studio/canvas`, { headers: { authorization: `Bearer ${memberToken()}` } })).json();
    assert.equal(st.finish, 'ready');
  } finally {
    server.close();
    worker().close();
  }
});

test('gate: the Live Draw WebSockets take the token as a sub-protocol; members’ socket is licensed only', async () => {
  const { canvas, fake, worker } = await canvasWith();
  const { server, base } = await gateWith(canvas);
  const open = (p, protocols) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://${base}${p}`, protocols);
      const got = [];
      ws.onmessage = (ev) => got.push(JSON.parse(ev.data));
      ws.onopen = () => resolve({ ws, got });
      ws.onerror = () => resolve(null);
    });
  try {
    assert.equal(await open('/_orbit/canvas/live', ['orbit-live']), null, 'no token: refused');
    assert.equal(await open('/_orbit/canvas/live', ['orbit-live', memberToken()]), null, 'a member key on the owner’s socket: refused');
    assert.equal(await open('/_studio/canvas/live', ['orbit-live', ownerToken()]), null, 'the owner token on the member socket: refused');
    const status = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: Number(base.split(':')[1]), path: '/_orbit/canvas/live', headers: { connection: 'Upgrade', upgrade: 'websocket', origin: 'https://evil.example', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-protocol': `orbit-live, ${ownerToken()}` } });
      req.on('response', (res) => resolve(res.statusCode));
      req.on('upgrade', () => resolve(101));
      req.end();
    });
    assert.equal(status, 403);

    const owner = await open('/_orbit/canvas/live', ['orbit-live', ownerToken()]);
    assert.equal(owner.ws.protocol, 'orbit-live');
    await until(() => owner.got.some((m) => m.type === 'state'));
    owner.ws.send(JSON.stringify(frame({ id: 11 })));
    await until(() => owner.got.some((m) => m.type === 'frame' && m.id === 11));
    owner.ws.send(JSON.stringify(frame({ id: 12, prompt: 'loli' })));
    await until(() => owner.got.some((m) => m.type === 'error' && m.id === 12 && m.blocked));
    // A big frame arrives whole.
    owner.ws.send(JSON.stringify(frame({ id: 13, pad: 'x'.repeat(300_000) })));
    await until(() => owner.got.some((m) => m.type === 'frame' && m.id === 13));
    owner.ws.close();

    const member = await open('/_studio/canvas/live', ['orbit-live', memberToken()]);
    member.ws.send(JSON.stringify(frame({ id: 21, engine: 'fast' })));
    await until(() => member.got.some((m) => m.type === 'frame' && m.id === 21), 4000);
    assert.equal(fake.made[0].requests.filter((r) => r.op === 'frame').at(-1).engine, 'licensed');
    member.ws.send(JSON.stringify(frame({ id: 22, ref: { image: PNG } })));
    await until(() => member.got.some((m) => m.type === 'error' && m.id === 22 && m.status === 403));
    member.ws.close();
  } finally {
    server.close();
    worker().close();
  }
});
