import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createGate } from '../src/gate.js';
import { signJwt } from '../src/jwt.js';
import { createLiveWorker } from '../src/live.js';
import { CANVAS_KREA_GPU_BYTES, SAVE_SECONDS, TURBO_MESSAGE, createLiveEnvs, createLiveServer, createLiveVideo, frameBytes, liveEnvStamp, measuredFps, sageWorks } from '../src/livevideo.js';
import { packb, unpackb } from '../src/msgpack.js';
import { BLOCKED_MESSAGE, PHOTO_MESSAGE, createStudio } from '../src/studio.js';
import { acceptWebSocket } from '../src/wsock.js';
import { FILES as REAL, MAKERS } from '../src/workflows.js';

// Live video: StreamDiffusionV2 (a fake worker here) and Krea Realtime (a fake of Krea's own
// msgpack WebSocket server), their own Pythons (live_env.sh, faked), the Turbo-only rule, the
// gate's /_orbit/live/video, and "Save last 10 s". No graphics card in tests: no speeds measured.

const SECRET = 'x'.repeat(40);
const quiet = { warn() {}, info() {} };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 0xff, 0xd9]);
const J64 = JPEG.toString('base64');
const OUT = (n) => Buffer.from([0xff, 0xd8, n, 0xff, 0xd9]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await wait(10);
  }
  throw new Error('timed out');
}

test('msgpack: maps, strings, bytes, numbers and nesting round-trip (Krea’s server speaks it)', () => {
  const v = { prompt: 'a fox ✨', width: 832, strength: 0.7, neg: -3, big: 100000, bigneg: -70000, on: true, off: false, none: null, image: Buffer.alloc(300, 7), list: [1, 'two', [3]], long: 'x'.repeat(70000) };
  const back = unpackb(packb(v));
  assert.deepEqual({ ...back, image: null }, { ...v, image: null });
  assert.ok(Buffer.from(back.image).equals(v.image));
  assert.equal(packb({ a: 1 }).toString('hex'), '81a16101');
  assert.throws(() => unpackb(Buffer.from([0x92, 1])), /truncated/);
});

test('store pages: Krea says plainly it is Turbo-only and non-commercial; licences and unmeasured speeds are stated', () => {
  const CATALOG = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8'));
  const k = CATALOG.makers['live-krea'];
  assert.match(k.license, /CC BY-NC-SA 4\.0/);
  assert.match(k.license, /non-commercial/);
  assert.match(k.license, /Apache 2\.0/);
  assert.match(k.gpu, /Turbo machine \(H100, 80 GB\) only/);
  assert.match(k.speed, /Not measured/);
  assert.equal(CATALOG.makerDefs.find((m) => m.id === 'live-krea').turboOnly, true);
  const s = CATALOG.makers['live-sdv2'];
  assert.match(s.license, /Apache 2\.0/);
  assert.match(s.speed, /Not measured/);
  assert.equal(REAL.kreaRealtime.size, 28577102160);
});

test('frames: only pictures; the save rate follows how fast frames really came back', () => {
  assert.ok(frameBytes(`data:image/jpeg;base64,${J64}`).equals(JPEG));
  assert.ok(frameBytes(J64));
  assert.equal(frameBytes('data:image/jpeg;base64,AAAA'), null);
  assert.equal(frameBytes(42), null);
  assert.equal(measuredFps([{ at: 0 }, { at: 125 }, { at: 250 }, { at: 375 }, { at: 500 }]), 8);
  assert.equal(measuredFps([{ at: 0 }]), 8);
  assert.equal(measuredFps([{ at: 0 }, { at: 10 }, { at: 20 }, { at: 30 }, { at: 40 }]), 30);
});

// ---- a pretend StreamDiffusionV2 worker: buffers frames, answers one restyled frame per frame after 5
function fakeSdv2() {
  const made = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.requests = [];
    child.env = opts.env;
    child.kill = () => setImmediate(() => child.emit('exit', null, 'SIGTERM'));
    let have = 0;
    let n = 0;
    let buf = '';
    child.stdin.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const req = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        child.requests.push(req);
        const frames = [];
        if (req.op === 'frames') {
          have += req.frames.length;
          while (have >= 5) {
            have -= 4;
            frames.push(OUT(++n).toString('base64'));
          }
        }
        setTimeout(() => child.stdout.write(`${JSON.stringify({ id: req.id, frames, ms: 40 * frames.length, need: 4 })}\n`), 5);
      }
    });
    setTimeout(() => child.stdout.write('{"ready": true}\n'), 1);
    made.push(child);
    return child;
  };
  return { spawn, made };
}

async function place(dir, file) {
  const p = path.join(dir, 'models', file.dir, file.name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const h = await fs.open(p, 'w');
  await h.truncate(file.size);
  await h.close();
}

/** A studio with fake ComfyUI and the live makers' files in place; envs "ready" unless told. */
async function setup({ gpu = 48e9, envReady = true, install = ['live-sdv2', 'live-krea'], kreaUrl = 'ws://127.0.0.1:9', krea, turboBytes, holdMs } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'livevideo-'));
  const FILES = { image: [{ dir: 'diffusion_models', name: 'img.safetensors', repo: 'o/r', path: 'img.safetensors', size: 4 }], video: [] };
  await place(dir, FILES.image[0]);
  for (const id of install) for (const k of MAKERS.find((m) => m.id === id).files) await place(dir, REAL[k]);
  const envRuns = [];
  const envSpawn = (cmd, args, opts) => {
    envRuns.push({ cmd, args, env: opts.env });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setTimeout(async () => {
      child.stdout.write(`[live-env ${args[1]}] installing its packages\n`);
      if (args[1] === 'krea' && envFails) {
        child.stderr.write('ERROR: no matching distribution\n');
        return child.emit('exit', 1);
      }
      await fs.mkdir(path.join(dir, 'live-env', args[1]), { recursive: true });
      await fs.writeFile(path.join(dir, 'live-env', args[1], '.installed'), 'ok');
      child.emit('exit', 0);
    }, 20);
    return child;
  };
  let envFails = false;
  const envs = createLiveEnvs({ dir, script: '/opt/gate/live_env.sh', spawn: envSpawn, log: quiet });
  if (envReady) for (const n of ['sdv2', 'krea']) {
    await fs.mkdir(path.join(dir, 'live-env', n), { recursive: true });
    await fs.writeFile(path.join(dir, 'live-env', n, '.installed'), 'ok');
  }
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/system_stats') return Response.json({});
    if (u.pathname === '/api/ps') return Response.json({ models: [] });
    if (u.pathname === '/free') return Response.json({});
    return Response.json({});
  };
  const ffmpegCalls = [];
  const nsfw = { check: async () => ({ nsfw: false, score: 0.01 }) };
  const studio = createStudio({ dir, files: FILES, fetchImpl, WebSocketImpl: null, log: quiet, liveEnvs: envs, gpuMemory: async () => gpu, turboMessage: TURBO_MESSAGE, nsfw });
  const sd = fakeSdv2();
  const made = { draw: 0 };
  const video = createLiveVideo({
    studio,
    envs,
    sdv2Worker: () => createLiveWorker({ name: 'StreamDiffusionV2', python: process.execPath, script: process.execPath, spawn: sd.spawn, log: quiet }),
    krea: krea || createLiveServer({ name: 'Krea Realtime', cmd: 'none', args: [], url: 'http://127.0.0.1:9', spawn: () => new EventEmitter(), log: quiet }),
    kreaUrl,
    gpuMemory: async () => gpu,
    turboBytes,
    holdMs,
    makeWay: async () => void made.draw++,
    ffmpeg: async (args) => {
      ffmpegCalls.push(args);
      await fs.writeFile(args.at(-1), 'mp4');
    },
    log: quiet,
  });
  return { dir, studio, envs, envRuns, video, sd, ffmpegCalls, made, fail: () => (envFails = true) };
}

function page(video) {
  const got = [];
  const conn = video.open((m) => got.push(m));
  const next = async (type) => {
    await until(() => got.some((m) => m.type === type));
    return got.splice(got.findIndex((m) => m.type === type), 1)[0];
  };
  return { conn, got, next };
}

test('store: the live video makers set up their own Python once their files are here; Krea is Turbo-only', async () => {
  const s = await setup({ envReady: false, install: ['live-sdv2'] });
  let list = await s.studio.makers();
  const sd = list.find((m) => m.id === 'live-sdv2');
  assert.equal(sd.kind, 'live');
  assert.equal(sd.installed, false, 'files alone are not enough');
  assert.equal(sd.percent, 99);
  await s.studio.installMaker('live-sdv2');
  await until(() => s.envRuns.length === 1);
  assert.deepEqual(s.envRuns[0].args, ['/opt/gate/live_env.sh', 'sdv2']);
  assert.equal(s.envRuns[0].env.GATEWAY_SECRET, undefined);
  await until(async () => (await s.studio.makers()).find((m) => m.id === 'live-sdv2').installed);
  assert.equal(await s.studio.makerInstalled('live-sdv2'), true);
  // Both share the Wan 1.3B files: one entry each, downloaded once.
  const krea = MAKERS.find((m) => m.id === 'live-krea');
  assert.ok(MAKERS.find((m) => m.id === 'live-sdv2').files.filter((k) => krea.files.includes(k)).includes('wan13T5'));
  // Krea Realtime on the Standard machine (48 GB): refused before 30 GB come down.
  await assert.rejects(s.studio.installMaker('live-krea'), (err) => err.status === 409 && err.turbo && err.message === TURBO_MESSAGE);
  list = await s.studio.makers();
  assert.equal(list.find((m) => m.id === 'live-krea').wanted, false);
  assert.equal(list.find((m) => m.id === 'live-krea').turboOnly, true);
  // Removing it removes its Python too.
  await s.studio.removeMaker('live-sdv2');
  assert.equal(s.envs.ready('sdv2'), false);
});

test('store: Krea Realtime installs on the Turbo machine (80 GB); a failed setup says so plainly', async () => {
  const s = await setup({ gpu: 80e9, envReady: false, install: ['live-krea'] });
  s.fail();
  await s.studio.installMaker('live-krea');
  await until(() => s.envs.state('krea').error);
  const k = (await s.studio.makers()).find((m) => m.id === 'live-krea');
  assert.equal(k.installed, false);
  assert.match(k.problem, /Setting up its Python failed/);
});

test('StreamDiffusionV2: camera frames go to the worker, restyled frames come back; words change while it runs', async () => {
  const s = await setup();
  const p = page(s.video);
  await p.conn.message({ type: 'start', maker: 'live-sdv2', source: 'camera', prompt: 'a watercolour painting', strength: 0.6 });
  assert.equal((await p.next('state')).state, 'loading');
  assert.equal((await p.next('state')).state, 'live');
  assert.equal(s.made.draw, 1, 'Live draw lets go of the graphics card first');
  for (let i = 0; i < 9; i++) await p.conn.message({ type: 'frame', image: `data:image/jpeg;base64,${J64}` });
  const f = await p.next('frame');
  assert.match(f.image, /^data:image\/jpeg;base64,/);
  await until(() => p.got.filter((m) => m.type === 'frame').length >= 1);
  const w = s.sd.made[0];
  const frames = w.requests.filter((r) => r.op === 'frames');
  assert.equal(frames[0].prompt, 'a watercolour painting');
  assert.equal(frames[0].strength, 0.6);
  assert.equal(frames.reduce((n, r) => n + r.frames.length, 0), 9);
  // New words: sent with the next frames (the worker starts a new session for them).
  await p.conn.message({ type: 'prompt', prompt: 'a pencil sketch' });
  assert.equal((await p.next('prompt')).prompt, 'a pencil sketch');
  await p.conn.message({ type: 'frame', image: J64 });
  await until(() => w.requests.at(-1).prompt === 'a pencil sketch');
  // The camera shows real people: the photo rule holds for its words.
  await p.conn.message({ type: 'prompt', prompt: 'make her naked' });
  const e = await p.next('error');
  assert.equal(e.error, PHOTO_MESSAGE);
  assert.equal(s.video.busy(), true);
  await p.conn.message({ type: 'stop' });
  assert.equal((await p.next('state')).state, 'stopped');
  p.conn.close();
});

test('StreamDiffusionV2: words only is Krea’s; blocked words and a missing maker are refused', async () => {
  const s = await setup({ install: [] });
  const p = page(s.video);
  await p.conn.message({ type: 'start', maker: 'live-sdv2', source: 'text', prompt: 'a fox' });
  assert.match((await p.next('error')).error, /Krea Realtime/);
  await p.conn.message({ type: 'start', maker: 'live-sdv2', source: 'canvas', prompt: 'loli' });
  const b = await p.next('error');
  assert.equal(b.error, BLOCKED_MESSAGE);
  assert.equal(b.blocked, true);
  await p.conn.message({ type: 'start', maker: 'live-sdv2', source: 'canvas', prompt: 'a fox' });
  assert.match((await p.next('error')).error, /not installed/);
});

test('Save last 10 s: the frames that came back become a gallery video (ffmpeg), checked like any video', async () => {
  const s = await setup();
  const p = page(s.video);
  await p.conn.message({ type: 'start', maker: 'live-sdv2', source: 'camera', prompt: 'a claymation world' });
  await p.next('state');
  await p.next('state');
  for (let i = 0; i < 13; i++) {
    await p.conn.message({ type: 'frame', image: J64 });
    await wait(15);
  }
  await until(() => p.got.filter((m) => m.type === 'frame').length >= 3);
  await p.conn.message({ type: 'save' });
  const saved = await p.next('saved');
  assert.equal(saved.item.kind, 'video');
  assert.equal(saved.item.maker, 'live-sdv2');
  assert.equal(saved.item.prompt, 'a claymation world');
  assert.equal(saved.item.photo, true, 'from the camera: the photo rule follows it into the gallery');
  const args = s.ffmpegCalls[0];
  assert.ok(args.includes('libx264') && args.includes('yuv420p'));
  assert.match(args.at(-1), /output\/orbit\/live-.+\.mp4$/);
  const items = await s.studio.items();
  assert.equal(items[0].id, saved.item.id);
  assert.ok(SAVE_SECONDS === 10);
  p.conn.close();
});

test('a video job takes the graphics card: live video stops and says why', async () => {
  const s = await setup();
  const p = page(s.video);
  await p.conn.message({ type: 'start', maker: 'live-sdv2', source: 'canvas', prompt: 'neon' });
  await p.next('state');
  await p.next('state');
  s.video.release();
  assert.match((await p.next('error')).error, /started making a video/);
  assert.equal(s.video.state().running, false);
});

// ---- Krea Realtime: a fake of Krea's own server (GET /health, msgpack WebSocket at /session/<id>)
async function fakeKrea() {
  const seen = { params: null, frames: [], prompts: [] };
  const srv = http.createServer((req, res) => {
    if (req.url === '/health') return res.end('{"status":"ok"}');
    res.writeHead(404).end();
  });
  srv.on('upgrade', (req, socket, head) => {
    const ws = acceptWebSocket(req, socket, head);
    ws.send(JSON.stringify({ status: 'ready', worker: 'fake' }));
    let n = 0;
    ws.on('message', (data) => {
      const m = unpackb(data);
      if (!seen.params) {
        seen.params = m;
        // Words only: it starts making frames by itself.
        if (!m.webcam_mode) for (let i = 0; i < 3; i++) ws.send(OUT(++n));
        return;
      }
      if (m.prompt) seen.prompts.push(m.prompt);
      if (m.image) {
        seen.frames.push(m);
        ws.send(OUT(++n));
      }
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, seen, port: srv.address().port };
}

test('Krea Realtime: refuses the Standard machine; on Turbo starts Krea’s server and streams video from words', async () => {
  const k = await fakeKrea();
  const spawned = [];
  const server = createLiveServer({
    name: 'Krea Realtime',
    cmd: '/venv/python',
    args: ['-m', 'uvicorn', 'release_server:app'],
    url: `http://127.0.0.1:${k.port}`,
    spawn: (cmd, args, opts) => {
      spawned.push({ cmd, args, env: opts.env });
      const c = new EventEmitter();
      c.kill = () => {};
      return c;
    },
    pollMs: 10,
    log: quiet,
  });
  const standard = await setup({ gpu: 48e9, kreaUrl: `ws://127.0.0.1:${k.port}`, krea: server });
  const p0 = page(standard.video);
  await p0.conn.message({ type: 'start', maker: 'live-krea', source: 'text', prompt: 'a fox in the snow' });
  assert.equal((await p0.next('error')).error, TURBO_MESSAGE);
  assert.equal(spawned.length, 0);

  const s = await setup({ gpu: 80e9, kreaUrl: `ws://127.0.0.1:${k.port}`, krea: server });
  const p = page(s.video);
  await p.conn.message({ type: 'start', maker: 'live-krea', source: 'text', prompt: 'a fox in the snow' });
  assert.equal((await p.next('state')).state, 'loading');
  assert.equal((await p.next('state')).state, 'live');
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].env.GATEWAY_SECRET, undefined);
  await until(() => p.got.filter((m) => m.type === 'frame').length === 3);
  assert.deepEqual(
    { prompt: k.seen.params.prompt, webcam: k.seen.params.webcam_mode, w: k.seen.params.width, h: k.seen.params.height, steps: k.seen.params.num_denoising_steps },
    { prompt: 'a fox in the snow', webcam: false, w: 832, h: 480, steps: 4 },
  );
  // New words while it runs: sent to Krea, which blends to them.
  await p.conn.message({ type: 'prompt', prompt: 'a fox in the rain' });
  await until(() => k.seen.prompts.includes('a fox in the rain'));
  await p.conn.message({ type: 'stop' });
  p.conn.close();

  // The camera: its frames go up as msgpack bytes and come back restyled.
  k.seen.params = null;
  const p2 = page(s.video);
  await p2.conn.message({ type: 'start', maker: 'live-krea', source: 'camera', prompt: 'oil painting', strength: 0.5 });
  await p2.next('state');
  await p2.next('state');
  await p2.conn.message({ type: 'frame', image: J64 });
  await p2.next('frame');
  assert.equal(k.seen.params.webcam_mode, true);
  assert.equal(k.seen.params.strength, 0.5);
  assert.ok(Buffer.from(k.seen.frames.at(-1).image).equals(JPEG));
  p2.conn.close();
  server.close();
  k.srv.close();
});

test('gate: /_orbit/live/video is a signed-in WebSocket', async () => {
  const s = await setup();
  const server = createGate({ secret: SECRET, webui: 'http://127.0.0.1:9', ollama: 'http://127.0.0.1:9', allowedOrigins: 'https://site.example', liveVideo: s.video }, quiet);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `127.0.0.1:${server.address().port}`;
  try {
    const refused = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://${base}/_orbit/live/video`, ['orbit-live']);
      ws.onerror = () => resolve(true);
      ws.onopen = () => resolve(false);
    });
    assert.equal(refused, true);
    const token = signJwt({ sub: 'o', aud: 'orbit-ai' }, SECRET, { expiresIn: 600 });
    const ws = new WebSocket(`ws://${base}/_orbit/live/video`, ['orbit-live', token]);
    const got = [];
    ws.onmessage = (ev) => got.push(JSON.parse(ev.data));
    await new Promise((r, j) => {
      ws.onopen = r;
      ws.onerror = j;
    });
    ws.send(JSON.stringify({ type: 'start', maker: 'live-sdv2', source: 'camera', prompt: 'a comic book' }));
    await until(() => got.some((m) => m.type === 'state' && m.state === 'live'));
    for (let i = 0; i < 5; i++) ws.send(JSON.stringify({ type: 'frame', image: J64 }));
    await until(() => got.some((m) => m.type === 'frame'));
    ws.close();
  } finally {
    server.close();
  }
});

// ---- Live Draw: Animate and Living canvas are live video started from the canvas picture

const STILL = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7, 0xff, 0xd9]);
const DRAWN = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 8, 8, 8, 0xff, 0xd9]);

test('Live Draw: a session started from a still picture keeps sending it until the canvas sends frames', async () => {
  const s = await setup({ holdMs: 10 });
  const p = page(s.video);
  await p.conn.message({ type: 'start', maker: 'live-sdv2', source: 'canvas', prompt: 'a watercolour', image: `data:image/jpeg;base64,${STILL.toString('base64')}` });
  await p.next('state');
  await p.next('state');
  // Nothing sent by the page: the picture goes up again and again, and video comes back.
  await p.next('frame');
  const w = s.sd.made[0];
  const sent = () => w.requests.filter((r) => r.op === 'frames').flatMap((r) => r.frames);
  assert.ok(sent().length >= 5);
  assert.ok(sent().every((f) => f === STILL.toString('base64')));
  // The person draws: the canvas's frames go up, and its last one is held when they stop.
  await p.conn.message({ type: 'frame', image: DRAWN.toString('base64') });
  await until(() => sent().filter((f) => f === DRAWN.toString('base64')).length >= 3);
  // A new kept picture to hold.
  await p.conn.message({ type: 'still', image: STILL.toString('base64') });
  const before = sent().length;
  await until(() => sent().length > before + 2 && sent().at(-1) === STILL.toString('base64'));
  await p.conn.message({ type: 'stop' });
  await p.next('state');
  const after = sent().length;
  await wait(60);
  assert.ok(sent().length <= after + 1, 'stopped: nothing more is sent');
  // Not a picture: refused at start.
  await p.conn.message({ type: 'start', maker: 'live-sdv2', source: 'canvas', prompt: 'a fox', image: 'data:image/gif;base64,R0lGOD' });
  assert.match((await p.next('error')).error, /not a picture/);
  p.conn.close();
});

test('Live Draw: on the drawing machine Krea Realtime only has to fit (40 GB), and starts from the canvas picture', async () => {
  const k = await fakeKrea();
  const server = createLiveServer({
    name: 'Krea Realtime',
    cmd: '/venv/python',
    args: [],
    url: `http://127.0.0.1:${k.port}`,
    spawn: () => Object.assign(new EventEmitter(), { kill() {} }),
    pollMs: 10,
    log: quiet,
  });
  // The RTX PRO 6000 backup (96 GB) and the H200 (141 GB) both pass; 32 GB doesn't.
  const small = await setup({ gpu: 32e9, turboBytes: CANVAS_KREA_GPU_BYTES, kreaUrl: `ws://127.0.0.1:${k.port}`, krea: server });
  const p0 = page(small.video);
  await p0.conn.message({ type: 'start', maker: 'live-krea', source: 'canvas', prompt: 'a fox' });
  assert.equal((await p0.next('error')).error, TURBO_MESSAGE);
  for (const gpu of [96e9, 141e9]) {
    k.seen.params = null;
    k.seen.frames = [];
    const s = await setup({ gpu, turboBytes: CANVAS_KREA_GPU_BYTES, kreaUrl: `ws://127.0.0.1:${k.port}`, krea: server, holdMs: 10 });
    const p = page(s.video);
    await p.conn.message({ type: 'start', maker: 'live-krea', source: 'canvas', prompt: 'the fox runs', strength: 0.6, image: STILL.toString('base64') });
    assert.equal((await p.next('state')).state, 'loading');
    assert.equal((await p.next('state')).state, 'live');
    await until(() => k.seen.frames.length >= 3);
    assert.equal(k.seen.params.webcam_mode, true);
    assert.equal(k.seen.params.strength, 0.6);
    assert.ok(k.seen.frames.every((f) => Buffer.from(f.image).equals(STILL)));
    await p.next('frame');
    await p.conn.message({ type: 'stop' });
    p.conn.close();
  }
  server.close();
  k.srv.close();
});

test('Live Draw: a studio member’s live video door is StreamDiffusionV2 from their canvas, and the clip is theirs', async () => {
  const s = await setup({ holdMs: 10 });
  const server = createGate({ secret: SECRET, webui: 'http://127.0.0.1:9', ollama: 'http://127.0.0.1:9', allowedOrigins: 'https://site.example', liveVideo: s.video, canvas: { open() {} } }, quiet);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `127.0.0.1:${server.address().port}`;
  const open = (p, protocols) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://${base}${p}`, protocols);
      const got = [];
      ws.onmessage = (ev) => got.push(JSON.parse(ev.data));
      ws.onopen = () => resolve({ ws, got });
      ws.onerror = () => resolve(null);
    });
  try {
    const owner = signJwt({ sub: 'o', aud: 'orbit-ai' }, SECRET, { expiresIn: 600 });
    assert.equal(await open('/_studio/canvas/video', ['orbit-live', owner]), null, 'the owner token is not a member key');
    const member = signJwt({ sub: 'ann', aud: 'studio-member' }, SECRET, { expiresIn: 600 });
    const c = await open('/_studio/canvas/video', ['orbit-live', member]);
    // Asks for Krea and the camera: gets StreamDiffusionV2 and the canvas.
    c.ws.send(JSON.stringify({ type: 'start', maker: 'live-krea', source: 'camera', prompt: 'a comic book', image: STILL.toString('base64') }));
    await until(() => c.got.some((m) => m.type === 'state' && m.state === 'live'));
    const live = c.got.find((m) => m.state === 'live');
    assert.deepEqual([live.maker, live.source], ['live-sdv2', 'canvas']);
    await until(() => c.got.filter((m) => m.type === 'frame').length >= 2);
    c.ws.send(JSON.stringify({ type: 'save' }));
    await until(() => c.got.some((m) => m.type === 'saved'));
    const saved = c.got.find((m) => m.type === 'saved');
    assert.equal(saved.item.owner, 'm:ann');
    assert.equal(saved.item.photo, undefined, 'a drawing, not a camera');
    c.ws.close();
  } finally {
    server.close();
  }
});

test('live envs: a Python set up for an older live_env.sh (another PyTorch) is not ready: it is set up again', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'liveenv-'));
  const script = path.join(dir, 'live_env.sh');
  await fs.writeFile(
    script,
    [
      '#!/usr/bin/env bash',
      'name="${1:?which}"',
      'S="${STUDIO_DIR:?required}"',
      'UV_VERSION=0.12.24',
      'SDV2_TORCH="torch==2.11.0 torchvision==0.26.0"',
      'EXTRA=""',
      'case "$name" in',
      '  sdv2) COMMIT=abc EXTRA="$SDV2_TORCH cu128" ;;',
      '  krea) COMMIT=def ;;',
      '  *) exit 2 ;;',
      'esac',
      'STAMP="$name $COMMIT uv $UV_VERSION${EXTRA:+ $EXTRA}"',
      'echo should not run',
      'exit 1',
    ].join('\n'),
  );
  assert.equal(liveEnvStamp(script, 'sdv2'), 'sdv2 abc uv 0.12.24 torch==2.11.0 torchvision==0.26.0 cu128');
  assert.equal(liveEnvStamp(script, 'krea'), 'krea def uv 0.12.24');
  assert.equal(liveEnvStamp(path.join(dir, 'missing.sh'), 'sdv2'), null);
  // The real script reads the same way.
  assert.match(liveEnvStamp(new URL('../../live_env.sh', import.meta.url).pathname, 'sdv2'), /^sdv2 [0-9a-f]{40} uv [\d.]+ torch==2\.11\.0 .*cu128$/);
  const envs = createLiveEnvs({ dir, script, log: quiet });
  await fs.mkdir(path.join(dir, 'live-env', 'sdv2'), { recursive: true });
  await fs.writeFile(path.join(dir, 'live-env', 'sdv2', '.installed'), 'sdv2 abc uv 0.12.24\n');
  assert.equal(envs.ready('sdv2'), false, 'the old PyTorch 2.6 setup');
  await fs.writeFile(path.join(dir, 'live-env', 'sdv2', '.installed'), 'sdv2 abc uv 0.12.24 torch==2.11.0 torchvision==0.26.0 cu128\n');
  assert.equal(envs.ready('sdv2'), true);
  assert.equal(envs.ready('krea'), false);
});

test('Krea’s SageAttention: tried once with Krea’s Python; a card without its kernel falls back', async () => {
  const runs = [];
  const fakeSpawn = (code) => (cmd, args, opts) => {
    runs.push({ cmd, args, env: opts.env });
    const c = new EventEmitter();
    c.kill = () => {};
    setImmediate(() => c.emit('exit', code));
    return c;
  };
  assert.equal(await sageWorks({ python: '/k/python', spawn: fakeSpawn(0) }), true);
  assert.equal(await sageWorks({ python: '/k/python', spawn: fakeSpawn(1) }), false);
  assert.equal(runs[0].cmd, '/k/python');
  assert.match(runs[0].args[1], /from sageattention import sageattn/);
  assert.equal(runs[0].env.GATEWAY_SECRET, undefined);
  const hung = (cmd, args, opts) => Object.assign(new EventEmitter(), { kill() {} });
  assert.equal(await sageWorks({ python: '/k/python', spawn: hung, timeoutMs: 20 }), false);
});
