import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMovies, lastFrameArgs, runFfmpeg, stitchArgs } from '../src/movies.js';
import { PHOTO_SOURCE_MESSAGE, createStudio } from '../src/studio.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const tmp = (p) => fs.mkdtemp(path.join(os.tmpdir(), p));
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

/** A studio stand-in: every job finishes on the next poll with a new gallery video. */
function fakeStudio() {
  const items = new Map();
  const jobs = new Map();
  const reqs = [];
  let n = 0;
  const studio = {
    reqs,
    hold: false,
    items,
    async item(id) {
      return items.get(id) || null;
    },
    async createJob(req) {
      reqs.push(req);
      const id = `job${String(++n).padStart(4, '0')}`;
      const job = { id, status: 'queued' };
      jobs.set(id, job);
      return { ...job };
    },
    job(id) {
      const j = jobs.get(id);
      if (j && j.status === 'queued' && !studio.hold) {
        const item = { id: `item${j.id.slice(3)}`, kind: 'video', seconds: 5, width: 768, height: 512 };
        items.set(item.id, item);
        Object.assign(j, { status: 'done', item });
      }
      return j ? { ...j } : null;
    },
    async cancel(id) {
      const j = jobs.get(id);
      if (j) j.status = 'stopped';
      return j;
    },
  };
  return studio;
}

test('a movie makes its shots in order, each from the last frame of the one before', async () => {
  const dir = await tmp('movies-');
  const studio = fakeStudio();
  studio.items.set('startvid1', { id: 'startvid1', kind: 'video' });
  const movies = createMovies({ dir, studio, pollMs: 1, log: { warn() {} } });
  const m = await movies.create({
    title: 'Night drive',
    look: 'Neon city, a woman in a red coat',
    maker: 'ltx',
    seconds: 4,
    start: 'startvid1',
    shots: [{ prompt: 'she gets in the car' }, { prompt: 'the car pulls away' }, { prompt: 'rain on the windshield' }],
  });
  assert.equal(m.shots.length, 3);
  await movies.run(m.id);
  assert.equal(movies.busy(), true);
  await until(async () => !(await movies.get(m.id)).running);
  const done = await movies.get(m.id);
  assert.deepEqual(done.shots.map((s) => s.status), ['done', 'done', 'done']);
  assert.deepEqual(studio.reqs.map((r) => r.fromLastFrameOf), ['startvid1', done.shots[0].itemId, done.shots[1].itemId]);
  assert.equal(studio.reqs[0].prompt, 'Neon city, a woman in a red coat\n\nshe gets in the car');
  assert.equal(studio.reqs[0].seconds, 4);
  assert.equal(movies.busy(), false);

  // Changing the middle shot remakes it and everything after it; the first shot is kept.
  const shots = done.shots.map((s) => ({ ...s }));
  shots[1].prompt = 'the car spins out';
  const edited = await movies.update(m.id, { shots });
  assert.deepEqual(edited.shots.map((s) => s.status), ['done', 'todo', 'todo']);
  assert.equal(edited.shots[0].itemId, done.shots[0].itemId);
  await movies.run(m.id);
  await until(async () => !(await movies.get(m.id)).running);
  assert.equal(studio.reqs[3].fromLastFrameOf, done.shots[0].itemId);
  assert.equal((await movies.list()).length, 1);
});

test('a still picture to start from is used as the first frame; stop cancels the shot in progress', async () => {
  const dir = await tmp('movies-');
  const studio = fakeStudio();
  studio.items.set('startimg1', { id: 'startimg1', kind: 'image' });
  studio.hold = true;
  const movies = createMovies({ dir, studio, pollMs: 1, log: { warn() {} } });
  const m = await movies.create({ start: 'startimg1', shots: [{ prompt: 'waves roll in' }, { prompt: 'a gull lands' }] });
  await movies.run(m.id);
  await until(() => studio.reqs.length === 1);
  assert.equal(studio.reqs[0].fromItem, 'startimg1');
  assert.equal(studio.reqs[0].fromLastFrameOf, undefined);
  await assert.rejects(movies.update(m.id, { title: 'x' }), (e) => e.status === 409);
  await movies.stop(m.id);
  await until(async () => !(await movies.get(m.id)).running);
  assert.deepEqual((await movies.get(m.id)).shots.map((s) => s.status), ['todo', 'todo']);
  await assert.rejects(movies.create({ shots: [{ prompt: '' }] }).then((x) => movies.run(x.id)), (e) => e.status === 400);
});

test('the photo rule follows a picture from the gallery that came from an uploaded photo', async () => {
  const dir = await tmp('movies-');
  const meta = path.join(dir, 'output', 'orbit');
  await fs.mkdir(meta, { recursive: true });
  await fs.writeFile(path.join(meta, 'fromphoto1.json'), JSON.stringify({ id: 'fromphoto1', kind: 'video', photo: true, file: 'orbit/x.mp4' }));
  const studio = createStudio({ dir, files: { image: [], video: [] }, fetchImpl: async () => Response.json({}), WebSocketImpl: null, log: { warn() {} } });
  await assert.rejects(
    studio.createJob({ kind: 'video', prompt: 'she takes off her clothes', fromLastFrameOf: 'fromphoto1' }),
    (e) => e.status === 422 && e.message === PHOTO_SOURCE_MESSAGE,
  );
});

test('ffmpeg: grabs the last frame and joins clips, dropping the repeated frame at each cut', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const dir = await tmp('movies-ff-');
  const clip = (name, color, audio) =>
    execFileSync('ffmpeg', [
      '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=${color}:s=64x48:r=24:d=1`,
      ...(audio ? ['-f', 'lavfi', '-i', 'sine=f=440:d=1', '-shortest', '-c:a', 'aac'] : []),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, name),
    ]);
  clip('a.mp4', 'red', true);
  clip('b.mp4', 'blue', true);
  clip('c.mp4', 'green', false);
  const frames = (f) =>
    Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', f]).toString().trim());

  await runFfmpeg(lastFrameArgs(path.join(dir, 'a.mp4'), path.join(dir, 'last.png')));
  assert.ok((await fs.stat(path.join(dir, 'last.png'))).size > 0);

  await runFfmpeg(stitchArgs([path.join(dir, 'a.mp4'), path.join(dir, 'b.mp4')], path.join(dir, 'ab.mp4')));
  assert.equal(frames(path.join(dir, 'ab.mp4')), 24 + 23);

  // A clip without sound fails the sound join; the picture-only join works.
  await assert.rejects(runFfmpeg(stitchArgs([path.join(dir, 'a.mp4'), path.join(dir, 'c.mp4')], path.join(dir, 'ac.mp4'))));
  await runFfmpeg(stitchArgs([path.join(dir, 'a.mp4'), path.join(dir, 'c.mp4')], path.join(dir, 'ac.mp4'), { audio: false }));
  assert.equal(frames(path.join(dir, 'ac.mp4')), 47);
});

test('render joins the finished shots into one gallery video', async () => {
  const dir = await tmp('movies-');
  const studio = fakeStudio();
  const calls = [];
  const added = [];
  studio.itemPath = async (id) => `/v/${id}.mp4`;
  studio.addItem = async (it) => (added.push(it), { id: 'movieitem1', ...it });
  const movies = createMovies({ dir, studio, pollMs: 1, ffmpeg: async (args) => calls.push(args), log: { warn() {} } });
  const m = await movies.create({ title: 'Beach', shots: [{ prompt: 'a' }, { prompt: 'b' }] });
  await assert.rejects(movies.render(m.id), (e) => e.status === 400);
  await movies.run(m.id);
  await until(async () => !(await movies.get(m.id)).running);
  const out = await movies.render(m.id);
  assert.equal(out.item.id, 'movieitem1');
  assert.equal(out.movie.render.itemId, 'movieitem1');
  assert.equal(added[0].seconds, 10);
  assert.equal(added[0].movie, m.id);
  assert.deepEqual(calls[0].filter((a, i) => calls[0][i - 1] === '-i'), ['/v/item0001.mp4', '/v/item0002.mp4']);
});

test('gate: movie routes need sign-in and reach the movie plan', async () => {
  const { createGate } = await import('../src/gate.js');
  const { signJwt } = await import('../src/jwt.js');
  const SECRET = 'm'.repeat(40);
  const dir = await tmp('movies-gate-');
  const studio = fakeStudio();
  studio.state = async () => ({});
  studio.itemPath = async (id) => `/v/${id}.mp4`;
  studio.addItem = async (it) => ({ id: 'movieitem1', ...it });
  const movies = createMovies({ dir, studio, pollMs: 1, ffmpeg: async () => {}, log: { warn() {} } });
  const gate = createGate(
    { secret: SECRET, webui: 'http://127.0.0.1:9', ollama: 'http://127.0.0.1:9', allowedOrigins: 'https://site.example', siteUrl: 'https://site.example', userEmail: 'o@o', status: async () => ({}), studio, movies },
    { warn() {}, info() {} },
  );
  const port = await new Promise((r) => gate.listen(0, '127.0.0.1', () => r(gate.address().port)));
  const base = `http://127.0.0.1:${port}/_orbit/studio/movies`;
  const auth = { authorization: `Bearer ${signJwt({ sub: 'jd', aud: 'orbit-ai' }, SECRET, { expiresIn: 600 })}`, 'content-type': 'application/json' };
  try {
    assert.equal((await fetch(base)).status, 401);
    // Orbit calls from another origin, so the browser asks first whether PUT is allowed.
    const pre = await fetch(`${base}/x`, { method: 'OPTIONS', headers: { origin: 'https://site.example', 'access-control-request-method': 'PUT' } });
    assert.match(pre.headers.get('access-control-allow-methods') || '', /PUT/);
    const m = await (await fetch(base, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'T', shots: [{ prompt: 'a' }] }) })).json();
    assert.equal(m.title, 'T');
    const put = await (await fetch(`${base}/${m.id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ title: 'T2' }) })).json();
    assert.equal(put.title, 'T2');
    assert.equal((await fetch(`${base}/${m.id}/run`, { method: 'POST', headers: auth })).status, 200);
    await until(async () => !(await movies.get(m.id)).running);
    const r = await (await fetch(`${base}/${m.id}/render`, { method: 'POST', headers: auth })).json();
    assert.match(r.item.url, /^\/_orbit\/studio\/file\/movieitem1\?t=/);
    assert.equal((await (await fetch(base, { headers: auth })).json()).movies.length, 1);
    assert.equal((await fetch(`${base}/nosuchmovie`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${base}/${m.id}`, { method: 'DELETE', headers: auth })).status, 200);
  } finally {
    gate.close();
  }
});

test('removing a shot or changing what every shot is made with remakes from that point on', async () => {
  const dir = await tmp('movies-');
  const studio = fakeStudio();
  const movies = createMovies({ dir, studio, pollMs: 1, log: { warn() {} } });
  const m = await movies.create({ shots: [{ prompt: 'a' }, { prompt: 'b' }, { prompt: 'c' }] });
  await movies.run(m.id);
  await until(async () => !(await movies.get(m.id)).running);
  const done = await movies.get(m.id);
  // Shot "b" goes: "c" now follows "a", so it is remade; "a" is kept.
  const cut = await movies.update(m.id, { shots: [done.shots[0], done.shots[2]] });
  assert.deepEqual(cut.shots.map((s) => [s.prompt, s.status]), [['a', 'done'], ['c', 'todo']]);
  // Same shots, same order: nothing is remade.
  const same = await movies.update(m.id, { title: 'New name', shots: cut.shots });
  assert.deepEqual(same.shots.map((s) => s.status), ['done', 'todo']);
  // A new look applies to every shot.
  const looked = await movies.update(m.id, { look: 'film noir' });
  assert.deepEqual(looked.shots.map((s) => s.status), ['todo', 'todo']);
  assert.equal(looked.shots[0].itemId, null);
});

test('a shot whose starting picture is gone is an error, not a fresh start from words', async () => {
  const dir = await tmp('movies-');
  const studio = fakeStudio();
  const movies = createMovies({ dir, studio, pollMs: 1, log: { warn() {} } });
  const m = await movies.create({ start: 'deletedvid1', shots: [{ prompt: 'a' }] });
  await movies.run(m.id);
  await until(async () => !(await movies.get(m.id)).running);
  const after = await movies.get(m.id);
  assert.equal(after.shots[0].status, 'error');
  assert.match(after.shots[0].error, /no longer in your gallery/);
  assert.equal(studio.reqs.length, 0);
});

test('deleting a movie while it makes a shot stops it for good', async () => {
  const dir = await tmp('movies-');
  const studio = fakeStudio();
  studio.hold = true;
  const movies = createMovies({ dir, studio, pollMs: 5, log: { warn() {} } });
  const m = await movies.create({ shots: [{ prompt: 'a' }, { prompt: 'b' }] });
  await movies.run(m.id);
  await until(() => studio.reqs.length === 1);
  await movies.remove(m.id);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await movies.get(m.id), null);
  assert.equal((await movies.list()).length, 0);
  assert.equal(movies.busy(), false);
});

test('two machines share the movies: the one making a movie marks it, the other leaves it alone', async () => {
  const dir = await tmp('movies-');
  const studio = fakeStudio();
  studio.hold = true;
  let clock = Date.now();
  const now = () => clock;
  const main = createMovies({ dir, studio, pollMs: 1, now, machine: 'main', log: { warn() {} } });
  const helper = createMovies({ dir, studio, pollMs: 1, now, machine: 'helper', log: { warn() {} } });
  const m = await main.create({ shots: [{ prompt: 'a' }] });
  await helper.run(m.id);
  await until(() => studio.reqs.length === 1);
  const seen = await main.get(m.id);
  assert.equal(seen.running, true);
  assert.equal(seen.runningOn, 'helper');
  await assert.rejects(main.update(m.id, { title: 'x' }), (e) => e.status === 409 && /helper/.test(e.message));
  await assert.rejects(main.run(m.id), (e) => e.status === 409);
  await assert.rejects(main.remove(m.id), (e) => e.status === 409);
  // A mark that stopped being renewed (the helper turned off mid-shot) no longer counts.
  clock += 60_000;
  assert.equal((await main.get(m.id)).running, false);
  clock -= 60_000;
  // When the helper finishes, the mark is cleared and the main machine can change it again.
  studio.hold = false;
  await until(async () => !(await helper.get(m.id)).running);
  const after = await main.get(m.id);
  assert.equal(after.running, false);
  assert.equal(after.runningOn, null);
  assert.equal(after.shots[0].status, 'done');
  assert.equal((await main.update(m.id, { title: 'x' })).title, 'x');
});

test('the main machine keeps a maker the helper is making a movie with', async () => {
  const { createStudio: make } = await import('../src/studio.js');
  const dir = await tmp('movies-');
  const studio = fakeStudio();
  studio.hold = true;
  const helper = createMovies({ dir, studio, pollMs: 1, machine: 'helper', log: { warn() {} } });
  const main = createMovies({ dir, studio, pollMs: 1, machine: 'main', log: { warn() {} } });
  const m = await helper.create({ maker: 'h3-max', shots: [{ prompt: 'a' }] });
  await helper.run(m.id);
  await until(() => studio.reqs.length === 1);
  assert.equal(await main.usedElsewhere('h3-max'), true);
  assert.equal(await main.usedElsewhere('ltx'), false);
  assert.equal(await helper.usedElsewhere('h3-max'), false);
  const mainStudio = make({ dir, files: { image: [], video: [] }, fetchImpl: async () => Response.json({}), WebSocketImpl: null, log: { warn() {} }, inUseElsewhere: (id) => main.usedElsewhere(id), statfs: async () => ({ bavail: 1e7, bsize: 1024 ** 2 }) });
  await mainStudio.installMaker('h3-max');
  await assert.rejects(mainStudio.removeMaker('h3-max'), (e) => e.status === 409 && /helper/.test(e.message));
  await helper.stop(m.id);
});
