import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createGate } from '../src/gate.js';
import { signJwt } from '../src/jwt.js';
import { BLOCKED_MESSAGE, PHOTO_MESSAGE, PHOTO_SOURCE_MESSAGE, TOKEN_MESSAGE, blockedReplace, blockedTarget, createStudio } from '../src/studio.js';
import { FILES as REAL, MAKERS, S2V_CHUNK, VACE_EXTEND_KEEP, VACE_MAX_FRAMES, WAN_NEGATIVE } from '../src/workflows.js';

// The five video makers of the store: LTX-2.5, Wan S2V (talking photo), Wan VACE, Erase from video
// (VACE + SAM 3.1) and Sharpen video (SeedVR2), with their new inputs (a video, a sound, words).

const FILES = {
  image: [
    { dir: 'diffusion_models', name: 'img.safetensors', repo: 'o/r', path: 'img.safetensors', size: 4 },
    { dir: 'text_encoders', name: 'te.safetensors', repo: 'o/r', path: 'te.safetensors', size: 4 },
    { dir: 'vae', name: 'vae.safetensors', repo: 'o/r', path: 'vae.safetensors', size: 4 },
  ],
  video: [{ dir: 'checkpoints', name: 'vid.safetensors', repo: 'o/r', path: 'vid.safetensors', size: 4 }],
};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const quiet = { warn() {}, info() {} };

/** A model file that looks fully downloaded (sparse). */
async function place(dir, file) {
  const p = path.join(dir, 'models', file.dir, file.name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const h = await fs.open(p, 'w');
  await h.truncate(file.size);
  await h.close();
}

/**
 * A studio whose ComfyUI, ffmpeg and ffprobe are pretend: a "video" or "sound" file is a JSON note of
 * what ffprobe would say about it; ffmpeg records its arguments and writes the output.
 */
async function setup({ hfToken = 'hf_test', install = ['vace', 'video-erase', 'video-sharpen', 's2v', 'ltx-25'], nsfw } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vmakers-'));
  for (const f of [...FILES.image, ...FILES.video]) await place(dir, f);
  const state = { prompts: [], ffmpeg: [], hf: [], done: {} };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'huggingface.co') {
      state.hf.push({ path: u.pathname, auth: init.headers?.authorization || null });
      return new Response('nope', { status: /LTX-2\.5/.test(u.pathname) ? 401 : 404 });
    }
    if (u.pathname === '/system_stats') return Response.json({});
    if (u.pathname === '/api/ps') return Response.json({ models: [] });
    if (u.pathname === '/prompt') {
      state.prompts.push(JSON.parse(init.body).prompt);
      return Response.json({ prompt_id: `p${state.prompts.length}` });
    }
    const h = /^\/history\/(p\d+)$/.exec(u.pathname);
    if (h && state.done[h[1]]) {
      return Response.json({ [h[1]]: { status: { completed: true, status_str: 'success' }, outputs: { 15: { images: [{ filename: state.done[h[1]], subfolder: 'orbit', type: 'output' }] } } } });
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
  const studio = createStudio({ dir, files: FILES, fetchImpl, WebSocketImpl: null, log: quiet, retryMs: 20, probe, ffmpeg, hfToken, nsfw, statfs: async () => ({ bavail: 1e6, bsize: 1024 ** 2 }) });
  for (const id of install) {
    for (const k of MAKERS.find((m) => m.id === id).files) await place(dir, REAL[k]);
  }
  return { dir, state, studio };
}

const VIDEO = { video: true, audio: true, width: 1920, height: 1080, fps: 30, seconds: 8 };
/** Upload a pretend file through saveMedia (as the gate does with the request body). */
const upload = (studio, info, type = 'video/mp4') => studio.saveMedia(Readable.from([Buffer.from(JSON.stringify(info))]), type);

/** A gallery video (its file is a probe note too). */
async function galleryVideo(dir, id, extra = {}) {
  await fs.mkdir(path.join(dir, 'output', 'orbit'), { recursive: true });
  await fs.writeFile(path.join(dir, 'output', 'orbit', `${id}.mp4`), JSON.stringify({ ...VIDEO, width: 1280, height: 704, fps: 25, seconds: 5 }));
  await fs.writeFile(
    path.join(dir, 'output', 'orbit', `${id}.json`),
    JSON.stringify({ id, kind: 'video', prompt: 'waves at sunset', width: 1280, height: 704, seconds: 5, file: `orbit/${id}.mp4`, createdAt: '2026-10-20T00:00:00Z', ...extra }),
  );
}

/** Start a job and stop it right away, so the next one goes straight to ComfyUI. */
async function make(studio, req) {
  const job = await studio.createJob(req);
  await studio.cancel(job.id);
  return job;
}
const node = (wf, type) => Object.values(wf).find((n) => n.class_type === type);
const nodes = (wf, type) => Object.values(wf).filter((n) => n.class_type === type);
const arg = (args, flag) => args[args.indexOf(flag) + 1];

test('store: the five video makers with what they need; LTX-2.5 says plainly that it needs a token', async () => {
  const { studio } = await setup({ hfToken: null, install: [] });
  const list = await studio.makers();
  const byId = (id) => list.find((m) => m.id === id);
  assert.deepEqual(
    ['ltx-25', 's2v', 'vace', 'video-erase', 'video-sharpen'].map((id) => byId(id).kind),
    ['video', 'video', 'videoedit', 'videoedit', 'videoedit'],
  );
  assert.deepEqual(byId('s2v').needs, ['photo', 'audio']);
  assert.deepEqual(byId('vace').tasks, ['replace', 'restyle', 'extend', 'motion']);
  assert.deepEqual(byId('video-erase').needs, ['video', 'target']);
  assert.deepEqual(byId('ltx-25').accepts, ['photo', 'endPhoto', 'video']);
  assert.equal(byId('ltx-25').gated, true);
  assert.equal(byId('ltx-25').needsToken, true);
  assert.equal(byId('vace').needsToken, false);
  assert.equal(byId('video-erase').size, byId('vace').size, 'erasing uses the VACE files');
  await assert.rejects(studio.installMaker('ltx-25'), (e) => e.status === 400 && e.message === TOKEN_MESSAGE);
  assert.equal(byId('ltx-25').wanted, false);
});

test('store: with a token, gated files are fetched with it (and only they are); a refusal does not stop other downloads', async () => {
  const { studio, state } = await setup({ install: [] });
  assert.equal((await studio.makers()).find((m) => m.id === 'ltx-25').needsToken, false);
  await studio.installMaker('ltx-25');
  await studio.installMaker('video-sharpen');
  await new Promise((r) => setTimeout(r, 150));
  const ltx = state.hf.filter((h) => /LTX-2\.5/.test(h.path));
  const other = state.hf.filter((h) => !/LTX-2\.5/.test(h.path));
  assert.ok(ltx.length >= 1 && ltx.every((h) => h.auth === 'Bearer hf_test'), 'gated: sent with the token');
  assert.ok(other.length >= 1 && other.every((h) => h.auth === null), 'others: never');
  assert.ok(other.some((h) => /SeedVR2/.test(h.path)), 'SeedVR2 still downloads after LTX-2.5 was refused');
  const m = (await studio.makers()).find((x) => x.id === 'ltx-25');
  assert.match(m.problem, /refused the token/);
  assert.equal(ltx.length, new Set(ltx.map((h) => h.path)).size, 'a refused file is not retried in a loop');
});

test('uploads: videos and sounds stream to disk with a size limit and a type check', async () => {
  const { studio } = await setup({ install: [] });
  const v = await upload(studio, VIDEO, 'video/quicktime');
  assert.match(v.id, /^u[A-Za-z0-9_-]+$/);
  assert.equal(v.kind, 'video');
  const a = await upload(studio, { audio: true, seconds: 3 }, 'audio/mpeg');
  assert.equal(a.kind, 'audio');
  await assert.rejects(upload(studio, {}, 'image/png'), (e) => e.status === 415);
  await assert.rejects(studio.saveMedia(Readable.from([Buffer.from('x')]), 'video/mp4', 300 * 1024 * 1024), (e) => e.status === 413 && /200 MB/.test(e.message));
  await assert.rejects(studio.saveMedia(Readable.from([]), 'audio/wav'), /empty/);
});

test('Sharpen video: a gallery video, prepared at its own frame rate, made 2× by SeedVR2', async () => {
  const { dir, state, studio } = await setup();
  await galleryVideo(dir, 'vid001');
  await assert.rejects(studio.createJob({ maker: 'video-sharpen' }), /Add the video to work on/);
  const job = await make(studio, { maker: 'video-sharpen', videoItem: 'vid001' });
  assert.equal(job.kind, 'video');
  assert.equal(job.prompt, 'waves at sunset', 'keeps the source’s words (and so its blur)');
  const args = state.ffmpeg[0];
  assert.equal(arg(args, '-vf'), 'scale=1280:704,setsar=1,format=yuv420p', 'no frame-rate change, at most 1280 × 720');
  const wf = state.prompts[0];
  assert.equal(node(wf, 'LoadVideo').inputs.file, path.basename(args.at(-1)));
  assert.equal(node(wf, 'ResizeImageMaskNode').inputs['resize_type.multiplier'], 2);
  await assert.rejects(studio.createJob({ maker: 'video-sharpen', videoItem: 'nope99' }), (e) => e.status === 404);
});

test('Erase from video: words find it; an upload follows the photo rule (no taking clothes away)', async () => {
  const { state, studio } = await setup();
  const v = await upload(studio, VIDEO);
  await assert.rejects(studio.createJob({ maker: 'video-erase', videoUpload: v.id }), /Say what to erase/);
  for (const target of ['her shirt', 'the dress she is wearing', 'his clothes', 'what she has on', 'her bikini']) {
    await assert.rejects(studio.createJob({ maker: 'video-erase', videoUpload: v.id, target }), (e) => e.status === 422 && e.message === PHOTO_MESSAGE, target);
  }
  await assert.rejects(studio.createJob({ maker: 'video-erase', videoUpload: v.id, target: 'the loli' }), (e) => e.message === BLOCKED_MESSAGE);
  const job = await make(studio, { maker: 'video-erase', videoUpload: v.id, target: 'the man in the red shirt' });
  assert.equal(job.prompt, 'Erased: the man in the red shirt');
  const args = state.ffmpeg[0];
  assert.equal(arg(args, '-vf'), 'fps=16,scale=1280:720,setsar=1,format=yuv420p', '16 fps, 720p');
  assert.equal(arg(args, '-frames:v'), '81', 'the first 5 seconds');
  const wf = state.prompts[0];
  assert.equal(node(wf, 'SAM3_Detect') && wf[31].inputs.text, 'the man in the red shirt');
  assert.equal(wf[7].inputs.text, `the man in the red shirt, ${WAN_NEGATIVE}`);
  assert.deepEqual([wf[20].inputs.width, wf[20].inputs.height, wf[20].inputs.length], [1280, 720, 81]);
});

test('Wan VACE: replace, restyle, extend and move a photo; generated videos may go adult, real ones may not', async () => {
  const { dir, state, studio } = await setup();
  await galleryVideo(dir, 'vid002');
  await assert.rejects(studio.createJob({ maker: 'vace', videoItem: 'vid002', task: 'replace', prompt: 'a horse' }), /Say what to replace/);
  await make(studio, { maker: 'vace', videoItem: 'vid002', task: 'replace', target: 'the red car', prompt: 'a white horse', image: PNG });
  let wf = state.prompts.at(-1);
  assert.equal(wf[31].inputs.text, 'the red car');
  assert.ok(wf[20].inputs.reference_image, 'the picture of the new thing goes in');
  await make(studio, { maker: 'vace', videoItem: 'vid002', task: 'restyle', prompt: 'a watercolour painting' });
  assert.ok(node(state.prompts.at(-1), 'Canny'));
  // Extend: the whole clip (up to 10 s) plus 64 new frames.
  const ext = await make(studio, { maker: 'vace', videoItem: 'vid002', task: 'extend', prompt: 'the wave crashes on the rocks' });
  assert.equal(arg(state.ffmpeg.at(-1), '-frames:v'), '80');
  wf = state.prompts.at(-1);
  assert.equal(wf[20].inputs.length, VACE_MAX_FRAMES);
  assert.equal(wf[40].inputs.length, VACE_EXTEND_KEEP);
  assert.equal(ext.prompt, 'the wave crashes on the rocks');
  // Motion needs a photo of who should move.
  await assert.rejects(studio.createJob({ maker: 'vace', videoItem: 'vid002', task: 'motion', prompt: 'she dances' }), /photo of who should move/);
  await make(studio, { maker: 'vace', videoItem: 'vid002', task: 'motion', prompt: 'she dances', image: PNG });
  assert.ok(state.prompts.at(-1)[20].inputs.reference_image);
  // An unknown task falls back to the first one (replace) and still needs its words.
  await assert.rejects(studio.createJob({ maker: 'vace', videoItem: 'vid002', task: 'dance', prompt: 'x' }), /Say what to replace/);

  // A video made here from words: adult edits are allowed, as for pictures.
  await make(studio, { maker: 'vace', videoItem: 'vid002', task: 'restyle', prompt: 'make her nude on the beach' });
  // One that came from a photo, or an uploaded video: never.
  await galleryVideo(dir, 'vid003', { photo: true });
  await assert.rejects(studio.createJob({ maker: 'vace', videoItem: 'vid003', task: 'restyle', prompt: 'make her nude' }), (e) => e.message === PHOTO_SOURCE_MESSAGE);
  const v = await upload(studio, VIDEO);
  await assert.rejects(studio.createJob({ maker: 'vace', videoUpload: v.id, task: 'replace', target: 'her dress', prompt: 'bare skin' }), (e) => e.message === PHOTO_MESSAGE);
  await make(studio, { maker: 'vace', videoUpload: v.id, task: 'replace', target: 'her dress', prompt: 'a red ball gown' });
  await assert.rejects(studio.createJob({ maker: 'vace', videoUpload: v.id, task: 'restyle', prompt: 'naked child' }), (e) => e.message === BLOCKED_MESSAGE);
});

test('a video too short to work on, or a file that is not a video, is refused plainly', async () => {
  const { studio } = await setup();
  const short = await upload(studio, { ...VIDEO, seconds: 0.2 });
  await assert.rejects(studio.createJob({ maker: 'vace', videoUpload: short.id, task: 'restyle', prompt: 'x' }), /too short/);
  const notVideo = await upload(studio, { video: false, audio: true, seconds: 3 });
  await assert.rejects(studio.createJob({ maker: 'video-sharpen', videoUpload: notVideo.id }), /not a video/);
  await assert.rejects(studio.createJob({ maker: 'video-sharpen', videoUpload: 'u_missing123' }), /expired/);
});

test('Talking photo (S2V): a photo and a sound; the sound decides the length; the photo rule holds', async () => {
  const { state, studio } = await setup();
  const a = await upload(studio, { audio: true, video: false, seconds: 9 }, 'audio/mp4');
  await assert.rejects(studio.createJob({ kind: 'video', maker: 's2v', image: PNG }), /voice recording or a song/);
  await assert.rejects(studio.createJob({ kind: 'video', maker: 's2v', audioUpload: a.id }), /photo of the person/);
  await assert.rejects(studio.createJob({ kind: 'video', maker: 's2v', audioUpload: a.id, image: PNG, prompt: 'she strips' }), (e) => e.message === PHOTO_MESSAGE);
  const job = await make(studio, { kind: 'video', maker: 's2v', audioUpload: a.id, image: PNG, size: 'portrait' });
  assert.match(job.prompt, /talks or sings/);
  const aargs = state.ffmpeg.at(-1);
  assert.equal(aargs.at(-1).endsWith('.wav'), true);
  assert.equal(arg(aargs, '-t'), '9');
  const wf = state.prompts.at(-1);
  assert.equal(nodes(wf, 'WanSoundImageToVideoExtend').length, 1, '9 s of sound: two chunks');
  assert.deepEqual([wf[12].inputs.width, wf[12].inputs.height, wf[12].inputs.length], [480, 832, S2V_CHUNK]);
  assert.equal(node(wf, 'LoadAudio').inputs.audio, path.basename(aargs.at(-1)));
  // Long songs stop at four chunks (about 19 s).
  const long = await upload(studio, { audio: true, seconds: 200 }, 'audio/mpeg');
  await make(studio, { kind: 'video', maker: 's2v', audioUpload: long.id, image: PNG, prompt: 'he sings on stage' });
  assert.equal(nodes(state.prompts.at(-1), 'WanSoundImageToVideoExtend').length, 3);
  assert.equal(Number(arg(state.ffmpeg.at(-1), '-t')), (4 * S2V_CHUNK) / 16);
});

test('LTX-2.5: words, a first and last photo, and video to video from the gallery', async () => {
  const { dir, state, studio } = await setup();
  await make(studio, { kind: 'video', maker: 'ltx-25', prompt: 'a drummer in the rain', seconds: 5, size: 'portrait' });
  let wf = state.prompts.at(-1);
  assert.deepEqual([wf[30].inputs.width, wf[30].inputs.height, wf[30].inputs.length], [352, 640, 121]);
  await make(studio, { kind: 'video', maker: 'ltx-25', prompt: 'she turns', image: PNG, endImage: PNG });
  wf = state.prompts.at(-1);
  assert.deepEqual(nodes(wf, 'LTXVAddGuide').map((n) => n.inputs.frame_idx), [0, -1]);
  await assert.rejects(studio.createJob({ kind: 'video', maker: 'ltx-25', prompt: 'make her nude', endImage: PNG }), (e) => e.message === PHOTO_MESSAGE, 'an uploaded end photo follows the photo rule');
  await galleryVideo(dir, 'vid004');
  const job = await make(studio, { kind: 'video', maker: 'ltx-25', prompt: 'as a claymation', videoItem: 'vid004', change: 'little' });
  assert.equal(job.kind, 'video');
  const args = state.ffmpeg.at(-1);
  assert.match(arg(args, '-vf'), /^fps=24,scale=1280:704:force_original_aspect_ratio=increase,crop=1280:704/);
  assert.equal(arg(args, '-frames:v'), '113', '8k + 1 frames from a 5 s clip at 24 fps');
  wf = state.prompts.at(-1);
  assert.equal(node(wf, 'LoadVideo').inputs.file, path.basename(args.at(-1)));
  assert.equal(node(wf, 'ManualSigmas').inputs.sigmas, '0.725, 0.421875, 0');
  // Other video makers ignore a video they can't use.
  await make(studio, { kind: 'video', maker: 'ltx', prompt: 'waves', videoItem: 'vid004' });
  assert.equal(node(state.prompts.at(-1), 'LoadVideo'), undefined);
});

test('content rules for words that name what to erase or replace', () => {
  for (const t of ['her shirt', 'his pants', 'the towel', 'her underwear', 'everything she is wearing', 'her body']) assert.equal(blockedTarget(t), true, t);
  for (const t of ['the man in the red shirt', 'the watermark in the corner', 'the woman on the left', 'the sign', 'the car behind her']) assert.equal(blockedTarget(t), false, t);
  assert.equal(blockedReplace('her dress', 'a red ball gown'), false);
  assert.equal(blockedReplace('her dress', 'bare skin'), true);
  assert.equal(blockedReplace('her dress', 'a cat'), true, 'clothes only become other clothes');
  assert.equal(blockedReplace('the red car', 'a white horse'), false);
});

test('gate: POST /_orbit/studio/uploads takes the raw file and a job can use it', async () => {
  const SECRET = 's'.repeat(40);
  const { state, studio } = await setup();
  const gate = createGate({ secret: SECRET, webui: 'http://127.0.0.1:9', ollama: 'http://127.0.0.1:9', allowedOrigins: '', siteUrl: '', status: async () => ({}), studio }, quiet);
  const port = await new Promise((r) => gate.listen(0, '127.0.0.1', () => r(gate.address().port)));
  try {
    const auth = { authorization: `Bearer ${signJwt({ sub: 'jd', aud: 'orbit-ai' }, SECRET, { expiresIn: 600 })}` };
    assert.equal((await fetch(`http://127.0.0.1:${port}/_orbit/studio/uploads`, { method: 'POST', body: 'x' })).status, 401);
    const bad = await fetch(`http://127.0.0.1:${port}/_orbit/studio/uploads`, { method: 'POST', headers: { ...auth, 'content-type': 'text/plain' }, body: 'x' });
    assert.equal(bad.status, 415);
    const r = await fetch(`http://127.0.0.1:${port}/_orbit/studio/uploads`, { method: 'POST', headers: { ...auth, 'content-type': 'video/mp4' }, body: JSON.stringify(VIDEO) });
    assert.equal(r.status, 200);
    const { id, kind } = await r.json();
    assert.equal(kind, 'video');
    const j = await fetch(`http://127.0.0.1:${port}/_orbit/studio/jobs`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'video', maker: 'video-sharpen', videoUpload: id }),
    });
    assert.equal(j.status, 200);
    assert.ok(node(state.prompts.at(-1), 'SeedVR2Conditioning'));
  } finally {
    gate.close();
  }
});

test('NSFW: a video made from a flagged video is flagged at once; other new videos are looked at', async () => {
  const seen = [];
  const nsfw = { check: async (file, o) => (seen.push(o?.kind), { nsfw: false, score: 0.01 }) };
  const { dir, state, studio } = await setup({ nsfw });
  await galleryVideo(dir, 'vid005', { nsfw: true });
  await galleryVideo(dir, 'vid006');
  const run = async (req) => {
    const job = await studio.createJob(req);
    const pid = `p${state.prompts.length}`;
    await fs.writeFile(path.join(dir, 'output', 'orbit', `${job.id}.mp4`), 'video');
    state.done[pid] = `${job.id}.mp4`;
    for (let i = 0; i < 20 && studio.job(job.id).status !== 'done'; i++) await studio.poll();
    return studio.job(job.id);
  };
  const a = await run({ maker: 'video-sharpen', videoItem: 'vid005' });
  assert.equal(a.status, 'done');
  assert.equal(a.item.nsfw, true);
  assert.equal(a.item.kind, 'video');
  assert.deepEqual([a.item.width, a.item.height], [2560, 1408]);
  const b = await run({ maker: 'video-erase', videoItem: 'vid006', target: 'the boat' });
  assert.equal(b.item.nsfw, undefined);
  for (let i = 0; i < 50 && !seen.length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(seen, ['video'], 'only the unflagged one is looked at');
});
