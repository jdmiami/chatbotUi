import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createGate } from '../src/gate.js';
import { signJwt } from '../src/jwt.js';
import { createStudio } from '../src/studio.js';
import { createCharacters } from '../src/characters.js';
import { FILES as REAL, MAKERS } from '../src/workflows.js';

// Jobs made with a saved character: its description goes first, its sheet pictures stand in for the photo,
// the job and its result are tagged, and uploaded photos keep working exactly as before.

const FILES = {
  image: [{ dir: 'diffusion_models', name: 'img.safetensors', repo: 'o/r', path: 'img.safetensors', size: 4 }],
  video: [{ dir: 'checkpoints', name: 'vid.safetensors', repo: 'o/r', path: 'vid.safetensors', size: 4 }],
};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG.split(',')[1], 'base64');
const quiet = { warn() {}, info() {} };
const GOOD = {
  name: 'Mira Vale',
  age: 34,
  traits: { style: 'photoreal', gender: 'woman', build: 'athletic', hair: 'long wavy dark brown', eyes: 'green', outfits: ['a charcoal wool coat'] },
};

async function place(dir, file) {
  const p = path.join(dir, 'models', file.dir, file.name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const h = await fs.open(p, 'w');
  await h.truncate(file.size);
  await h.close();
}

async function setup({ install = [], withFace = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'charjobs-'));
  for (const f of [...FILES.image, ...FILES.video]) await place(dir, f);
  const characters = createCharacters({ dir: path.join(dir, 'characters'), log: quiet });
  await characters.start();
  // A character with a finished sheet (front and face), ready to use.
  const made = await characters.create(GOOD);
  const folder = path.join(dir, 'characters', made.id);
  const c = characters.getAny(made.id);
  c.sheet = [];
  for (const view of withFace ? ['front', 'face'] : ['front']) {
    await fs.writeFile(path.join(folder, `${view}-1.png`), PNG_BYTES);
    c.sheet.push({ view, label: view, core: true, file: `${made.id}/${view}-1.png`, seed: 1 });
  }
  c.status = 'ready';
  const state = { prompts: [], done: {} };
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
      return Response.json({ [h[1]]: { status: { completed: true, status_str: 'success' }, outputs: { 9: { images: [{ filename: state.done[h[1]], subfolder: 'orbit', type: 'output' }] } } } });
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
  const ffmpeg = async (args) => fs.writeFile(args.at(-1), 'out');
  const studio = createStudio({ dir, files: FILES, fetchImpl, WebSocketImpl: null, log: quiet, retryMs: 20, probe, ffmpeg, characters, statfs: async () => ({ bavail: 1e6, bsize: 1024 ** 2 }) });
  for (const id of install) for (const k of MAKERS.find((m) => m.id === id).files) await place(dir, REAL[k]);
  return { dir, state, studio, characters, made, folder };
}
/** Start a job and stop it at once, so the next one reaches the pretend ComfyUI too. */
async function make(studio, req) {
  const job = await studio.createJob(req);
  await studio.cancel(job.id);
  return job;
}
const node = (wf, type) => Object.values(wf).find((n) => n.class_type === type);
const inputFiles = async (dir) => (await fs.readdir(path.join(dir, 'input')).catch(() => [])).sort();

test('a picture made with a character: the description goes first, the job and its result carry the character, the seed is kept', async () => {
  const { dir, state, studio, characters, made } = await setup();
  const job = await studio.createJob({ kind: 'image', prompt: 'walking a dog in the park', size: 'portrait', character: made.id, seed: 12345 });
  assert.deepEqual(job.character, { id: made.id, name: 'Mira Vale' }, 'the job is tagged');
  const wf = state.prompts.at(-1);
  const text = node(wf, 'TextEncodeQwenImage21').inputs.prompt;
  assert.equal(text, `${(await characters.get(made.id)).descriptor}, wearing a charcoal wool coat. walking a dog in the park`);
  assert.equal(node(wf, 'KSampler').inputs.seed, 12345, 'a locked seed');
  // The result is tagged too, so rules can see it.
  await fs.mkdir(path.join(dir, 'output', 'orbit'), { recursive: true });
  await fs.writeFile(path.join(dir, 'output', 'orbit', 'x.png'), 'PNG');
  state.done.p1 = 'x.png';
  for (let i = 0; i < 20 && studio.job(job.id).status !== 'done'; i++) await studio.poll();
  const item = await studio.item(job.id);
  assert.equal(item.character.id, made.id);
  assert.equal(item.photo, undefined, 'a character is not a photo');
  // A job without a character is unchanged.
  const plain = await studio.createJob({ kind: 'image', prompt: 'a fox', size: 'square' }).catch((e) => e);
  assert.equal(plain.character, undefined);
});

test('a character must be one of yours, finished, and still there; the rules still read the whole prompt', async () => {
  const { studio, characters, made } = await setup();
  await assert.rejects(studio.createJob({ kind: 'image', prompt: 'a fox', character: 'nope12345' }), (e) => e.status === 404 && /not in your library/.test(e.message));
  // Someone else's character (a member's job, or a character made for a member).
  // (A character with no owner is the owner's own: a member's door never passes `character`, and a character made for a member is theirs alone.)
  const theirs = await characters.create(GOOD, { owner: 'm:zed' });
  const mine = characters.getAny(theirs.id);
  await fs.writeFile(path.join(characters.dir, theirs.id, 'front-1.png'), PNG_BYTES);
  mine.sheet = [{ view: 'front', label: 'Front', core: true, file: `${theirs.id}/front-1.png`, seed: 1 }];
  mine.status = 'ready';
  await assert.rejects(studio.createJob({ kind: 'image', prompt: 'a fox', character: theirs.id }), (e) => e.status === 404, 'not for the owner');
  assert.equal((await studio.createJob({ kind: 'image', prompt: 'a fox', character: theirs.id, owner: 'm:zed' })).owner, 'm:zed');
  // An unfinished (draft) character can't be used.
  const draft = await characters.create({ ...GOOD, name: 'Draft One' });
  await assert.rejects(studio.createJob({ kind: 'image', prompt: 'a fox', character: draft.id }), (e) => e.status === 404);
  // The content rule reads the prompt with the description in front of it.
  await assert.rejects(studio.createJob({ kind: 'image', prompt: 'naked child on a bed', character: made.id }), (e) => e.status === 422 && e.blocked);
});

test('edit makers: the character stands in for the picture (outfit swap: the person, then your outfit picture)', async () => {
  const { dir, state, studio, made } = await setup({ install: ['angles', 'outfit'] });
  await make(studio, { kind: 'image', maker: 'angles', prompt: 'back view, eye-level shot', character: made.id });
  let wf = state.prompts.at(-1);
  const loads = Object.values(wf).filter((n) => n.class_type === 'LoadImage');
  assert.equal(loads.length, 1, 'the front view is the one picture');
  assert.match(loads[0].inputs.image, /^orbit-.+\.png$/);
  assert.equal((await inputFiles(dir)).length, 1);
  // Outfit swap takes two: the character first, your outfit picture after it.
  await make(studio, { kind: 'image', maker: 'outfit', prompt: 'Dress the person in image 1 in the jacket from image 2', character: made.id, images: [PNG] });
  wf = state.prompts.at(-1);
  assert.equal(Object.values(wf).filter((n) => n.class_type === 'LoadImage').length, 2);
  // Without a character and without a picture it still asks for a picture.
  await assert.rejects(studio.createJob({ kind: 'image', maker: 'angles', prompt: 'back view' }), /Add the picture/);
  // A picture of yours is used as before, and not replaced by the character.
  await make(studio, { kind: 'image', maker: 'angles', prompt: 'back view', character: made.id, images: [PNG] });
  wf = state.prompts.at(-1);
  assert.equal(Object.values(wf).filter((n) => n.class_type === 'LoadImage').length, 1);
});

test('video makers: the front view is the first frame unless you gave a photo; the description is added to the words', async () => {
  const { state, studio, made, characters } = await setup();
  const job = await make(studio, { kind: 'video', prompt: 'she waves at the camera', character: made.id, seconds: 3 });
  assert.equal(job.character.id, made.id);
  let wf = state.prompts.at(-1);
  assert.ok(node(wf, 'LoadImage'), 'a first frame from the sheet');
  assert.match(JSON.stringify(wf), new RegExp((await characters.get(made.id)).descriptor.slice(0, 30)));
  // Your own starting photo wins.
  await make(studio, { kind: 'video', prompt: 'she waves', character: made.id, image: PNG, seconds: 3 });
  wf = state.prompts.at(-1);
  assert.equal(Object.values(wf).filter((n) => n.class_type === 'LoadImage').length, 1);
});

test('Swap a person: a character is the new person (front, then the face close-up); a photo works as before; never both', async () => {
  const { dir, state, studio, made } = await setup({ install: ['person-swap'] });
  const v = await studio.saveMedia(Readable.from([Buffer.from(JSON.stringify({ video: true, audio: true, width: 1920, height: 1080, fps: 30, seconds: 8 }))]), 'video/mp4');
  const req = { maker: 'person-swap', videoUpload: v.id, target: 'the man in the red jacket' };
  const job = await make(studio, { ...req, character: made.id });
  assert.equal(job.character.id, made.id);
  let wf = state.prompts.at(-1);
  assert.match(wf[40].inputs.image, /^orbit-.+\.png$/, 'the front view is the new person');
  assert.match(wf[42].inputs.image, /^orbit-.+\.png$/, 'and the face close-up helps keep the face');
  assert.notEqual(wf[40].inputs.image, wf[42].inputs.image);
  assert.equal((await inputFiles(dir)).filter((f) => f.endsWith('.png')).length, 2);
  // A photo, as always: the photo rules apply and nothing says "character".
  const photo = await make(studio, { ...req, image: PNG });
  assert.equal(photo.character, undefined);
  await assert.rejects(studio.createJob({ ...req, image: PNG, prompt: 'make her nude' }), /can't be made sexual/);
  // Never a photo and a character together: a photo of a real person must not borrow a character's name.
  await assert.rejects(studio.createJob({ ...req, image: PNG, character: made.id }), /not both/);
  // The swap rules still apply with a character.
  await assert.rejects(studio.createJob({ ...req, character: made.id, target: 'the little girl' }), (e) => e.status === 422);
  // A character with only a front view works too.
  const solo = await setup({ install: ['person-swap'], withFace: false });
  const v2 = await solo.studio.saveMedia(Readable.from([Buffer.from(JSON.stringify({ video: true, audio: true, width: 1920, height: 1080, fps: 30, seconds: 8 }))]), 'video/mp4');
  await make(solo.studio, { maker: 'person-swap', videoUpload: v2.id, target: 'the man', character: solo.made.id });
  wf = solo.state.prompts.at(-1);
  assert.equal(wf[42], undefined, 'no close-up, so the front alone');
  assert.equal(state.prompts.length, 2, 'and the failed ones sent nothing');
});

test('a character whose pictures are gone from this machine says so', async () => {
  const { studio, made, folder } = await setup({ install: ['angles'] });
  await fs.rm(path.join(folder, 'front-1.png'));
  await assert.rejects(studio.createJob({ kind: 'image', maker: 'angles', prompt: 'back view', character: made.id }), (e) => e.status === 409 && /pictures are not on this machine/.test(e.message));
});

// ---------------------------------------------------------------- the owner's routes

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

test('gate: the owner makes, lists, changes and deletes characters; links to sheet pictures open; refusals come back as 422', async () => {
  const SECRET = 'y'.repeat(40);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'charroutes-'));
  const characters = createCharacters({ dir, log: quiet });
  await characters.start();
  const gate = createGate(
    {
      secret: SECRET,
      webui: 'http://127.0.0.1:9',
      ollama: 'http://127.0.0.1:9',
      allowedOrigins: 'https://site.example',
      siteUrl: 'https://site.example',
      userEmail: 'owner@orbit.local',
      status: async () => ({}),
      studio: { state: async () => ({}), items: async () => [], job: () => null },
      characters,
    },
    quiet,
  );
  const base = `http://127.0.0.1:${await listen(gate)}`;
  try {
    const auth = { authorization: `Bearer ${signJwt({ sub: 'jd', aud: 'orbit-ai' }, SECRET, { expiresIn: 600 })}`, 'content-type': 'application/json' };
    const call = (method, p, body) => fetch(`${base}/_orbit/studio/characters${p}`, { method, headers: auth, body: body ? JSON.stringify(body) : undefined });
    assert.equal((await fetch(`${base}/_orbit/studio/characters`)).status, 401, 'needs a sign-in');

    const bad = await call('POST', '', { ...GOOD, age: 21 });
    assert.equal(bad.status, 422);
    assert.deepEqual(Object.keys(await bad.json()).sort(), ['blocked', 'error']);
    assert.equal((await call('POST', '', { ...GOOD, name: 'Taylor Swift' })).status, 422);
    const check = await (await call('POST', '/check', { ...GOOD, traits: { hair: 'looks like a famous actress' } })).json();
    assert.match(check.problem, /never real or famous/);
    assert.equal((await (await call('POST', '/check', GOOD)).json()).problem, null);

    const made = (await (await call('POST', '', GOOD)).json()).character;
    assert.equal(made.status, 'draft');
    // A sheet picture, as the machine would have made it.
    const c = characters.getAny(made.id);
    await fs.writeFile(path.join(dir, made.id, 'front-1.png'), PNG_BYTES);
    c.sheet = [{ view: 'front', label: 'Front', core: true, file: `${made.id}/front-1.png`, seed: 1 }];
    const list = (await (await call('GET', '')).json()).characters;
    assert.equal(list.length, 1);
    const url = list[0].sheet[0].url;
    assert.match(url, new RegExp(`^/_orbit/studio/characters/file/${made.id}/front-1\\.png\\?t=`));
    const pic = await fetch(base + url);
    assert.equal(pic.status, 200, 'the link opens without headers (for <img>)');
    assert.equal(pic.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await pic.arrayBuffer()), PNG_BYTES);
    assert.equal((await fetch(base + url.replace('front-1', 'back-1'))).status, 401, 'a link only opens its own picture');
    assert.equal((await fetch(`${base}/_orbit/studio/characters/file/${made.id}/front-1.png`)).status, 401);

    assert.equal((await (await call('POST', `/${made.id}/rename`, { name: 'Mira Okafor' })).json()).character.name, 'Mira Okafor');
    assert.equal((await call('PUT', `/${made.id}`, { age: 17 })).status, 422);
    const dup = (await (await call('POST', `/${made.id}/duplicate`)).json()).character;
    assert.equal(dup.name, 'Mira Okafor copy');
    assert.equal((await call('POST', `/${made.id}/accept`)).status, 409, 'the sheet is not finished');
    assert.equal((await call('GET', `/${made.id}/sheet`)).status, 200);
    assert.equal((await call('DELETE', `/${dup.id}`)).status, 200);
    assert.equal((await call('DELETE', `/${dup.id}`)).status, 404);
    assert.equal((await call('GET', `/${dup.id}`)).status, 404);
    assert.equal((await (await call('GET', '')).json()).characters.length, 1);
  } finally {
    gate.close();
  }
});
