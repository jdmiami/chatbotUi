// soReal (one idea in, a whole movie out): the first-and-last-frame video recipe, the story writer,
// and the auto movie from story to final cut, with a pretend studio and a pretend ComfyUI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMovies, shotCount, stitchArgs } from '../src/movies.js';
import { BLOCKED_MESSAGE, PHOTO_MESSAGE, createStudio } from '../src/studio.js';
import { checkMovieText, createWriter, fallbackStory, parseStory } from '../src/story.js';
import { h3Workflow, videoWorkflow } from '../src/workflows.js';

const tmp = (p) => fs.mkdtemp(path.join(os.tmpdir(), p));
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const quiet = { warn() {}, info() {} };
/** Until the movie reaches `phase` and its run has ended. */
const at = (movies, id, phase) =>
  until(async () => {
    const x = await movies.get(id);
    return x.phase === phase && !x.running;
  });

/** Every input that points at another node points at one that exists. */
function linksResolve(wf) {
  for (const [id, node] of Object.entries(wf)) {
    for (const [name, v] of Object.entries(node.inputs)) {
      if (Array.isArray(v) && typeof v[0] === 'string') assert.ok(wf[v[0]], `node ${id} (${node.class_type}) input ${name} points at missing node ${v[0]}`);
    }
  }
}
const ofType = (wf, t) => Object.entries(wf).filter(([, n]) => n.class_type === t);

test('LTX first and last frame: guides at the start and the end in both passes, cropped out before upscaling and decoding', () => {
  const plain = videoWorkflow({ prompt: 'p', width: 704, height: 1280, seconds: 5, image: 'a.png', seed: 1 });
  assert.equal(ofType(plain, 'LTXVAddGuide').length, 0);
  linksResolve(plain);

  const wf = videoWorkflow({ prompt: 'p', width: 704, height: 1280, seconds: 5, image: 'a.png', endImage: 'b.png', seed: 1 });
  linksResolve(wf);
  // The in-place first-frame nodes are replaced by guides.
  assert.equal(ofType(wf, 'LTXVImgToVideoInplace').length, 0);
  const guides = ofType(wf, 'LTXVAddGuide').map(([, n]) => n.inputs);
  assert.deepEqual(guides.map((g) => g.frame_idx), [0, -1, 0, -1]);
  assert.deepEqual(guides.map((g) => g.strength), [0.7, 0.7, 1, 1]);
  assert.deepEqual(guides.map((g) => g.image[0]), ['23', '27', '23', '27']);
  assert.deepEqual(
    ofType(wf, 'LoadImage').map(([, n]) => n.inputs.image),
    ['a.png', 'b.png'],
  );
  // Pass 1 samples the guided latent; the upscaler gets it with the guide frames cropped out.
  assert.deepEqual(wf[33].inputs.video_latent, ['61', 2]);
  assert.deepEqual(wf[35].inputs.positive, ['61', 0]);
  assert.equal(wf[62].class_type, 'LTXVCropGuides');
  assert.deepEqual(wf[40].inputs.samples, ['62', 2]);
  // Pass 2 is guided again and cropped before decoding.
  assert.deepEqual(wf[42].inputs.video_latent, ['64', 2]);
  assert.deepEqual(wf[44].inputs.positive, ['64', 0]);
  assert.deepEqual(wf[65].inputs.latent, ['48', 0]);
  assert.deepEqual(wf[50].inputs.samples, ['65', 2]);
  // Only the end picture: one guide per pass.
  const endOnly = videoWorkflow({ prompt: 'p', seconds: 5, endImage: 'b.png', seed: 1 });
  linksResolve(endOnly);
  assert.deepEqual(ofType(endOnly, 'LTXVAddGuide').map(([, n]) => n.inputs.frame_idx), [-1, -1]);
});

test('H3 first and last frame use its own last_frame input', () => {
  const wf = h3Workflow({ prompt: 'p', width: 704, height: 1280, seconds: 5, image: 'a.png', endImage: 'b.png', seed: 1 });
  linksResolve(wf);
  assert.deepEqual(wf[5].inputs.first_frame, ['21', 0]);
  assert.deepEqual(wf[5].inputs.last_frame, ['23', 0]);
  assert.equal(wf[22].inputs.image, 'b.png');
  assert.equal(h3Workflow({ prompt: 'p', seed: 1 })[5].inputs.last_frame, undefined);
});

/** A pretend ComfyUI that takes jobs and keeps what it was sent. */
function fakeComfy(sent) {
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'huggingface.co') return new Response('nope', { status: 404 });
    if (u.pathname.startsWith('/api/')) return Response.json({ models: [] });
    if (u.pathname === '/prompt') {
      sent.push(JSON.parse(init.body).prompt);
      return Response.json({ prompt_id: `p${sent.length}` });
    }
    if (u.pathname === '/queue') return Response.json({ queue_running: [], queue_pending: [] });
    return Response.json({});
  };
}

test('studio: a video between two gallery pictures, with the photo rule for either one', async () => {
  const dir = await tmp('soreal-studio-');
  const files = { image: [{ dir: 'diffusion_models', name: 'img.safetensors', size: 4 }], video: [{ dir: 'checkpoints', name: 'vid.safetensors', size: 4 }] };
  for (const f of [...files.image, ...files.video]) {
    await fs.mkdir(path.join(dir, 'models', f.dir), { recursive: true });
    await fs.writeFile(path.join(dir, 'models', f.dir, f.name), 'abcd');
  }
  const meta = path.join(dir, 'output', 'orbit');
  await fs.mkdir(meta, { recursive: true });
  for (const [id, photo] of [['frameaaa1', false], ['framebbb2', false], ['photoccc3', true]]) {
    await fs.writeFile(path.join(dir, 'output', 'orbit', `${id}.png`), 'png');
    await fs.writeFile(path.join(meta, `${id}.json`), JSON.stringify({ id, kind: 'image', file: `orbit/${id}.png`, photo: photo || undefined }));
  }
  const sent = [];
  const studio = createStudio({ dir, files, fetchImpl: fakeComfy(sent), WebSocketImpl: null, log: quiet });
  const job = await studio.createJob({ kind: 'video', prompt: 'she turns and smiles', size: 'portrait', seconds: 5, fromItem: 'frameaaa1', toItem: 'framebbb2' });
  assert.equal(job.status, 'queued');
  await until(() => sent.length === 1);
  const wf = sent[0];
  const loads = ofType(wf, 'LoadImage').map(([, n]) => n.inputs.image);
  assert.equal(loads.length, 2);
  assert.ok(loads.every((n) => n.startsWith('orbit-')));
  assert.equal(ofType(wf, 'LTXVAddGuide').length, 4);
  // A picture that came from someone's photo keeps the photo rule, as the start or the end.
  await assert.rejects(
    studio.createJob({ kind: 'video', prompt: 'she undresses', fromItem: 'frameaaa1', toItem: 'photoccc3' }),
    (e) => e.status === 422 && e.message === PHOTO_MESSAGE,
  );
  // Learned timings give estimates: a video takes longer than a picture, a cold start longer still.
  const pic = studio.estimate({ kind: 'image', maker: 'qwen', size: 'tall' });
  const vid = studio.estimate({ kind: 'video', maker: 'ltx', size: 'portrait', seconds: 5 });
  assert.ok(pic > 0 && vid > pic);
  assert.ok(studio.estimate({ kind: 'video', maker: 'ltx', size: 'portrait', seconds: 5, cold: true }) > vid);
});

test('story: reads JSON, a fenced reply or a plain list, and always gives the number of shots asked for', () => {
  const json = parseStory(
    'Sure!\n```json\n{"title":"Night Run","lead":"A tall woman in a red coat","look":"neon noir","sound":"music","opening":"Rain on a dark street",' +
      '"shots":[{"action":"She runs.","end":"She stops at a door."},{"action":"She knocks.","end":"The door opens."}]}\n```',
    3,
  );
  assert.equal(json.title, 'Night Run');
  assert.equal(json.sound, 'music');
  assert.equal(json.shots.length, 3);
  assert.deepEqual(json.shots[0], { action: 'She runs.', end: 'She stops at a door.' });
  const list = parseStory('1. A cat wakes up\n2. It stretches\n3. It jumps\n4. It lands', 2);
  assert.deepEqual(list.shots.map((s) => s.action), ['A cat wakes up', 'It stretches']);
  assert.equal(parseStory('nothing useful here', 2), null);
  const plain = fallbackStory({ idea: 'A dog surfs a big wave.', template: 'comedy', count: 4 });
  assert.equal(plain.shots.length, 4);
  assert.match(plain.shots[0].action, /^A dog surfs a big wave\. It begins\./);
  assert.equal(plain.sound, 'shots');
  assert.equal(shotCount(30), 6);
  assert.equal(shotCount(10), 2);
});

test('story: the writer falls back to a plain story when the chat model is missing or confused', async () => {
  const none = createWriter({ chat: async () => { throw new Error('No chat model is installed on the AI machine.'); }, log: quiet });
  const a = await none({ idea: 'Two friends race kites', count: 2, seconds: 5, shape: 'portrait' });
  assert.equal(a.by, 'plain');
  assert.equal(a.shots.length, 2);
  let asked;
  const ok = createWriter({ chat: async (m) => ((asked = m), '{"shots":["One.","Two."]}'), log: quiet });
  const b = await ok({ idea: 'Two friends race kites', template: 'trailer', count: 2, seconds: 5, shape: 'portrait' });
  assert.equal(b.by, 'ai');
  assert.match(asked.system, /exactly 2 shots of about 5 seconds/);
  assert.match(asked.user, /vertical 9:16/);
  assert.match(asked.user, /movie trailer/);
});

test('content rules: never sexual content involving minors; nothing sexual with a photo lead', () => {
  assert.throws(() => checkMovieText(['a schoolgirl', 'nude scene']), (e) => e.status === 422 && e.message === BLOCKED_MESSAGE);
  assert.doesNotThrow(() => checkMovieText(['two adults dance at a wedding']));
  assert.throws(() => checkMovieText(['she slowly undresses'], { photo: true }), (e) => e.status === 422 && e.message === PHOTO_MESSAGE);
  assert.doesNotThrow(() => checkMovieText(['she slowly undresses']));
});

/**
 * A studio stand-in: each job finishes on its next look with a new gallery picture or video.
 * `hold` keeps jobs running; `failNext` makes the next job fail.
 */
function fakeStudio() {
  const items = new Map();
  const jobs = new Map();
  const reqs = [];
  let n = 0;
  const studio = {
    reqs,
    items,
    hold: false,
    failNext: null,
    async item(id) {
      return items.get(id) || null;
    },
    async createJob(req) {
      reqs.push(req);
      const id = `job${String(++n).padStart(4, '0')}`;
      const job = { id, status: 'queued', req, fail: studio.failNext };
      studio.failNext = null;
      jobs.set(id, job);
      return { id, status: 'queued' };
    },
    job(id) {
      const j = jobs.get(id);
      if (j && j.status === 'queued' && !studio.hold) {
        if (j.fail) Object.assign(j, { status: 'error', error: j.fail });
        else {
          const video = j.req.kind === 'video';
          const item = { id: `item${j.id.slice(3)}`, kind: video ? 'video' : 'image', seconds: video ? 5 : undefined, width: 704, height: 1280, photo: Boolean(j.req.image) || undefined };
          items.set(item.id, item);
          Object.assign(j, { status: 'done', item });
        }
      }
      return j ? { id: j.id, status: j.status, error: j.error, item: j.item, etaSeconds: j.status === 'queued' ? 99 : null } : null;
    },
    async cancel(id) {
      const j = jobs.get(id);
      if (j) j.status = 'stopped';
      return j;
    },
    estimate: ({ kind, maker, cold }) => (kind === 'video' ? 200 : maker === 'edit' ? 60 : 45) + (cold ? 90 : 0),
    itemPath: async (id) => `/v/${id}.mp4`,
    addItem: async (it) => {
      const item = { id: `cut${String(++n).padStart(4, '0')}`, ...it };
      items.set(item.id, item);
      return item;
    },
  };
  return studio;
}

const STORY = JSON.stringify({
  title: 'Kite Day',
  lead: 'A cheerful woman in her thirties in a yellow raincoat',
  look: 'Bright, windy, 35 mm film',
  sound: 'music',
  opening: 'A grassy hill under a blue sky',
  shots: [
    { action: 'She runs up the hill with a red kite.', end: 'She stands at the top holding the kite.' },
    { action: 'The kite lifts into the wind.', end: 'The kite high in the sky.' },
  ],
});

test('one idea, a whole movie: story, lead, storyboard, shots between storyboard pictures, final cut', async () => {
  const dir = await tmp('soreal-');
  const studio = fakeStudio();
  const ffmpeg = [];
  const asked = [];
  const movies = createMovies({ dir, studio, pollMs: 1, ffmpeg: async (a) => ffmpeg.push(a), chat: async (m) => (asked.push(m), STORY), log: quiet });
  const m = await movies.create({ idea: 'A woman flies a kite on a windy hill', length: 10, template: 'music-video' });
  assert.equal(m.flow, 'auto');
  assert.equal(m.size, 'portrait');
  assert.equal(m.phase, 'draft');
  assert.equal(m.etaSeconds, 45 + 135 + 60 * 3 + 290 + 200 + 20);
  await movies.run(m.id);
  await at(movies, m.id, 'done');
  const done = await movies.get(m.id);
  assert.equal(done.running, false);
  assert.equal(done.title, 'Kite Day');
  assert.equal(done.lead.mode, 'ai');
  assert.equal(done.soundPicked, 'music');
  assert.equal(done.shots.length, 2);
  assert.equal(done.frames.length, 3);
  assert.equal(done.etaSeconds, 0);
  const [lead, f0, f1, f2, s1, s2] = studio.reqs;
  assert.equal(lead.maker, 'qwen');
  assert.equal(lead.size, 'tall');
  assert.match(lead.prompt, /yellow raincoat/);
  // Every storyboard picture is the lead in a new scene (the edit maker keeps the face).
  for (const f of [f0, f1, f2]) assert.deepEqual([f.maker, f.fromItem], ['edit', done.lead.itemId]);
  assert.match(f1.prompt, /She stands at the top holding the kite\./);
  // Each shot is made between its two storyboard pictures.
  assert.deepEqual([s1.fromItem, s1.toItem], [done.frames[0].itemId, done.frames[1].itemId]);
  assert.deepEqual([s2.fromItem, s2.toItem], [done.frames[1].itemId, done.frames[2].itemId]);
  assert.equal(s1.size, 'portrait');
  assert.equal(s1.seconds, 5);
  assert.match(s1.prompt, /music only/);
  assert.equal(studio.reqs.length, 6);
  assert.ok(done.render?.itemId);
  assert.equal(ffmpeg.length, 1);
  assert.match(asked[0].user, /music video/);
});

test('checking the storyboard first: it waits after the pictures, then makes the shots once approved', async () => {
  const dir = await tmp('soreal-');
  const studio = fakeStudio();
  const movies = createMovies({ dir, studio, pollMs: 1, ffmpeg: async () => {}, chat: async () => STORY, log: quiet });
  const m = await movies.create({ idea: 'A kite', length: 10, reviewStoryboard: true, lead: { mode: 'none' } });
  await movies.run(m.id);
  await at(movies, m.id, 'review');
  let r = await movies.get(m.id);
  assert.equal(r.running, false);
  assert.equal(r.lead.mode, 'none');
  assert.ok(r.frames.every((f) => f.status === 'done'));
  // No lead: the first picture is made from words, the others from it (same place and style).
  assert.deepEqual(studio.reqs.map((q) => q.maker), ['qwen', 'edit', 'edit']);
  assert.equal(studio.reqs[1].fromItem, r.frames[0].itemId);
  // Redo one picture with new words: only that one is made again.
  r = await movies.update(m.id, { frames: [{ id: r.frames[2].id, prompt: 'The kite caught in a tree' }] });
  assert.deepEqual(r.frames.map((f) => f.status), ['done', 'done', 'todo']);
  await movies.run(m.id);
  await at(movies, m.id, 'review');
  assert.equal(studio.reqs.length, 4);
  assert.match(studio.reqs[3].prompt, /caught in a tree/);
  await movies.run(m.id, { approve: true });
  await at(movies, m.id, 'done');
  assert.deepEqual(studio.reqs.slice(4).map((q) => q.kind), ['video', 'video']);
});

test('after making: redo one shot, reorder and trim without remaking the rest', async () => {
  const dir = await tmp('soreal-');
  const studio = fakeStudio();
  const ffmpeg = [];
  const movies = createMovies({ dir, studio, pollMs: 1, ffmpeg: async (a) => ffmpeg.push(a), chat: async () => STORY, log: quiet });
  const m = await movies.create({ idea: 'A kite', length: 10, lead: { mode: 'none' } });
  await movies.run(m.id);
  await at(movies, m.id, 'done');
  const done = await movies.get(m.id);
  const made = studio.reqs.length;
  // Redo the second shot only.
  let r = await movies.update(m.id, { shots: done.shots.map((s, i) => ({ ...s, redo: i === 1 })) });
  assert.deepEqual(r.shots.map((s) => s.status), ['done', 'todo']);
  assert.equal(r.render.stale, true);
  await movies.run(m.id);
  await at(movies, m.id, 'done');
  assert.equal(studio.reqs.length, made + 1);
  assert.equal(studio.reqs[made].fromItem, done.frames[1].itemId);
  assert.equal(ffmpeg.length, 2);
  // Swap them and trim the first: nothing is remade, the cut is just out of date.
  r = await movies.get(m.id);
  const [a, b] = r.shots;
  r = await movies.update(m.id, { shots: [{ ...b, trimStart: 1 }, { ...a, trimEnd: 0.5 }] });
  assert.deepEqual(r.shots.map((s) => [s.id, s.status]), [[b.id, 'done'], [a.id, 'done']]);
  assert.equal(r.render.stale, true);
  const out = await movies.render(m.id);
  assert.equal(out.movie.render.stale, undefined);
  const filter = ffmpeg[2][ffmpeg[2].indexOf('-filter_complex') + 1];
  assert.match(filter, /\[0:v\]setpts=PTS-STARTPTS,trim=start=1,setpts=PTS-STARTPTS\[v0\]/);
  assert.match(filter, /\[1:v\]trim=start_frame=1,setpts=PTS-STARTPTS,trim=end=4\.5,setpts=PTS-STARTPTS\[v1\]/);
  assert.equal(out.item.seconds, 8.5);
  // Quiet: the cut has no sound.
  await movies.update(m.id, { sound: 'quiet' });
  await movies.render(m.id);
  assert.ok(!ffmpeg[3].includes('[a]'));
  assert.equal(studio.reqs.length, made + 1);
});

test('a photo of the lead: cleaned up into a reference picture, and the photo rule covers the whole movie', async () => {
  const dir = await tmp('soreal-');
  const studio = fakeStudio();
  const movies = createMovies({ dir, studio, pollMs: 1, ffmpeg: async () => {}, chat: async () => STORY, log: quiet });
  const photo = 'data:image/png;base64,iVBORw0KGgo=';
  const m = await movies.create({ idea: 'My friend flies a kite', length: 10 });
  const withPhoto = await movies.leadPhoto(m.id, photo);
  assert.equal(withPhoto.lead.mode, 'photo');
  assert.equal(studio.reqs[0].maker, 'edit');
  assert.equal(studio.reqs[0].image, photo);
  // Words that would make a photo sexual are refused, wherever they are.
  await assert.rejects(movies.update(m.id, { idea: 'My friend strips on the hill' }), (e) => e.status === 422 && e.message === PHOTO_MESSAGE);
  const stays = await movies.get(m.id);
  assert.equal(stays.idea, 'My friend flies a kite');
  assert.equal(stays.lead.status, 'done');
  await movies.run(m.id);
  await at(movies, m.id, 'done');
  const done = await movies.get(m.id);
  // No AI-designed lead: the storyboard is made from the photo's reference picture.
  assert.equal(studio.reqs.filter((q) => q.maker === 'qwen').length, 0);
  assert.ok(studio.reqs.filter((q) => q.kind === 'image' && q.maker === 'edit' && q.fromItem === done.lead.itemId).length === 3);
  // And a movie can't be about sexual content involving minors at all.
  await assert.rejects(movies.create({ idea: 'a nude teen at 15 years old' }), (e) => e.status === 422 && e.message === BLOCKED_MESSAGE);
});

test('a writer that goes wrong, a failed shot, stop and the estimate', async () => {
  const dir = await tmp('soreal-');
  const studio = fakeStudio();
  // No chat model: the plain story still makes the movie.
  const movies = createMovies({ dir, studio, pollMs: 1, ffmpeg: async () => {}, log: quiet });
  const m = await movies.create({ idea: 'Waves at sunset', length: 20, size: 'landscape', lead: { mode: 'none' } });
  const planned = await movies.plan(m.id);
  assert.equal(planned.story, 'plain');
  assert.equal(planned.shots.length, 4);
  assert.equal(planned.frames.length, 5);
  assert.deepEqual(planned.shots[1].frames, [planned.frames[1].id, planned.frames[2].id]);
  // A shot fails: the movie stops there and says which.
  studio.failNext = null;
  const failing = studio.createJob;
  let count = 0;
  studio.createJob = async (req) => {
    if (req.kind === 'video' && ++count === 2) studio.failNext = 'out of memory';
    return failing(req);
  };
  await movies.run(m.id);
  await at(movies, m.id, 'error');
  const bad = await movies.get(m.id);
  assert.match(bad.error, /^Shot 2 could not be made: out of memory/);
  assert.deepEqual(bad.shots.map((s) => s.status), ['done', 'error', 'todo', 'todo']);
  assert.equal(bad.frames[0].status, 'done');
  // Try again picks up where it stopped; stop halts it.
  studio.hold = true;
  await movies.run(m.id);
  await until(async () => (await movies.get(m.id)).shots[1].status === 'making');
  const live = await movies.get(m.id);
  assert.equal(live.running, true);
  assert.equal(live.phase, 'shots');
  assert.equal(live.etaSeconds, 99 + 200 * 2 + 20);
  await movies.stop(m.id);
  await until(async () => !(await movies.get(m.id)).running);
  assert.equal((await movies.get(m.id)).phase, 'stopped');
  // Before a movie exists: how long one like it takes, and how many shots.
  assert.deepEqual(movies.estimate({ length: 30, size: 'portrait' }), { seconds: 45 + 135 + 60 * 7 + 290 + 200 * 5 + 20, shots: 6, shotSeconds: 5 });
  assert.equal(movies.estimate({ length: 99 }).shots, 6);
});

test('stitch: trims each clip by time after dropping the repeated frame', () => {
  const args = stitchArgs(['a.mp4', 'b.mp4'], 'out.mp4', { trims: [{ start: 0.5, end: 0 }, { start: 0, end: 4 }] });
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /\[0:a\]asetpts=PTS-STARTPTS,atrim=start=0\.5,asetpts=PTS-STARTPTS\[a0\]/);
  assert.match(filter, /\[1:a\]asetpts=PTS-STARTPTS,atrim=end=4,asetpts=PTS-STARTPTS\[a1\]/);
  // No trims: exactly the join it always was.
  assert.deepEqual(stitchArgs(['a.mp4'], 'o.mp4', { trims: [{ start: 0, end: 0 }] }), stitchArgs(['a.mp4'], 'o.mp4'));
});

test('gate: estimate, write the story, add a lead photo, approve the storyboard', async () => {
  const { createGate } = await import('../src/gate.js');
  const { signJwt } = await import('../src/jwt.js');
  const SECRET = 's'.repeat(40);
  const dir = await tmp('soreal-gate-');
  const studio = fakeStudio();
  studio.state = async () => ({});
  const movies = createMovies({ dir, studio, pollMs: 1, ffmpeg: async () => {}, chat: async () => STORY, log: quiet });
  const gate = createGate(
    { secret: SECRET, webui: 'http://127.0.0.1:9', ollama: 'http://127.0.0.1:9', allowedOrigins: 'https://site.example', siteUrl: 'https://site.example', userEmail: 'o@o', status: async () => ({}), studio, movies },
    quiet,
  );
  const port = await new Promise((r) => gate.listen(0, '127.0.0.1', () => r(gate.address().port)));
  const base = `http://127.0.0.1:${port}/_orbit/studio/movies`;
  const auth = { authorization: `Bearer ${signJwt({ sub: 'jd', aud: 'orbit-ai' }, SECRET, { expiresIn: 600 })}`, 'content-type': 'application/json' };
  const post = (p, body = {}) => fetch(`${base}${p}`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${base}/estimate`, { method: 'POST', body: '{}' })).status, 401);
    const est = await (await post('/estimate', { length: 20 })).json();
    assert.equal(est.shots, 4);
    const m = await (await post('', { idea: 'A kite on a hill', length: 10, reviewStoryboard: true })).json();
    const planned = await (await post(`/${m.id}/plan`)).json();
    assert.equal(planned.shots.length, 2);
    assert.equal(planned.title, 'Kite Day');
    // A big photo goes through (the movie routes otherwise take small bodies).
    const big = `data:image/png;base64,${'A'.repeat(400_000)}`;
    const lead = await (await post(`/${m.id}/lead`, { photo: big })).json();
    assert.equal(lead.lead.mode, 'photo');
    assert.equal((await post(`/${m.id}/run`)).status, 200);
    await at(movies, m.id, 'review');
    assert.equal((await post(`/${m.id}/run`, { approve: true })).status, 200);
    await at(movies, m.id, 'done');
    const blocked = await post('', { idea: 'a sexy schoolgirl' });
    assert.equal(blocked.status, 422);
    assert.equal((await blocked.json()).blocked, true);
  } finally {
    gate.close();
  }
});
