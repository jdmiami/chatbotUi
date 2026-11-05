import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStudio } from '../src/studio.js';
import { FILES as REAL, MAKERS } from '../src/workflows.js';
import { wantsThumb } from '../src/thumbs.js';

// 3D objects: one picture in, a .glb out (TRELLIS.2 with colours, or the Hunyuan3D 2.1 shape), kept in
// the gallery as its own kind with the picture it came from as its poster.

const FILES = {
  image: [
    { dir: 'diffusion_models', name: 'img.safetensors', repo: 'o/r', path: 'img.safetensors', size: 4 },
    { dir: 'text_encoders', name: 'te.safetensors', repo: 'o/r', path: 'te.safetensors', size: 4 },
    { dir: 'vae', name: 'vae.safetensors', repo: 'o/r', path: 'vae.safetensors', size: 4 },
  ],
  video: [{ dir: 'checkpoints', name: 'vid.safetensors', repo: 'o/r', path: 'vid.safetensors', size: 4 }],
};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function place(dir, file) {
  const p = path.join(dir, 'models', file.dir, file.name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const h = await fs.open(p, 'w');
  await h.truncate(file.size);
  await h.close();
}

/** A ComfyUI that takes each prompt, "saves" a .glb where SaveGLB says, and reports it done. */
function fakeComfy(dir, state) {
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'huggingface.co') return new Response('nope', { status: 404 });
    if (u.pathname === '/system_stats') return Response.json({});
    if (u.pathname === '/api/ps') return Response.json({ models: [] });
    if (u.pathname === '/prompt') {
      const { prompt } = JSON.parse(init.body);
      state.prompts.push(prompt);
      const save = Object.values(prompt).find((n) => n.class_type === 'SaveGLB');
      const id = `p${state.prompts.length}`;
      const rel = `${save.inputs.filename_prefix}_00001_.glb`;
      await fs.mkdir(path.dirname(path.join(dir, 'output', rel)), { recursive: true });
      await fs.writeFile(path.join(dir, 'output', rel), 'glTF');
      state.done[id] = { status: { completed: true, status_str: 'success' }, outputs: { 300: { '3d': [{ filename: path.basename(rel), subfolder: path.dirname(rel), type: 'output' }] } } };
      return Response.json({ prompt_id: id });
    }
    const h = u.pathname.match(/^\/history\/(.+)$/);
    if (h) return Response.json(state.done[h[1]] ? { [h[1]]: state.done[h[1]] } : {});
    if (u.pathname === '/queue') return Response.json({ queue_running: [], queue_pending: [] });
    return Response.json({});
  };
}

const node = (wf, type) => Object.values(wf).find((n) => n.class_type === type);
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('3D object: one picture in, a .glb in the gallery with its picture as the poster; no picture, no job', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'model3d-'));
  for (const f of [...FILES.image, ...FILES.video]) await place(dir, f);
  const state = { prompts: [], done: {} };
  const studio = createStudio({ dir, files: FILES, fetchImpl: fakeComfy(dir, state), WebSocketImpl: null, log: { warn() {}, info() {} }, pollMs: 50, statfs: async () => ({ bavail: 1e7, bsize: 1024 ** 2 }), nsfwDelayMs: 1e9 });
  studio.start();
  const trellis = MAKERS.find((m) => m.id === 'trellis2');
  assert.equal(trellis.kind, 'model3d');
  await studio.installMaker('trellis2');
  for (const k of trellis.files) await place(dir, REAL[k]);
  await studio.installMaker('hy3d');
  await place(dir, REAL.hy3d21);

  await assert.rejects(studio.createJob({ maker: 'trellis2' }), /Add the picture/);

  const job = await studio.createJob({ maker: 'trellis2', image: PNG });
  assert.equal(job.kind, 'model3d');
  assert.equal(job.prompt, '3D object', 'no words needed');
  const wf = state.prompts[0];
  assert.equal(node(wf, 'UNETLoader').inputs.unet_name, REAL.trellisUnet.name);
  assert.equal(node(wf, 'LoadBackgroundRemovalModel').inputs.bg_removal_name, REAL.birefnet.name);
  assert.equal(node(wf, 'RemeshMesh').inputs['sign_mode.qef'], false, 'a choice’s own settings use dotted names');
  assert.deepEqual(node(wf, 'SaveGLB').inputs.mesh, ['252', 0], 'the painted mesh is what is saved');

  const done = await until(async () => {
    const j = studio.job(job.id);
    return j?.status === 'done' ? j : null;
  });
  assert.match(done.item.file, /\.glb$/);
  assert.match(done.item.poster, new RegExp(`${job.id}-poster\\.png$`));
  assert.ok(await fs.stat(path.join(dir, 'output', done.item.poster)), 'the picture is kept next to it');
  assert.equal(wantsThumb(done.item), true, 'its thumbnail comes from the poster');
  const listed = (await studio.items()).find((it) => it.id === job.id);
  assert.equal(listed.kind, 'model3d');
  assert.equal((await studio.file(job.id)).type, 'model/gltf-binary');

  // The quicker shape maker: Hunyuan3D 2.1's own checkpoint and its picture reader.
  const shape = await studio.createJob({ maker: 'hy3d', image: PNG });
  await until(() => state.prompts.length === 2);
  assert.equal(node(state.prompts[1], 'ImageOnlyCheckpointLoader').inputs.ckpt_name, REAL.hy3d21.name);
  assert.ok(node(state.prompts[1], 'VoxelToMesh'));
  await studio.cancel(shape.id);

  // Removing it removes the poster too.
  await studio.remove(job.id);
  assert.equal(await fs.stat(path.join(dir, 'output', done.item.poster)).catch(() => null), null);
});

test('the rigger: a gallery 3D object in, a rigged one out with the same poster; it runs as its own program', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rig-'));
  for (const f of [...FILES.image, ...FILES.video]) await place(dir, f);
  const state = { prompts: [], done: {} };
  const runs = [];
  // The rigger's Python, faked: writes the rigged .glb where it is told.
  let failNext = false;
  const runRig = (args, opts) => {
    runs.push({ args, cwd: opts.cwd, secret: opts.env.GATEWAY_SECRET });
    const out = args[args.indexOf('--output') + 1];
    const listeners = {};
    const err = new EventEmitter();
    const child = { stdout: null, stderr: err, kill() {}, on: (ev, fn) => (listeners[ev] = fn) };
    const fail = failNext;
    failNext = false;
    setTimeout(async () => {
      if (fail === 'nobones') {
        err.emit('data', Buffer.from('  File "src/model/tokenrig.py", line 395, in predict_step\n    assert res.skin_pred is not None\nAssertionError\n'));
        return listeners.close?.(1, null);
      }
      if (fail) {
        err.emit('data', Buffer.from("[Main] bpy_server.py started (pid=42)\nModuleNotFoundError: No module named 'scipy'\n"));
        err.emit('data', Buffer.from('RuntimeError: bpy_server failed to start\n'));
        return listeners.close?.(1, null);
      }
      await fs.writeFile(out, 'glTF-rigged');
      listeners.close?.(0, null);
    }, 30);
    return child;
  };
  let envReady = false;
  const liveEnvs = { root: path.join(dir, 'live-env'), ready: () => envReady, state: () => ({ ready: envReady }), ensure() {}, busy: () => false };
  process.env.GATEWAY_SECRET = 'not-for-the-rigger';
  const studio = createStudio({ dir, files: FILES, fetchImpl: fakeComfy(dir, state), WebSocketImpl: null, log: { warn() {}, info() {} }, pollMs: 50, statfs: async () => ({ bavail: 1e7, bsize: 1024 ** 2 }), nsfwDelayMs: 1e9, liveEnvs, runRig });
  studio.start();
  await studio.installMaker('trellis2');
  for (const k of MAKERS.find((m) => m.id === 'trellis2').files) await place(dir, REAL[k]);
  const made = await studio.createJob({ maker: 'trellis2', image: PNG });
  const obj = await until(async () => (studio.job(made.id)?.status === 'done' ? studio.job(made.id).item : null));

  await studio.installMaker('rig');
  await assert.rejects(studio.createJob({ maker: 'rig', fromItem: obj.id }), /being set up/, 'not until its Python is ready');
  envReady = true;
  await assert.rejects(studio.createJob({ maker: 'rig', fromItem: 'nosuchitem1' }), /3D object/);

  const job = await studio.createJob({ maker: 'rig', fromItem: obj.id });
  assert.equal(job.kind, 'model3d');
  const done = await until(async () => {
    const j = studio.job(job.id);
    return j?.status === 'done' || j?.status === 'error' ? j : null;
  });
  assert.equal(done.status, 'done', done.error);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].cwd, path.join(dir, 'live-env', 'rig', 'src'));
  assert.ok(runs[0].args.includes('--use_transfer'), 'keeps its textures and scale');
  assert.equal(runs[0].secret, undefined, 'the gate’s secrets never reach it');
  assert.equal(state.prompts.length, 1, 'nothing went to ComfyUI for the rig');
  assert.equal(done.item.rigged, true);
  assert.match(done.item.prompt, /^Rigged: /);
  assert.equal(await fs.readFile(path.join(dir, 'output', done.item.file), 'utf8'), 'glTF-rigged');
  assert.ok(await fs.stat(path.join(dir, 'output', done.item.poster)), 'the same poster comes along');

  // When it can't: the plain reason for Orbit, its own last lines as the job's detail (seen on a real
  // machine: its Blender helper died at start for want of scipy, and nothing said why).
  failNext = true;
  const bad = await studio.createJob({ maker: 'rig', fromItem: obj.id });
  const failed = await until(async () => (studio.job(bad.id)?.status === 'error' ? studio.job(bad.id) : null));
  assert.equal(failed.error, 'The rigger could not rig this object.');
  assert.match(failed.detail, /No module named 'scipy'/);
  assert.match(failed.detail, /bpy_server failed to start/);

  // A skeleton but no full skin (an axe, on a real machine): says what to try in plain words.
  failNext = 'nobones';
  const axe = await studio.createJob({ maker: 'rig', fromItem: obj.id });
  const noBones = await until(async () => (studio.job(axe.id)?.status === 'error' ? studio.job(axe.id) : null));
  assert.match(noBones.error, /couldn't find a full set of bones.*people, animals and creatures/);
  delete process.env.GATEWAY_SECRET;
});

test('a 3D object and a sharpen ignore words left in the box: they use only the picture', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'm3d-words-'));
  const state = { prompts: [] };
  const studio = createStudio({ dir, files: FILES, fetchImpl: fakeComfy(dir, state), WebSocketImpl: null, log: { warn() {}, info() {} }, pollMs: 50, statfs: async () => ({ bavail: 1e7, bsize: 1024 ** 2 }), nsfwDelayMs: 1e9 });
  studio.start();
  await studio.installMaker('trellis2');
  for (const k of MAKERS.find((m) => m.id === 'trellis2').files) await place(dir, REAL[k]);
  // Words that would trip the photo rule for a picture edit are not read for a 3D object.
  const job = await studio.createJob({ maker: 'trellis2', image: PNG, prompt: 'a sexy bikini model, naked' });
  assert.ok(job.id, 'the job is accepted');
  assert.equal(job.prompt, '3D object');
});
