import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { BLOCKED_MESSAGE, CHECK_MESSAGE, PHOTO_MESSAGE, SWAP_MINOR_MESSAGE, SWAP_NSFW_MESSAGE, blockedSwap, createStudio } from '../src/studio.js';
import { FILES as REAL, MAKERS, SWAP_FPS, SWAP_MAX_FRAMES } from '../src/workflows.js';

// Swap a person: a video, words saying who to replace, a photo of the new person (and a face
// close-up if you have one). Its safety rules: a real person's photo is never made sexual, never
// goes into a video marked NSFW, children are never swapped, and the result is checked before
// anyone sees it.

const FILES = {
  image: [{ dir: 'diffusion_models', name: 'img.safetensors', repo: 'o/r', path: 'img.safetensors', size: 4 }],
  video: [{ dir: 'checkpoints', name: 'vid.safetensors', repo: 'o/r', path: 'vid.safetensors', size: 4 }],
};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const quiet = { warn() {}, info() {} };

async function place(dir, file) {
  const p = path.join(dir, 'models', file.dir, file.name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const h = await fs.open(p, 'w');
  await h.truncate(file.size);
  await h.close();
}

/** A studio with a pretend ComfyUI, ffmpeg and ffprobe (a "video" is a JSON note of what ffprobe says). */
async function setup({ install = ['person-swap'], nsfw } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'swap-'));
  for (const f of [...FILES.image, ...FILES.video]) await place(dir, f);
  const state = { prompts: [], ffmpeg: [], done: {} };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'huggingface.co') return new Response('nope', { status: 404 });
    if (u.pathname === '/system_stats') return Response.json({});
    if (u.pathname === '/api/ps') return Response.json({ models: [] });
    if (u.pathname === '/prompt') {
      state.prompts.push(JSON.parse(init.body).prompt);
      return Response.json({ prompt_id: `p${state.prompts.length}` });
    }
    const h = /^\/history\/(p\d+)$/.exec(u.pathname);
    if (h && state.done[h[1]]) {
      return Response.json({ [h[1]]: { status: { completed: true, status_str: 'success' }, outputs: { 63: { images: [{ filename: state.done[h[1]], subfolder: 'orbit', type: 'output' }] } } } });
    }
    return Response.json({});
  };
  const probe = async (file) => {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      return null;
    }
  };
  const ffmpeg = async (args) => {
    state.ffmpeg.push(args);
    await fs.writeFile(args.at(-1), 'out');
  };
  const studio = createStudio({ dir, files: FILES, fetchImpl, WebSocketImpl: null, log: quiet, retryMs: 20, probe, ffmpeg, nsfw, statfs: async () => ({ bavail: 1e6, bsize: 1024 ** 2 }) });
  for (const id of install) for (const k of MAKERS.find((m) => m.id === id).files) await place(dir, REAL[k]);
  return { dir, state, studio };
}

const VIDEO = { video: true, audio: true, width: 1920, height: 1080, fps: 30, seconds: 8 };
const upload = (studio, info, type = 'video/mp4') => studio.saveMedia(Readable.from([Buffer.from(JSON.stringify(info))]), type);
async function galleryItem(dir, id, extra = {}) {
  await fs.mkdir(path.join(dir, 'output', 'orbit'), { recursive: true });
  const video = (extra.kind ?? 'video') === 'video';
  await fs.writeFile(path.join(dir, 'output', 'orbit', `${id}.${video ? 'mp4' : 'png'}`), video ? JSON.stringify({ ...VIDEO, width: 1280, height: 720, seconds: 5 }) : 'png');
  await fs.writeFile(
    path.join(dir, 'output', 'orbit', `${id}.json`),
    JSON.stringify({ id, kind: 'video', prompt: 'a street at night', width: 1280, height: 720, seconds: 5, file: `orbit/${id}.${video ? 'mp4' : 'png'}`, createdAt: '2026-10-20T00:00:00Z', ...extra }),
  );
}
async function make(studio, req) {
  const job = await studio.createJob(req);
  await studio.cancel(job.id);
  return job;
}
const node = (wf, type) => Object.values(wf).find((n) => n.class_type === type);
const arg = (args, flag) => args[args.indexOf(flag) + 1];
const refused = (message) => (e) => e.status === 422 && e.message === message;

test('store: Swap a person says what it needs, and only adds its own two files to a machine with VACE', async () => {
  const { studio } = await setup({ install: [] });
  const list = await studio.makers();
  const swap = list.find((m) => m.id === 'person-swap');
  assert.equal(swap.kind, 'videoedit');
  assert.equal(swap.name, 'Swap a person');
  assert.deepEqual(swap.needs, ['video', 'target', 'photo']);
  assert.deepEqual(swap.accepts, ['facePhoto']);
  assert.equal(swap.installed, false);
  assert.equal(swap.size, REAL.swapUnet.size + REAL.swapLora.size + REAL.wanTe.size + REAL.wanVae.size + REAL.sam3.size);
  // With VACE's files there, only the model and its LoRA are missing.
  const { studio: withVace } = await setup({ install: ['vace'] });
  const s2 = (await withVace.makers()).find((m) => m.id === 'person-swap');
  assert.equal(s2.installed, false);
  const { studio: both } = await setup({ install: ['vace', 'person-swap'] });
  assert.equal((await both.makers()).find((m) => m.id === 'person-swap').installed, true);
});

test('Swap a person: the video at 16 fps inside 832 × 480, who to replace found from words, the photo and a face close-up', async () => {
  const { dir, state, studio } = await setup();
  const v = await upload(studio, VIDEO);
  await assert.rejects(studio.createJob({ maker: 'person-swap', target: 'the man', image: PNG }), /Add the video/);
  await assert.rejects(studio.createJob({ maker: 'person-swap', videoUpload: v.id, image: PNG }), /Say who to replace/);
  await assert.rejects(studio.createJob({ maker: 'person-swap', videoUpload: v.id, target: 'the man in the red jacket' }), /Add a photo of the new person/);
  // No words to describe: the photo is the description.
  const job = await make(studio, { maker: 'person-swap', videoUpload: v.id, target: 'the man in the red jacket', image: PNG });
  assert.equal(job.kind, 'video');
  assert.equal(job.prompt, 'Swapped a person: the man in the red jacket');
  const args = state.ffmpeg.at(-1);
  assert.equal(arg(args, '-vf'), 'fps=16,scale=832:464,setsar=1,format=yuv420p', 'its shape kept, inside 832 × 480');
  assert.equal(arg(args, '-frames:v'), String(SWAP_MAX_FRAMES), 'the first 5 seconds');
  let wf = state.prompts.at(-1);
  assert.equal(node(wf, 'LoadVideo').inputs.file, path.basename(args.at(-1)));
  assert.equal(wf[31].inputs.text, 'the man in the red jacket', 'the words find who to replace');
  assert.deepEqual([wf[32].inputs.batch_index, wf[32].inputs.length], [0, 1], 'on the first frame');
  assert.deepEqual(node(wf, 'MochaEmbeds').inputs.mask, ['34', 0]);
  assert.match(wf[40].inputs.image, /^orbit-.+\.png$/, 'the uploaded photo');
  assert.equal(node(wf, 'MochaEmbeds').inputs.ref2, undefined);
  assert.equal(node(wf, 'CreateVideo').inputs.fps, SWAP_FPS);

  // A face close-up as the second picture; the person from the gallery as the first.
  await galleryItem(dir, 'pic001', { kind: 'image', prompt: 'a portrait', width: 1024, height: 1536 });
  await galleryItem(dir, 'vid001');
  await make(studio, { maker: 'person-swap', videoItem: 'vid001', target: 'the woman on the left', fromItem: 'pic001', images: [PNG] });
  wf = state.prompts.at(-1);
  assert.match(wf[40].inputs.image, /^orbit-.+\.png$/);
  assert.notEqual(wf[40].inputs.image, wf[42].inputs.image, 'the photo and the face close-up are two pictures');
  assert.deepEqual(node(wf, 'MochaEmbeds').inputs.ref2, ['43', 0]);
  assert.equal(arg(state.ffmpeg.at(-1), '-vf'), 'fps=16,scale=832:464,setsar=1,format=yuv420p');

  // A portrait clip stays portrait; a short one is too short.
  const tall = await upload(studio, { ...VIDEO, width: 1080, height: 1920, seconds: 2 });
  await make(studio, { maker: 'person-swap', videoUpload: tall.id, target: 'the dancer', image: PNG });
  assert.equal(arg(state.ffmpeg.at(-1), '-vf'), 'fps=16,scale=464:832,setsar=1,format=yuv420p');
  assert.equal(arg(state.ffmpeg.at(-1), '-frames:v'), '29', '2 s at 16 fps, cut to 4k + 1');
  const short = await upload(studio, { ...VIDEO, seconds: 0.2 });
  await assert.rejects(studio.createJob({ maker: 'person-swap', videoUpload: short.id, target: 'the man', image: PNG }), /too short/);
});

test('Swap a person: never sexual, never what someone wears, never a child, never into an NSFW video', async () => {
  const { dir, studio } = await setup();
  const v = await upload(studio, VIDEO);
  const req = (extra) => ({ maker: 'person-swap', videoUpload: v.id, image: PNG, target: 'the man', ...extra });
  // Sexual words, or naming clothes instead of a person: the photo rule.
  for (const target of ['her shirt', 'his clothes', 'what she is wearing', 'the naked woman', 'her body']) {
    await assert.rejects(studio.createJob(req({ target })), refused(PHOTO_MESSAGE), target);
  }
  await assert.rejects(studio.createJob(req({ prompt: 'make her nude' })), refused(PHOTO_MESSAGE));
  await assert.rejects(studio.createJob(req({ prompt: 'sexy lingerie' })), refused(PHOTO_MESSAGE));
  // Children and teenagers are never swapped (in the video or from the photo).
  for (const target of ['the little girl', 'the kid on the bike', 'the teenager', 'the boy, 12 years old', 'the baby', 'the schoolgirl']) {
    await assert.rejects(studio.createJob(req({ target })), refused(SWAP_MINOR_MESSAGE), target);
  }
  await assert.rejects(studio.createJob(req({ prompt: 'she looks like a teen' })), refused(SWAP_MINOR_MESSAGE));
  await assert.rejects(studio.createJob(req({ target: 'the loli' })), (e) => e.status === 422 && e.message === BLOCKED_MESSAGE);
  // A video (or a gallery photo) marked NSFW, by the check or by you.
  await galleryItem(dir, 'vid002', { nsfw: true });
  await galleryItem(dir, 'vid003', { nsfwUser: true });
  await galleryItem(dir, 'pic002', { kind: 'image', nsfw: true });
  await assert.rejects(studio.createJob({ maker: 'person-swap', videoItem: 'vid002', target: 'the man', image: PNG }), refused(SWAP_NSFW_MESSAGE));
  await assert.rejects(studio.createJob({ maker: 'person-swap', videoItem: 'vid003', target: 'the man', image: PNG }), refused(SWAP_NSFW_MESSAGE));
  await assert.rejects(studio.createJob({ maker: 'person-swap', videoUpload: v.id, target: 'the man', fromItem: 'pic002' }), refused(SWAP_NSFW_MESSAGE));
  // Naming a person is fine, whatever they wear.
  await make(studio, req({ target: 'the man in the red shirt' }));
  await make(studio, req({ target: 'the woman in the blue dress' }));
  assert.equal(blockedSwap('the woman in the blue dress'), false);
  assert.equal(blockedSwap('her dress'), true);
});

test('Swap a person: the result is checked before anyone sees it; NSFW or unchecked results are never kept', async () => {
  const shown = [];
  let current = null;
  const run = async (nsfw) => {
    const { dir, state, studio } = await setup({ nsfw });
    current = studio;
    const v = await upload(studio, VIDEO);
    const job = await studio.createJob({ maker: 'person-swap', videoUpload: v.id, target: 'the man', image: PNG });
    await fs.mkdir(path.join(dir, 'output', 'orbit'), { recursive: true });
    await fs.writeFile(path.join(dir, 'output', 'orbit', `${job.id}.mp4`), 'video');
    state.done[`p${state.prompts.length}`] = `${job.id}.mp4`;
    for (let i = 0; i < 20 && !['done', 'error'].includes(studio.job(job.id).status); i++) await studio.poll();
    return { job: studio.job(job.id), item: await studio.item(job.id), file: path.join(dir, 'output', 'orbit', `${job.id}.mp4`) };
  };
  const seen = [];
  const ok = await run({
    check: async (file, o) => {
      seen.push(o?.kind);
      // While it is being looked at, the gallery doesn't have it yet.
      shown.push((await current.items()).length);
      return { nsfw: false, score: 0.02 };
    },
  });
  assert.equal(ok.job.status, 'done', ok.job.error ?? '');
  assert.deepEqual(shown, [0], 'not in the gallery during the check');
  assert.equal((await current.items()).length, 1, 'in the gallery once it passed');
  assert.equal(ok.item.photoGuard, true);
  assert.equal(ok.item.nsfw, false, 'looked at before it was shown');
  assert.equal(ok.item.photo, true);
  assert.deepEqual(seen, ['video']);

  const bad = await run({ check: async () => ({ nsfw: true, score: 0.97 }) });
  assert.equal(bad.job.status, 'error');
  assert.equal(bad.job.error, PHOTO_MESSAGE);
  assert.equal(bad.item, null, 'removed, not blurred');
  await assert.rejects(fs.stat(bad.file), 'its file is gone too');

  const blind = await run(undefined);
  assert.equal(blind.job.status, 'error');
  assert.equal(blind.job.error, CHECK_MESSAGE);
  assert.equal(blind.item, null, 'not kept when the check could not look');
});

test('Swap a person: expected time is learned like the other makers, from its own size', async () => {
  const { studio } = await setup();
  const warm = studio.estimate({ maker: 'person-swap', seconds: 5, size: 'landscape' });
  // 5 s at 832 × 480 is about 2.2 units of 170 s.
  assert.ok(warm > 300 && warm < 420, String(warm));
  assert.ok(studio.estimate({ maker: 'person-swap', seconds: 5, size: 'landscape', cold: true }) > warm, 'loading the model first takes longer');
});
