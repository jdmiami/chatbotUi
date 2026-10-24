import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import http from 'node:http';
import { ADULT_SWAP_MESSAGE, BLOCKED_MESSAGE, CHARACTER_MESSAGE, CHECK_MESSAGE, PHOTO_MESSAGE, SWAP_NSFW_MESSAGE, createStudio } from '../src/studio.js';
import { APPROVE_BLOCKED_MESSAGE } from '../src/held.js';
import { createGate } from '../src/gate.js';
import { signJwt } from '../src/jwt.js';
import { FILES as REAL, MAKERS } from '../src/workflows.js';
import { memoryR2 } from './fakes/memoryR2.js';

// Adult swaps are only for a saved adult character in a video made here from words. Results that must not
// go straight to the user are held for the owner (never deleted); only results about or showing minors go.

const FILES = {
  image: [{ dir: 'diffusion_models', name: 'img.safetensors', repo: 'o/r', path: 'img.safetensors', size: 4 }],
  video: [{ dir: 'checkpoints', name: 'vid.safetensors', repo: 'o/r', path: 'vid.safetensors', size: 4 }],
};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const quiet = { warn() {}, info() {} };
const VIDEO = { video: true, audio: true, width: 1920, height: 1080, fps: 30, seconds: 8 };

async function place(dir, file) {
  const p = path.join(dir, 'models', file.dir, file.name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const h = await fs.open(p, 'w');
  await h.truncate(file.size);
  await h.close();
}

const ANNA = { id: 'anna01', name: 'Anna', adult: true, fictional: true, sheet: [], descriptor: 'a tall woman' };
const KID = { id: 'kid001', name: 'Kit', adult: false, fictional: true, sheet: [], descriptor: 'x' };

/** A studio with a pretend ComfyUI, ffmpeg, ffprobe, saved characters, and optionally R2 and a checker. */
async function setup({ nsfw, r2 } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'held-'));
  for (const f of [...FILES.image, ...FILES.video]) await place(dir, f);
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
      return Response.json({ [h[1]]: { status: { completed: true, status_str: 'success' }, outputs: { 63: { images: [{ filename: state.done[h[1]], subfolder: 'orbit', type: 'output' }] } } } });
    }
    return Response.json({});
  };
  const probe = async (file) => JSON.parse(await fs.readFile(file, 'utf8')).video ? JSON.parse(await fs.readFile(file, 'utf8')) : null;
  const ffmpeg = async (args) => fs.writeFile(args.at(-1), 'out');
  // The character's two pictures, on this machine.
  await fs.mkdir(path.join(dir, 'chars'), { recursive: true });
  for (const n of ['a.png', 'b.png']) await fs.writeFile(path.join(dir, 'chars', n), Buffer.from(PNG.split(',')[1], 'base64'));
  const saved = { anna01: { ...ANNA, sheet: [path.join(dir, 'chars', 'a.png'), path.join(dir, 'chars', 'b.png')] }, kid001: { ...KID, sheet: [path.join(dir, 'chars', 'a.png')] }, fake01: { ...ANNA, id: 'fake01', fictional: false, sheet: [path.join(dir, 'chars', 'a.png')] } };
  const characters = { get: async (id) => saved[id] ?? null };
  const studio = createStudio({ dir, files: FILES, fetchImpl, WebSocketImpl: null, log: quiet, retryMs: 20, probe, ffmpeg, nsfw, characters, ...(r2 ? { r2 } : {}), statfs: async () => ({ bavail: 1e6, bsize: 1024 ** 2 }) });
  for (const k of MAKERS.find((m) => m.id === 'person-swap').files) await place(dir, REAL[k]);
  return { dir, state, studio };
}

async function galleryVideo(dir, id, extra = {}) {
  await fs.mkdir(path.join(dir, 'output', 'orbit'), { recursive: true });
  await fs.writeFile(path.join(dir, 'output', 'orbit', `${id}.mp4`), JSON.stringify({ ...VIDEO, width: 1280, height: 720, seconds: 5 }));
  await fs.writeFile(
    path.join(dir, 'output', 'orbit', `${id}.json`),
    JSON.stringify({ id, kind: 'video', maker: 'ltx', prompt: 'a street at night', width: 1280, height: 720, seconds: 5, fromImage: false, file: `orbit/${id}.mp4`, createdAt: '2026-10-20T00:00:00Z', ...extra }),
  );
}
async function galleryPicture(dir, id, extra = {}) {
  await fs.mkdir(path.join(dir, 'output', 'orbit'), { recursive: true });
  await fs.writeFile(path.join(dir, 'output', 'orbit', `${id}.png`), Buffer.from(PNG.split(',')[1], 'base64'));
  await fs.writeFile(
    path.join(dir, 'output', 'orbit', `${id}.json`),
    JSON.stringify({ id, kind: 'image', maker: 'qwen', prompt: 'a portrait', width: 1024, height: 1024, fromImage: false, file: `orbit/${id}.png`, createdAt: '2026-10-19T00:00:00Z', ...extra }),
  );
}
const refused = (message) => (e) => e.status === 422 && e.message === message;

/** Make a swap and let the pretend ComfyUI finish it. */
async function runSwap(studio, dir, state, req) {
  const job = await studio.createJob({ maker: 'person-swap', target: 'the man', ...req });
  await fs.mkdir(path.join(dir, 'output', 'orbit'), { recursive: true });
  await fs.writeFile(path.join(dir, 'output', 'orbit', `${job.id}.mp4`), 'the video bytes');
  state.done[`p${state.prompts.length}`] = `${job.id}.mp4`;
  for (let i = 0; i < 20 && !['done', 'error'].includes(studio.job(job.id).status); i++) await studio.poll();
  return studio.job(job.id);
}
const check = (answer) => ({ check: async () => answer });

// ---------------------------------------------------------------- the rules

test('adult swap rules: a saved adult character in a video made here from words; never an upload or a photo', async () => {
  const { dir, state, studio } = await setup();
  const upload = await studio.saveMedia(Readable.from([Buffer.from(JSON.stringify(VIDEO))]), 'video/mp4');
  await galleryVideo(dir, 'clean01'); // made from words by a video maker
  await galleryVideo(dir, 'upl001', { photo: true }); // made from an uploaded photo
  await galleryVideo(dir, 'guard1', { photoGuard: true }); // a swap result
  await galleryPicture(dir, 'pic001', { photo: true }); // an uploaded photo's picture
  await galleryPicture(dir, 'pic002'); // a picture made from words
  await galleryVideo(dir, 'chain01', { fromImage: true, maker: 'ltx', sources: ['pic001'] }); // started from the photo
  await galleryVideo(dir, 'chain02', { fromImage: true, maker: 'ltx', sources: ['pic002'] }); // started from a clean picture
  await galleryVideo(dir, 'chain03', { fromImage: true, maker: 'ltx', sources: ['chain01'] }); // two steps back
  await galleryVideo(dir, 'gone01', { fromImage: true, maker: 'ltx', sources: ['nowhere1'] }); // a source that is no longer known
  await galleryVideo(dir, 'old001', { fromImage: true }); // older note: started from a picture, unknown which
  await galleryVideo(dir, 'imp001', { fromImage: undefined, maker: 'cloud-fal' }); // imported: nothing known
  await galleryVideo(dir, 'cut001', { fromImage: undefined, movie: 'm1' }); // a cut movie: nothing known
  await galleryVideo(dir, 'edit01', { fromImage: false, maker: 'video-erase' }); // an edit of some other video
  await galleryVideo(dir, 'nsfw001', { nsfw: true }); // made here, NSFW

  const adult = (videoItem, extra = {}) => ({ maker: 'person-swap', target: 'the man', character: 'anna01', adult: true, videoItem, ...extra });
  // Not eligible: refused with the plain reason.
  for (const id of ['upl001', 'guard1', 'chain01', 'chain03', 'gone01', 'old001', 'imp001', 'cut001', 'edit01']) {
    await assert.rejects(studio.createJob(adult(id)), refused(ADULT_SWAP_MESSAGE), id);
  }
  assert.equal(ADULT_SWAP_MESSAGE, 'Adult swaps only work with a character you made here, on a video made here.');
  // An uploaded video, however the character is: refused too.
  await assert.rejects(studio.createJob({ maker: 'person-swap', target: 'the man', character: 'anna01', adult: true, videoUpload: upload.id }), refused(ADULT_SWAP_MESSAGE));
  // Adult with an uploaded photo instead of a character: the same plain refusal.
  await assert.rejects(studio.createJob({ maker: 'person-swap', target: 'the man', image: PNG, adult: true, videoItem: 'clean01' }), refused(ADULT_SWAP_MESSAGE));
  // A photo into a video marked NSFW, no character: the old message, unchanged.
  await assert.rejects(studio.createJob({ maker: 'person-swap', target: 'the man', image: PNG, videoItem: 'nsfw001' }), refused(SWAP_NSFW_MESSAGE));
  // A character into an NSFW video that was not made here: the adult message.
  await galleryVideo(dir, 'nsfw002', { nsfw: true, photo: true });
  await assert.rejects(studio.createJob({ maker: 'person-swap', target: 'the man', character: 'anna01', videoItem: 'nsfw002' }), refused(ADULT_SWAP_MESSAGE));

  // Characters must be adult and fictional; a photo can't be added next to one.
  await assert.rejects(studio.createJob(adult('clean01', { character: 'kid001' })), refused(CHARACTER_MESSAGE));
  await assert.rejects(studio.createJob(adult('clean01', { character: 'fake01' })), refused(CHARACTER_MESSAGE));
  await assert.rejects(studio.createJob(adult('clean01', { character: 'nobody' })), (e) => e.status === 404);
  await assert.rejects(studio.createJob(adult('clean01', { image: PNG })), /character or add a photo, not both/);
  // Children and sexual words about children stay blocked whatever else is true.
  await assert.rejects(studio.createJob(adult('clean01', { target: 'the little girl' })), (e) => e.status === 422 && /adults/.test(e.message));
  await assert.rejects(studio.createJob(adult('clean01', { prompt: 'a nude 15 year old girl' })), (e) => e.status === 422 && e.message === BLOCKED_MESSAGE);
  await assert.rejects(studio.createJob(adult('clean01', { target: 'her shirt' })), refused(PHOTO_MESSAGE));

  // Allowed: made here from words (directly, or through clean pictures).
  for (const id of ['clean01', 'chain02', 'nsfw001']) {
    const job = await studio.createJob(adult(id));
    await studio.cancel(job.id);
    const wf = state.prompts.at(-1);
    assert.match(wf[40].inputs.image, /^orbit-.+\.png$/, 'the character sheet is the new person');
    assert.match(wf[42].inputs.image, /^orbit-.+\.png$/, 'and its second picture the face close-up');
  }
});

test('a character in an uploaded video is an ordinary swap: not adult, and still checked like a photo', async () => {
  const { dir, state, studio } = await setup({ nsfw: check({ nsfw: false, score: 0.01 }) });
  const upload = await studio.saveMedia(Readable.from([Buffer.from(JSON.stringify(VIDEO))]), 'video/mp4');
  const job = await runSwap(studio, dir, state, { character: 'anna01', videoUpload: upload.id });
  assert.equal(job.status, 'done', job.error);
  const item = await studio.item(job.id);
  assert.equal(item.photo, true, 'an uploaded video may show real people');
  assert.equal(item.photoGuard, true);
  assert.equal(item.adultSwap, undefined);
  assert.deepEqual(item.character, { id: 'anna01', name: 'Anna' });
});

// ---------------------------------------------------------------- hold instead of delete

test('a flagged swap with a real person is held, not deleted: kept on this machine, out of every listing', async () => {
  const { dir, state, studio } = await setup({ nsfw: check({ nsfw: true, score: 0.97 }) });
  const v = await studio.saveMedia(Readable.from([Buffer.from(JSON.stringify(VIDEO))]), 'video/mp4');
  const job = await runSwap(studio, dir, state, { videoUpload: v.id, image: PNG, owner: 'm:afterdark:ann' });
  assert.equal(job.status, 'error');
  assert.equal(job.error, PHOTO_MESSAGE, 'the person is told the same as before');
  // Out of the gallery, the Lab and the listings.
  assert.equal(await studio.item(job.id), null);
  assert.deepEqual(await studio.items(), []);
  assert.deepEqual(await studio.labItems(), []);
  assert.equal(await studio.file(job.id), null);
  await assert.rejects(fs.stat(path.join(dir, 'output', 'orbit', `${job.id}.mp4`)), 'not left in the gallery folder');
  // Kept, with everything the owner needs.
  const held = await studio.held.list();
  assert.equal(held.length, 1);
  const [h] = held;
  assert.equal(h.id, job.id);
  assert.equal(h.status, 'held');
  assert.equal(h.category, 'flagged');
  assert.match(h.reason, /adult content/);
  assert.equal(h.owner, 'm:afterdark:ann');
  assert.equal(h.request.target, 'the man');
  assert.equal(h.request.photoUpload, true);
  assert.equal(h.canApprove, false, "a real person's photo is never approved into a gallery");
  assert.ok(h.heldAt);
  assert.equal(await fs.readFile(path.join(dir, 'held', `${job.id}.mp4`), 'utf8'), 'the video bytes', 'the file itself is kept');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'held', `${job.id}.json`), 'utf8')).item.id, job.id, 'and its note');
  const file = await studio.held.file(job.id);
  assert.equal(file.type, 'video/mp4');
  // Approving that one is refused; a note is fine; nothing here deletes.
  await assert.rejects(studio.held.approve(job.id), (e) => e.status === 409 && e.message === APPROVE_BLOCKED_MESSAGE);
  const noted = await studio.held.note(job.id, 'Checked, stays held.');
  assert.equal(noted.notes.length, 1);
  assert.equal(noted.notes[0].text, 'Checked, stays held.');
  assert.equal(noted.notes[0].by, 'owner');
  assert.equal(typeof studio.held.remove, 'undefined');
  assert.equal(typeof studio.held.delete, 'undefined');
  assert.equal((await studio.held.list()).length, 1);
});

test('when the check could not look, the result is held too (and the person is told plainly)', async () => {
  const { dir, state, studio } = await setup();
  await galleryVideo(dir, 'clean01');
  const job = await runSwap(studio, dir, state, { videoItem: 'clean01', character: 'anna01', adult: true });
  assert.equal(job.status, 'error');
  assert.equal(job.error, CHECK_MESSAGE);
  assert.match(CHECK_MESSAGE, /set aside for a person to review/);
  assert.equal(await studio.item(job.id), null);
  const [h] = await studio.held.list();
  assert.equal(h.category, 'checker-unavailable');
  assert.equal(h.canApprove, true, 'a fictional character in a video made here can be approved');
  assert.deepEqual(h.character, { id: 'anna01', name: 'Anna' });
  assert.equal(h.request.character, 'anna01');
  assert.equal(h.nsfw, true, 'marked NSFW because the adult option was on');
  assert.equal((await fs.readFile(path.join(dir, 'held', `${job.id}.mp4`), 'utf8')), 'the video bytes');
});

test('an allowed adult swap that the check flags just shows blurred in the gallery: not held', async () => {
  const { dir, state, studio } = await setup({ nsfw: check({ nsfw: true, score: 0.9 }) });
  await galleryVideo(dir, 'clean01');
  const job = await runSwap(studio, dir, state, { videoItem: 'clean01', character: 'anna01', adult: true });
  assert.equal(job.status, 'done', job.error);
  const it = await studio.item(job.id);
  assert.equal(it.nsfw, true);
  assert.equal(it.adultSwap, true);
  assert.deepEqual(it.sources, ['clean01']);
  assert.equal((await studio.items()).length, 2);
  assert.deepEqual(await studio.held.list(), []);
});

test('the one exception: a result that could show someone under 18 is removed, not held', async () => {
  const { dir, state, studio } = await setup({ nsfw: check({ nsfw: true, minor: true, score: 0.99 }) });
  await galleryVideo(dir, 'clean01');
  const job = await runSwap(studio, dir, state, { videoItem: 'clean01', character: 'anna01', adult: true });
  assert.equal(job.status, 'error');
  assert.equal(job.error, BLOCKED_MESSAGE);
  assert.equal(await studio.item(job.id), null);
  assert.deepEqual(await studio.held.list(), [], 'nothing is kept');
  await assert.rejects(fs.stat(path.join(dir, 'output', 'orbit', `${job.id}.mp4`)));
  await assert.rejects(fs.stat(path.join(dir, 'held', `${job.id}.mp4`)));
  await assert.rejects(fs.stat(path.join(dir, 'held', `${job.id}.json`)));
});

test('with R2, held results live under held/ and never under the gallery prefix', async () => {
  const { r2, objects } = memoryR2();
  const { dir, state, studio } = await setup({ r2, nsfw: check({ nsfw: true, score: 0.97 }) });
  const v = await studio.saveMedia(Readable.from([Buffer.from(JSON.stringify(VIDEO))]), 'video/mp4');
  const job = await runSwap(studio, dir, state, { videoUpload: v.id, image: PNG });
  assert.equal(job.status, 'error');
  assert.ok(objects.has(`held/${job.id}.json`));
  assert.equal(objects.get(`held/${job.id}.mp4`).toString(), 'the video bytes');
  assert.deepEqual([...objects.keys()].filter((k) => k.startsWith('gallery/') && k.includes(job.id)), [], 'not in the gallery prefix, file or note');
  assert.deepEqual(await fs.readdir(path.join(dir, 'held')).catch(() => []), [], 'R2 is its home: nothing left on the drive');
  const [h] = await studio.held.list();
  assert.equal(h.id, job.id);
  assert.equal((await studio.held.file(job.id)).size, 'the video bytes'.length, 'brought down from R2 to look at');
  assert.equal(await studio.item(job.id), null);
});

test('approve puts it back in that person\'s gallery with its NSFW mark, an audit line, and the held copy goes', async () => {
  const { r2, objects } = memoryR2();
  const { dir, state, studio } = await setup({ r2 });
  await galleryVideo(dir, 'clean01');
  const job = await runSwap(studio, dir, state, { videoItem: 'clean01', character: 'anna01', adult: true, owner: 'm:afterdark:ann' });
  assert.equal(job.error, CHECK_MESSAGE);
  assert.ok(objects.has(`held/${job.id}.mp4`));
  assert.equal(await studio.item(job.id), null);

  const rec = await studio.held.approve(job.id);
  assert.equal(rec.status, 'approved');
  assert.ok(rec.approvedAt);
  const it = await studio.item(job.id);
  assert.equal(it.nsfw, true, 'the NSFW mark is intact: the blur and hold-to-reveal still apply');
  assert.equal(it.owner, 'm:afterdark:ann', "back in that person's gallery");
  assert.equal(it.review.length, 1);
  assert.equal(it.review[0].action, 'approved');
  assert.equal(it.review[0].by, 'owner');
  assert.ok(it.review[0].at);
  assert.equal(await fs.readFile(path.join(dir, 'output', 'orbit', `${job.id}.mp4`), 'utf8'), 'the video bytes');
  assert.ok((await studio.items()).some((x) => x.id === job.id));
  assert.deepEqual(await studio.held.list(), []);
  assert.ok(objects.has(`gallery/orbit/${job.id}.json`), 'mirrored to the gallery prefix now');
  assert.ok(objects.has(`gallery/orbit/${job.id}.mp4`));
  assert.ok(!objects.has(`held/${job.id}.mp4`), 'the held copy moved');
  assert.equal(JSON.parse(objects.get(`held/${job.id}.json`)).status, 'approved', 'the record stays, with who and when');
  assert.equal(await studio.held.approve(job.id), null, 'once');
});

// ---------------------------------------------------------------- the gate: owner only, no delete

test('the gate: the owner lists, approves and annotates held results; members and others cannot; nothing deletes', async () => {
  const SECRET = 'h'.repeat(40);
  const { dir, state, studio } = await setup({});
  await galleryVideo(dir, 'clean01');
  const job = await runSwap(studio, dir, state, { videoItem: 'clean01', character: 'anna01', adult: true });
  assert.equal(job.error, CHECK_MESSAGE);
  const gate = createGate({ secret: SECRET, webui: 'http://127.0.0.1:9', ollama: 'http://127.0.0.1:9', allowedOrigins: 'https://site.example', siteUrl: 'https://site.example', status: async () => ({}), studio }, quiet);
  const port = await new Promise((r) => gate.listen(0, '127.0.0.1', () => r(gate.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const owner = { authorization: `Bearer ${signJwt({ sub: 'jd', aud: 'orbit-ai' }, SECRET, { expiresIn: 600 })}`, 'content-type': 'application/json' };
  const member = { authorization: `Bearer ${signJwt({ sub: 'ann', aud: 'studio-member', studio: 'afterdark' }, SECRET, { expiresIn: 600 })}` };
  try {
    assert.equal((await fetch(`${base}/_orbit/studio/held`)).status, 401);
    assert.equal((await fetch(`${base}/_orbit/studio/held`, { headers: member })).status, 401, 'a studio member is never a reviewer');
    assert.equal((await fetch(`${base}/_studio/held`, { headers: member })).status, 404);
    const list = await (await fetch(`${base}/_orbit/studio/held`, { headers: owner })).json();
    assert.equal(list.items.length, 1);
    const [h] = list.items;
    assert.equal(h.id, job.id);
    assert.equal(h.madeBy, 'You');
    assert.equal(h.character.name, 'Anna');
    assert.match(h.reason, /safety check/);
    assert.match(h.url, /^\/_orbit\/studio\/held\/file\/.+\?t=/);
    // The preview link works without a header (an <img>/<video> tag), only for that item, for an hour.
    const media = await fetch(`${base}${h.url}`);
    assert.equal(media.status, 200);
    assert.equal(await media.text(), 'the video bytes');
    assert.equal((await fetch(`${base}/_orbit/studio/held/file/${job.id}`)).status, 401);
    // The gallery's links never open a held file.
    const g = await (await fetch(`${base}/_orbit/studio/items`, { headers: owner })).json();
    assert.deepEqual(g.items.map((x) => x.id).sort(), ['clean01']);
    // A note.
    const noted = await fetch(`${base}/_orbit/studio/held/${job.id}/note`, { method: 'POST', headers: owner, body: JSON.stringify({ text: 'Looks fine, wait for the check.' }) });
    assert.equal(noted.status, 200);
    assert.equal((await noted.json()).item.notes[0].text, 'Looks fine, wait for the check.');
    assert.equal((await fetch(`${base}/_orbit/studio/held/${job.id}/note`, { method: 'POST', headers: owner, body: '{"text":" "}' })).status, 400);
    // No delete anywhere.
    for (const url of [`/_orbit/studio/held/${job.id}`, `/_orbit/studio/held/${job.id}/approve`, `/_orbit/studio/held`]) {
      const r = await fetch(`${base}${url}`, { method: 'DELETE', headers: owner });
      assert.ok([404, 405].includes(r.status), `${url} ${r.status}`);
    }
    assert.equal((await studio.held.list()).length, 1, 'still held');
    // Approve.
    const ok = await fetch(`${base}/_orbit/studio/held/${job.id}/approve`, { method: 'POST', headers: owner, body: '{}' });
    assert.equal(ok.status, 200);
    assert.equal((await (await fetch(`${base}/_orbit/studio/held`, { headers: owner })).json()).items.length, 0);
    const after = await (await fetch(`${base}/_orbit/studio/items`, { headers: owner })).json();
    assert.ok(after.items.some((x) => x.id === job.id && x.nsfw === true));
    assert.equal((await fetch(`${base}/_orbit/studio/held/${job.id}/approve`, { method: 'POST', headers: owner, body: '{}' })).status, 404);
  } finally {
    gate.close();
  }
});

test('held results are not served by the studio members\' door either', async () => {
  const SECRET = 'm'.repeat(40);
  const { dir, state, studio } = await setup({ nsfw: check({ nsfw: true, score: 0.97 }) });
  const v = await studio.saveMedia(Readable.from([Buffer.from(JSON.stringify(VIDEO))]), 'video/mp4');
  const job = await runSwap(studio, dir, state, { videoUpload: v.id, image: PNG, owner: 'm:afterdark:ann' });
  const gate = createGate({ secret: SECRET, webui: 'http://127.0.0.1:9', ollama: 'http://127.0.0.1:9', allowedOrigins: 'https://site.example', siteUrl: 'https://site.example', status: async () => ({}), studio }, quiet);
  const port = await new Promise((r) => gate.listen(0, '127.0.0.1', () => r(gate.address().port)));
  const member = { authorization: `Bearer ${signJwt({ sub: 'afterdark:ann', aud: 'studio-member', studio: 'afterdark' }, SECRET, { expiresIn: 600 })}` };
  try {
    const items = await (await fetch(`http://127.0.0.1:${port}/_studio/items`, { headers: member })).json();
    assert.deepEqual(items.items ?? [], [], 'not in their own list');
    assert.ok(job.id);
  } finally {
    gate.close();
  }
  void http;
});
