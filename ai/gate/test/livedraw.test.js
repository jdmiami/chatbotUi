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
import { BLOCKED_MESSAGE, createStudio } from '../src/studio.js';
import { createLiveDraw, createLiveWorker, followToR, sketchBytes } from '../src/live.js';
import { decodeFrames, encodeClientFrame, encodeFrame } from '../src/wsock.js';
import { FILES as REAL, MAKERS, sketchStrength, zimageSketchWorkflow } from '../src/workflows.js';

// Live draw: a long-lived worker per live maker (fake ones here: no graphics card in tests), the
// gate's WebSocket and POST routes, the "newest drawing wins" rule, and Sketch finish through ComfyUI.

const SECRET = 'x'.repeat(40);
const quiet = { warn() {}, info() {} };
// A 1×1 PNG (the worker would get 512 × 512 from Orbit; the gate only checks it is a PNG).
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG = `data:image/png;base64,${PNG_B64}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

/**
 * A pretend Python worker: says ready (after `readyMs`), answers frames after `frameMs` with a fixed
 * JPEG, remembers every request; `crash()` ends it like a crash.
 */
function fakeSpawn({ readyMs = 0, frameMs = 0, failStart = false } = {}) {
  const made = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.requests = [];
    child.killed = false;
    child.env = opts.env;
    child.kill = () => {
      child.killed = true;
      setImmediate(() => child.emit('exit', null, 'SIGTERM'));
    };
    child.crash = () => {
      child.stderr.write('Traceback...\nRuntimeError: CUDA error: out of memory\n');
      setImmediate(() => child.emit('exit', 1, null));
    };
    let buf = '';
    child.stdin.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const req = JSON.parse(line);
        child.requests.push(req);
        setTimeout(() => child.stdout.write(`${JSON.stringify({ id: req.id, jpeg: JPEG.toString('base64'), ms: 42 })}\n`), frameMs);
      }
    });
    setTimeout(() => {
      if (failStart) return child.crash();
      child.stdout.write('{"loading": "Loading Live draw"}\n');
      child.stdout.write('{"ready": true}\n');
    }, readyMs);
    made.push({ cmd, args, child });
    return child;
  };
  return { spawn, made };
}

async function fakePython() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'live-'));
  const python = path.join(dir, 'python');
  const script = path.join(dir, 'worker.py');
  await fs.writeFile(python, '');
  await fs.writeFile(script, '');
  return { dir, python, script };
}

function liveDrawWith(o = {}) {
  const fake = fakeSpawn(o);
  return fakePython().then(({ python, script }) => {
    const worker = createLiveWorker({ name: 'Live draw', python, script, spawn: fake.spawn, idleMs: o.idleMs ?? 60_000, log: quiet, env: { LIVE_DRAW_LORA: '/x.pkl' } });
    const calls = { room: 0, activity: 0 };
    const draw = createLiveDraw({
      worker,
      installed: async () => o.installed ?? true,
      makeRoom: async () => void calls.room++,
      paused: () => o.paused?.() ?? null,
      activity: () => void calls.activity++,
    });
    return { draw, worker, fake, calls };
  });
}

test('websocket frames: masked client frames decode, fragments join, big ones are refused', () => {
  const one = decodeFrames(encodeClientFrame(1, 'hello'));
  assert.equal(one.frames[0].payload.toString(), 'hello');
  assert.equal(one.frames[0].opcode, 1);
  const big = Buffer.alloc(70_000, 7);
  const two = decodeFrames(Buffer.concat([encodeClientFrame(2, big), encodeClientFrame(9, '')]));
  assert.equal(two.frames.length, 2);
  assert.ok(two.frames[0].payload.equals(big));
  // A half-received frame waits for the rest.
  const whole = encodeClientFrame(1, 'x'.repeat(300));
  const part = decodeFrames(whole.subarray(0, 100));
  assert.equal(part.frames.length, 0);
  assert.equal(part.rest.length, 100);
  assert.throws(() => decodeFrames(encodeFrame(1, 'unmasked')), /masked/);
  assert.throws(() => decodeFrames(encodeClientFrame(2, big), { maxPayload: 1000 }), /too big/);
  const frag = decodeFrames(Buffer.concat([encodeClientFrame(1, 'ab', { fin: false }), encodeClientFrame(0, 'cd')]));
  assert.deepEqual(frag.frames.map((f) => [f.fin, f.opcode, f.payload.toString()]), [[false, 1, 'ab'], [true, 0, 'cd']]);
});

test('sketches: only PNGs, not too large; "Follow my lines" maps to pix2pix-turbo r and the ControlNet strength', () => {
  assert.ok(sketchBytes(PNG).length > 20);
  assert.ok(sketchBytes(PNG_B64).length > 20);
  assert.throws(() => sketchBytes('data:image/jpeg;base64,/9j/4AAQ'), /PNG/);
  assert.throws(() => sketchBytes(Buffer.concat([Buffer.from(PNG_B64, 'base64'), Buffer.alloc(5 * 1024 * 1024)])), /too large/);
  assert.equal(followToR(0), 0.25);
  assert.equal(followToR(1), 0.85);
  assert.equal(followToR('nope'), 0.55);
  assert.equal(sketchStrength(0), 0.65);
  assert.equal(sketchStrength(1), 1);
  assert.equal(sketchStrength(undefined), 0.86);
});

test('live worker: starts on first use, answers, makes room once, and its graphics memory is freed after quiet minutes', async () => {
  const { draw, fake, calls, worker } = await liveDrawWith({ idleMs: 80 });
  assert.equal(worker.state(), 'off');
  const out = await draw.frame({ prompt: 'a cat', follow: 0.5, seed: 7, image: PNG });
  assert.ok(out.jpeg.equals(JPEG));
  assert.equal(out.ms, 42);
  assert.equal(fake.made.length, 1);
  const req = fake.made[0].child.requests[0];
  assert.deepEqual({ op: req.op, prompt: req.prompt, r: req.r, seed: req.seed }, { op: 'frame', prompt: 'a cat', r: 0.55, seed: 7 });
  assert.equal(req.image, PNG_B64);
  // The worker never sees the gate's secrets.
  assert.equal(fake.made[0].child.env.GATEWAY_SECRET, undefined);
  assert.equal(fake.made[0].child.env.LIVE_DRAW_LORA, '/x.pkl');
  await draw.frame({ prompt: 'a cat', image: PNG });
  assert.equal(calls.room, 1, 'the graphics card is handed over once, not on every stroke');
  assert.equal(calls.activity, 2, 'every preview counts as using the machine');
  assert.equal(worker.state(), 'ready');
  // Unused for longer than idleMs: stopped (the check runs every idleMs / 4, at least 1 s).
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(worker.state(), 'off');
  assert.ok(fake.made[0].child.killed);
  // Drawing again starts it again (and makes room again).
  await draw.frame({ prompt: 'a dog', image: PNG });
  assert.equal(fake.made.length, 2);
  assert.equal(calls.room, 2);
  worker.close();
});

test('live draw: only the newest drawing waits; older waiting ones are dropped, never queued', async () => {
  const { draw, fake, worker } = await liveDrawWith({ frameMs: 60 });
  const a = draw.frame({ prompt: 'one', image: PNG });
  await new Promise((r) => setTimeout(r, 10));
  const b = draw.frame({ prompt: 'two', image: PNG });
  const c = draw.frame({ prompt: 'three', image: PNG });
  assert.equal(draw.busy(), true);
  const [ra, rb, rc] = await Promise.all([a, b, c]);
  assert.ok(ra.jpeg);
  assert.deepEqual(rb, { dropped: true });
  assert.ok(rc.jpeg);
  assert.deepEqual(fake.made[0].child.requests.map((r) => r.prompt), ['one', 'three']);
  assert.equal(draw.busy(), false);
  worker.close();
});

test('live draw: the content rule, a missing maker, a video being made and a crashed worker all answer plainly', async () => {
  let pausedWhy = null;
  const { draw, worker } = await liveDrawWith({ paused: () => pausedWhy });
  await assert.rejects(draw.frame({ prompt: 'nude schoolgirl', image: PNG }), (err) => err.status === 422 && err.blocked && err.message === BLOCKED_MESSAGE);
  await assert.rejects(draw.frame({ prompt: 'a cat', image: 'data:image/gif;base64,R0lGOD' }), (err) => err.status === 400);
  pausedWhy = 'Your AI machine is making a video: live previews wait until it is done.';
  await assert.rejects(draw.frame({ prompt: 'a cat', image: PNG }), (err) => err.status === 409 && err.paused);
  pausedWhy = null;
  worker.close();

  const missing = await liveDrawWith({ installed: false });
  await assert.rejects(missing.draw.frame({ prompt: 'a cat', image: PNG }), (err) => err.status === 503 && /not installed/.test(err.message));
  missing.worker.close();

  const broken = await liveDrawWith({ failStart: true });
  await assert.rejects(broken.draw.frame({ prompt: 'a cat', image: PNG }), (err) => err.status === 503 && /out of memory/.test(err.message));
  // It doesn't try again on every stroke.
  await assert.rejects(broken.draw.frame({ prompt: 'a cat', image: PNG }), (err) => err.status === 503);
  assert.equal(broken.fake.made.length, 1);
  const st = await broken.draw.state();
  assert.equal(st.worker, 'off');
  assert.match(st.error, /CUDA error: out of memory/);
  broken.worker.close();
});

test('live worker: no studio Python yet says so instead of crashing', async () => {
  const w = createLiveWorker({ name: 'Live draw', python: '/nope/python', script: '/nope.py', log: quiet });
  const out = await w.request({ op: 'frame' });
  assert.match(out.error, /Python is not installed yet/);
  w.close();
});

// ---- the gate: WebSocket and POST

async function gateWith(draw) {
  const server = createGate({ secret: SECRET, webui: 'http://127.0.0.1:9', ollama: 'http://127.0.0.1:9', allowedOrigins: 'https://site.example', siteUrl: 'https://site.example', liveDraw: draw }, quiet);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `127.0.0.1:${server.address().port}` };
}
const token = () => signJwt({ sub: 'owner', aud: 'orbit-ai' }, SECRET, { expiresIn: 600 });

test('gate: POST /_orbit/live/draw answers with the JPEG; it needs a token and an allowed origin', async () => {
  const { draw, worker } = await liveDrawWith();
  const { server, base } = await gateWith(draw);
  try {
    const body = JSON.stringify({ prompt: 'a cat', follow: 1, image: PNG });
    assert.equal((await fetch(`http://${base}/_orbit/live/draw`, { method: 'POST', body })).status, 401);
    const bad = await fetch(`http://${base}/_orbit/live/draw`, { method: 'POST', body, headers: { authorization: `Bearer ${token()}`, origin: 'https://evil.example' } });
    assert.equal(bad.status, 403);
    const res = await fetch(`http://${base}/_orbit/live/draw`, { method: 'POST', body, headers: { authorization: `Bearer ${token()}`, origin: 'https://site.example' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.equal(res.headers.get('x-live-ms'), '42');
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(JPEG));
    const blocked = await fetch(`http://${base}/_orbit/live/draw`, { method: 'POST', body: JSON.stringify({ prompt: 'loli', image: PNG }), headers: { authorization: `Bearer ${token()}` } });
    assert.equal(blocked.status, 422);
    assert.equal((await blocked.json()).blocked, true);
    const st = await (await fetch(`http://${base}/_orbit/live/draw`, { headers: { authorization: `Bearer ${token()}` } })).json();
    assert.equal(st.installed, true);
    assert.equal(st.worker, 'ready');
    assert.equal(st.lastMs, 42);
  } finally {
    server.close();
    worker.close();
  }
});

test('gate: the Live draw WebSocket takes the token as a sub-protocol and streams previews back', async () => {
  const { draw, worker } = await liveDrawWith({ frameMs: 30 });
  const { server, base } = await gateWith(draw);
  try {
    // No token: refused before the upgrade.
    const refused = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://${base}/_orbit/live/draw`, ['orbit-live']);
      ws.onerror = () => resolve(true);
      ws.onopen = () => resolve(false);
    });
    assert.equal(refused, true);
    const ws = new WebSocket(`ws://${base}/_orbit/live/draw`, ['orbit-live', token()]);
    const got = [];
    const next = () => new Promise((resolve) => got.length ? resolve(got.shift()) : (ws.onmessage = (ev) => resolve(JSON.parse(ev.data))));
    await new Promise((r, j) => {
      ws.onopen = r;
      ws.onerror = j;
    });
    assert.equal(ws.protocol, 'orbit-live');
    ws.send(JSON.stringify({ type: 'frame', id: 1, prompt: 'a cat', follow: 0.2, seed: 3, image: PNG_B64 }));
    const a = await next();
    assert.equal(a.type, 'frame');
    assert.equal(a.id, 1);
    assert.equal(a.ms, 42);
    assert.ok(Buffer.from(a.image.replace(/^data:image\/jpeg;base64,/, ''), 'base64').equals(JPEG));
    ws.send(JSON.stringify({ type: 'frame', id: 2, prompt: 'loli', image: PNG_B64 }));
    const b = await next();
    assert.deepEqual([b.type, b.id, b.status, b.blocked], ['error', 2, 422, true]);
    // A big drawing arrives in one piece (Chrome and Safari split large messages into frames).
    ws.send(JSON.stringify({ type: 'frame', id: 3, prompt: 'a cat', image: PNG_B64, pad: 'x'.repeat(200_000) }));
    assert.equal((await next()).id, 3);
    ws.send(JSON.stringify({ type: 'state' }));
    const s = await next();
    assert.equal(s.type, 'state');
    assert.equal(s.state.worker, 'ready');
    ws.close();
  } finally {
    server.close();
    worker.close();
  }
});

test('gate: an unknown origin cannot open the Live draw WebSocket, even with a token', async () => {
  const { draw, worker } = await liveDrawWith();
  const { server, base } = await gateWith(draw);
  try {
    const status = await new Promise((resolve) => {
      const req = http.request({ host: base.split(':')[0], port: Number(base.split(':')[1]), path: '/_orbit/live/draw', headers: { connection: 'Upgrade', upgrade: 'websocket', origin: 'https://evil.example', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-protocol': `orbit-live, ${token()}` } });
      req.on('response', (res) => resolve(res.statusCode));
      req.on('upgrade', () => resolve(101));
      req.on('error', () => resolve('error'));
      req.end();
    });
    assert.equal(status, 403);
  } finally {
    server.close();
    worker.close();
  }
});

// ---- Sketch finish: a normal ComfyUI job

async function place(dir, file) {
  const p = path.join(dir, 'models', file.dir, file.name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const h = await fs.open(p, 'w');
  await h.truncate(file.size);
  await h.close();
}

async function studioSetup({ nsfwScore = null } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sketch-'));
  const FILES = { image: [{ dir: 'diffusion_models', name: 'img.safetensors', repo: 'o/r', path: 'img.safetensors', size: 4 }], video: [] };
  for (const f of FILES.image) await place(dir, f);
  const state = { prompts: [], done: {}, nsfw: [] };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname !== '127.0.0.1') return new Response('no', { status: 404 });
    if (u.pathname === '/system_stats') return Response.json({});
    if (u.pathname === '/api/ps') return Response.json({ models: [] });
    if (u.pathname === '/prompt') {
      state.prompts.push(JSON.parse(init.body).prompt);
      return Response.json({ prompt_id: `p${state.prompts.length}` });
    }
    const h = /^\/history\/(p\d+)$/.exec(u.pathname);
    if (h && state.done[h[1]]) return Response.json({ [h[1]]: { status: { completed: true, status_str: 'success' }, outputs: { 15: { images: [{ filename: state.done[h[1]], subfolder: 'orbit', type: 'output' }] } } } });
    return Response.json({});
  };
  const nsfw = { check: async (p) => (state.nsfw.push(p), nsfwScore == null ? null : { nsfw: nsfwScore >= 0.35, score: nsfwScore }) };
  const studio = createStudio({ dir, role: 'canvas', comfy: 'http://127.0.0.1:8188', ollama: 'http://127.0.0.1:11434', files: FILES, fetchImpl, WebSocketImpl: null, log: quiet, retryMs: 20, nsfw });
  return { dir, state, studio };
}

async function finishJob({ dir, state, studio }, job) {
  const n = state.prompts.length;
  const file = `image-${job.id}_00001_.png`;
  await fs.mkdir(path.join(dir, 'output', 'orbit'), { recursive: true });
  await fs.writeFile(path.join(dir, 'output', 'orbit', file), 'png');
  state.done[`p${n}`] = file;
  await studio.poll();
  return studio.job(job.id);
}

test('store: Live draw and Sketch finish are makers like the others (sizes from the catalog, install and remove)', async () => {
  const s = await studioSetup();
  const list = await s.studio.makers();
  const live = list.find((m) => m.id === 'live-draw');
  const finish = list.find((m) => m.id === 'sketch-finish');
  assert.equal(live.kind, 'live');
  assert.equal(finish.kind, 'sketch');
  assert.equal(live.installed, false);
  const want = (id) => MAKERS.find((m) => m.id === id).files.reduce((n, k) => n + REAL[k].size, 0);
  assert.equal(live.size, want('live-draw'));
  assert.equal(finish.size, want('sketch-finish'));
  // Three files named config.json in different folders are three files.
  for (const k of MAKERS.find((m) => m.id === 'live-draw').files) await place(s.dir, REAL[k]);
  assert.equal(await s.studio.makerInstalled('live-draw'), true);
  assert.equal((await s.studio.makers()).find((m) => m.id === 'live-draw').installed, true);
  // A live maker is not a ComfyUI job.
  await assert.rejects(s.studio.createJob({ kind: 'image', maker: 'live-draw', prompt: 'x' }), /No such maker/);
});

test('Sketch finish: the drawing goes to ComfyUI as Z-Image + Fun ControlNet; the result is a normal gallery picture', async () => {
  const s = await studioSetup({ nsfwScore: 0.02 });
  for (const k of MAKERS.find((m) => m.id === 'sketch-finish').files) await place(s.dir, REAL[k]);
  await assert.rejects(s.studio.createJob({ kind: 'image', maker: 'sketch-finish', prompt: 'a fox' }), /Draw something first/);
  await assert.rejects(s.studio.createJob({ kind: 'image', maker: 'sketch-finish', prompt: '', image: PNG }), /Say what your drawing is/);
  await assert.rejects(s.studio.createJob({ kind: 'image', maker: 'sketch-finish', prompt: 'nsfw loli', image: PNG }), (err) => err.blocked);
  // A drawing is not a photo: the photo rule (no sexual content from real photos) doesn't apply to it.
  const job = await s.studio.createJob({ kind: 'image', maker: 'sketch-finish', prompt: 'a sexy fox', image: PNG, size: 'portrait', follow: 1 });
  const wf = s.state.prompts[0];
  assert.equal(wf[1].inputs.unet_name, REAL.zImageUnet.name);
  assert.equal(wf[4].inputs.name, REAL.zImageCnet.name);
  assert.equal(wf[8].inputs.strength, 1);
  assert.deepEqual([wf[12].inputs.width, wf[12].inputs.height], [832, 1216]);
  assert.match(wf[5].inputs.image, /^orbit-.+\.png$/);
  const done = await finishJob(s, job);
  assert.equal(done.status, 'done');
  assert.equal(done.item.maker, 'sketch-finish');
  assert.equal(done.item.photo, undefined);
  const items = await s.studio.items();
  assert.equal(items[0].id, job.id);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(s.state.nsfw.length, 1, 'the NSFW check looks at it like any picture');
});

test('Sketch finish: a drawing about children that comes out NSFW is thrown away before anyone sees it', async () => {
  const s = await studioSetup({ nsfwScore: 0.9 });
  for (const k of MAKERS.find((m) => m.id === 'sketch-finish').files) await place(s.dir, REAL[k]);
  const job = await s.studio.createJob({ kind: 'image', maker: 'sketch-finish', prompt: 'a little girl at the beach', image: PNG });
  const done = await finishJob(s, job);
  assert.equal(done.status, 'error');
  assert.equal(done.error, BLOCKED_MESSAGE);
  assert.equal((await s.studio.items()).length, 0);
  // The same NSFW score without children in the words: kept (and blurred, as everywhere).
  const s2 = await studioSetup({ nsfwScore: 0.9 });
  for (const k of MAKERS.find((m) => m.id === 'sketch-finish').files) await place(s2.dir, REAL[k]);
  const j2 = await s2.studio.createJob({ kind: 'image', maker: 'sketch-finish', prompt: 'a woman at the beach', image: PNG });
  assert.equal((await finishJob(s2, j2)).status, 'done');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await s2.studio.items())[0].nsfw, true);
});

test('Sketch finish recipe: the drawing is inverted to white lines on black and scaled to the picture size', () => {
  const wf = zimageSketchWorkflow({ prompt: 'x', sketch: 'orbit-a.png', width: 1216, height: 832, strength: 0.7, seed: 1 });
  assert.deepEqual(wf[6].inputs.image, ['5', 0]);
  assert.equal(wf[6].class_type, 'ImageInvert');
  assert.deepEqual([wf[7].inputs.width, wf[7].inputs.height, wf[7].inputs.crop], [1216, 832, 'center']);
  assert.deepEqual(wf[9].inputs.model, ['8', 0], 'ControlNet first, then AuraFlow sampling, as the ComfyUI blueprint');
  assert.deepEqual([wf[13].inputs.steps, wf[13].inputs.cfg, wf[13].inputs.sampler_name], [8, 1, 'res_multistep']);
});
