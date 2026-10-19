import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PHOTO_MESSAGE, blockedForPhoto, createStudio } from '../src/studio.js';
import { FILES as REAL, MAKERS, h3Length } from '../src/workflows.js';

const FILES = {
  image: [
    { dir: 'diffusion_models', name: 'img.safetensors', repo: 'o/r', path: 'img.safetensors', size: 4 },
    { dir: 'text_encoders', name: 'te.safetensors', repo: 'o/r', path: 'te.safetensors', size: 4 },
    { dir: 'vae', name: 'vae.safetensors', repo: 'o/r', path: 'vae.safetensors', size: 4 },
  ],
  video: [{ dir: 'checkpoints', name: 'vid.safetensors', repo: 'o/r', path: 'vid.safetensors', size: 4 }],
};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function fakeServices(state) {
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'huggingface.co') return new Response('nope', { status: 404 });
    const body = init.body ? JSON.parse(init.body) : null;
    if (u.pathname === '/system_stats') return Response.json({});
    if (u.pathname === '/api/ps') return Response.json({ models: [] });
    if (u.pathname === '/prompt') {
      state.prompts.push(body.prompt);
      return Response.json({ prompt_id: `p${state.prompts.length}` });
    }
    return Response.json({});
  };
}

/** A model file that looks fully downloaded (sparse: takes no disk space). */
async function place(dir, file) {
  const p = path.join(dir, 'models', file.dir, file.name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const h = await fs.open(p, 'w');
  await h.truncate(file.size);
  await h.close();
}

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'makers-'));
  for (const f of [...FILES.image, ...FILES.video]) await place(dir, f);
  const state = { prompts: [] };
  const studio = createStudio({ dir, files: FILES, fetchImpl: fakeServices(state), WebSocketImpl: null, log: { warn() {} }, retryMs: 20 });
  return { dir, state, studio };
}
/** Start a job and stop it right away, so the next one goes straight to ComfyUI (one at a time). */
async function make(studio, req) {
  const job = await studio.createJob(req);
  await studio.cancel(job.id);
  return job;
}
const byId = (list, id) => list.find((m) => m.id === id);
const node = (wf, type) => Object.values(wf).find((n) => n.class_type === type);

test('maker list: built-ins are installed; the rest are offered with their size', async () => {
  const { studio } = await setup();
  const list = await studio.makers();
  assert.equal(list.length, MAKERS.length);
  assert.deepEqual(
    ['qwen', 'ltx', 'edit'].map((id) => [byId(list, id).installed, byId(list, id).builtIn]),
    [
      [true, true],
      [true, true],
      [true, true],
    ],
  );
  const krea = byId(list, 'krea-real');
  assert.equal(krea.installed, false);
  assert.equal(krea.wanted, false);
  assert.equal(krea.size, REAL.kreaNoct.size + REAL.kreaTe.size + REAL.kreaVae.size);
  assert.equal(byId(list, 'style-darkbrush').for, 'krea-real');
  assert.equal(byId(list, 'outfit').twoImages, true);
});

test('install remembers the choice; a maker works once its files are there', async () => {
  const { dir, state, studio } = await setup();
  await assert.rejects(studio.createJob({ maker: 'krea-real', prompt: 'a lighthouse' }), (e) => e.status === 503 && /not installed/.test(e.message));
  await studio.installMaker('krea-real');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'makers.json'), 'utf8')).wanted, ['krea-real']);
  assert.equal(byId(await studio.makers(), 'krea-real').wanted, true);
  await assert.rejects(studio.createJob({ maker: 'krea-real', prompt: 'a lighthouse' }), /still downloading/);
  for (const k of ['kreaNoct', 'kreaTe', 'kreaVae']) await place(dir, REAL[k]);
  const job = await make(studio, { maker: 'krea-real', prompt: 'a lighthouse', size: 'landscape' });
  assert.equal(job.maker, 'krea-real');
  const wf = state.prompts[0];
  assert.equal(node(wf, 'UNETLoader').inputs.unet_name, REAL.kreaNoct.name);
  assert.equal(node(wf, 'CLIPLoader').inputs.type, 'krea2');
  assert.deepEqual([node(wf, 'EmptyLatentImage').inputs.width, node(wf, 'EmptyLatentImage').inputs.height], [1536, 1024]);
  assert.equal(node(wf, 'LoraLoaderModelOnly'), undefined);

  // A style needs installing too, and only fits its own maker.
  await assert.rejects(studio.createJob({ maker: 'krea-real', prompt: 'x', style: 'style-darkbrush' }), /not installed/);
  await studio.installMaker('style-darkbrush');
  await place(dir, MAKERS.find((m) => m.id === 'style-darkbrush').loraFile);
  await make(studio, { maker: 'krea-real', prompt: 'x', style: 'style-darkbrush' });
  assert.equal(node(state.prompts[1], 'LoraLoaderModelOnly').inputs.lora_name, 'krea2_darkbrush.safetensors');
  await assert.rejects(studio.createJob({ maker: 'qwen', prompt: 'x', style: 'style-darkbrush' }), /not for this maker/);
});

test('H3 Max: video with sound at H3 sizes and lengths, from text or a picture', async () => {
  const { dir, state, studio } = await setup();
  await studio.installMaker('h3-max');
  for (const k of ['h3Unet', 'h3Te', 'h3Vae', 'h3AudioVae']) await place(dir, REAL[k]);
  await make(studio, { maker: 'h3-max', prompt: 'waves at night', size: 'portrait', seconds: 5 });
  let v = node(state.prompts[0], 'MiniMaxH3ImageToVideo').inputs;
  assert.deepEqual([v.width, v.height, v.length, v.first_frame], [704, 1280, h3Length(5), undefined]);
  const job = await make(studio, { maker: 'h3-max', prompt: 'she turns and smiles', image: PNG });
  assert.equal(job.kind, 'video');
  v = node(state.prompts[1], 'MiniMaxH3ImageToVideo').inputs;
  assert.ok(v.first_frame);
  assert.match(node(state.prompts[1], 'LoadImage').inputs.image, /^orbit-.*\.png$/);
});

test('edit with words, outfit swap and new angle; uploaded photos are never made sexual', async () => {
  const { dir, state, studio } = await setup();
  await assert.rejects(studio.createJob({ maker: 'edit', prompt: 'make the sky purple' }), /Add the picture/);
  await make(studio, { maker: 'edit', prompt: 'make the sky purple', image: PNG });
  const enc = node(state.prompts[0], 'TextEncodeQwenImage21').inputs;
  assert.ok(enc['images.image_1']);
  assert.deepEqual(node(state.prompts[0], 'KSampler').inputs.latent_image, ['5', 2]);

  for (const p of ['remove her clothes', 'make her nude', 'undress him', 'see-through dress', 'sexy lingerie']) {
    await assert.rejects(studio.createJob({ maker: 'edit', prompt: p, image: PNG }), (e) => e.status === 422 && e.message === PHOTO_MESSAGE, p);
  }
  assert.equal(blockedForPhoto('put a red hat on him'), false);

  await studio.installMaker('outfit');
  await place(dir, REAL.outfitLora);
  await assert.rejects(studio.createJob({ maker: 'outfit', prompt: 'swap', image: PNG }), /two pictures/);
  await make(studio, { maker: 'outfit', prompt: 'Dress the person in image 1 in the jacket from image 2.', images: [PNG, PNG] });
  const last = state.prompts.at(-1);
  assert.equal(node(last, 'LoraLoaderModelOnly').inputs.lora_name, REAL.outfitLora.name);
  assert.ok(node(last, 'TextEncodeQwenImage21').inputs['images.image_2']);

  await studio.installMaker('angles');
  await place(dir, REAL.anglesLora);
  const a = await make(studio, { maker: 'angles', prompt: 'back view, eye-level shot', image: PNG });
  assert.equal(a.prompt, '<mva> back view, eye-level shot');
});

test('sharpen needs only a picture; removing a maker deletes only files nothing else uses', async () => {
  const { dir, state, studio } = await setup();
  await studio.installMaker('sharpen');
  await place(dir, REAL.esrgan);
  const j = await make(studio, { maker: 'sharpen', image: PNG });
  assert.equal(j.prompt, 'Sharpened 4×');
  assert.ok(node(state.prompts[0], 'ImageUpscaleWithModel'));

  await studio.installMaker('outfit');
  await place(dir, REAL.outfitLora);
  await studio.removeMaker('outfit');
  const gone = await fs.stat(path.join(dir, 'models', 'loras', REAL.outfitLora.name)).catch(() => null);
  assert.equal(gone, null, 'its own LoRA is deleted');
  assert.ok(await fs.stat(path.join(dir, 'models', 'diffusion_models', 'img.safetensors')), 'the shared Qwen model stays');
  await assert.rejects(studio.removeMaker('qwen'), /comes with the machine/);
  assert.equal(byId(await studio.makers(), 'outfit').wanted, false);
});

test('memory: ComfyUI is cleared before a video and after one, not between pictures', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'makers-'));
  for (const f of [...FILES.image, ...FILES.video]) await place(dir, f);
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'huggingface.co') return new Response('nope', { status: 404 });
    if (u.pathname === '/free' || u.pathname === '/prompt') calls.push(u.pathname);
    if (u.pathname === '/prompt') return Response.json({ prompt_id: `p${calls.length}` });
    if (u.pathname === '/api/ps') return Response.json({ models: [] });
    return Response.json({});
  };
  const studio = createStudio({ dir, files: FILES, fetchImpl, WebSocketImpl: null, log: { warn() {} }, retryMs: 20 });
  await make(studio, { kind: 'image', prompt: 'a cat' });
  await make(studio, { kind: 'image', prompt: 'a dog' });
  assert.deepEqual(calls, ['/prompt', '/prompt']);
  await make(studio, { kind: 'video', prompt: 'waves' });
  await make(studio, { kind: 'video', prompt: 'more waves' });
  await make(studio, { kind: 'image', prompt: 'a bird' });
  assert.deepEqual(calls, ['/prompt', '/prompt', '/free', '/prompt', '/free', '/prompt', '/free', '/prompt']);
});
