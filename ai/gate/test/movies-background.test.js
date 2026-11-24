// soReal in the background (movies.js): a Lab movie's steps are background jobs that make way for
// your own and carry on after; your own movies never are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMovies } from '../src/movies.js';

const quiet = { warn() {}, info() {} };
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

function preemptingStudio() {
  const items = new Map();
  const jobs = new Map();
  const reqs = [];
  let n = 0;
  const studio = {
    reqs,
    items,
    owner: null, // an owner job id while one runs
    preempted: 0,
    async item(id) { return items.get(id) || null; },
    hasUserWork() { return Boolean(studio.owner && jobs.get(studio.owner)?.status === 'running'); },
    async createJob(req) {
      reqs.push(req);
      const id = `job${String(++n).padStart(4, '0')}`;
      jobs.set(id, { id, status: req.background ? 'running' : 'running', req, ticks: 0 });
      if (!req.background) {
        // Your job: the Lab's job being made makes way (studio.js does the same).
        for (const j of jobs.values()) if (j.req.background && j.status === 'running') (j.status = 'stopped'), studio.preempted++;
        studio.owner = id;
      }
      return { id, status: 'running' };
    },
    job(id) {
      const j = jobs.get(id);
      if (!j) return null;
      if (j.status === 'running' && !(j.req.background && studio.hasUserWork()) && ++j.ticks >= 2 && !(j.id === studio.owner && studio.holdOwner) && !(j.req.kind === 'video' && j.req.background && studio.holdShot)) {
        const video = j.req.kind === 'video';
        const item = { id: `item${j.id.slice(3)}`, kind: video ? 'video' : 'image', seconds: video ? 5 : undefined, width: 704, height: 1280, lab: j.req.background || undefined };
        items.set(item.id, item);
        Object.assign(j, { status: 'done', item });
      }
      return { id: j.id, status: j.status, error: j.status === 'stopped' ? 'Stopped.' : null, item: j.item, etaSeconds: 10 };
    },
    async cancel(id) { const j = jobs.get(id); if (j) j.status = 'stopped'; return j; },
    estimate: ({ kind }) => (kind === 'video' ? 200 : 45),
    itemPath: async (id) => `/v/${id}.mp4`,
    added: [],
    addItem: async (it) => {
      const item = { id: `cut${String(++n).padStart(4, '0')}`, ...it };
      items.set(item.id, item);
      studio.added.push(item);
      return item;
    },
    async promote(id) { const it = items.get(id); if (!it?.lab) return false; delete it.lab; return true; },
    async remove(id) { return items.delete(id); },
  };
  return studio;
}
const STORY = JSON.stringify({
  title: 'Neon home',
  lead: 'a tired astronaut in a worn suit',
  look: 'Neon rain',
  sound: 'shots',
  opening: 'A flooded neon street',
  shots: Array.from({ length: 6 }, (_, i) => ({ action: `Shot ${i + 1}: she walks on.`, end: `End of shot ${i + 1}.`, says: [] })),
});

test('soReal in the background: a Lab movie’s jobs are background jobs, make way for your job, and carry on after it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yours-'));
  const studio = preemptingStudio();
  const movies = createMovies({ dir, studio, pollMs: 1, ffmpeg: async () => {}, chat: async () => STORY, log: quiet });
  const m = await movies.create({ flow: 'auto', idea: 'An astronaut comes home', length: 30, size: 'portrait', lead: { mode: 'auto' }, lab: true, nsfw: true });
  assert.equal(m.lab, true);
  assert.equal((await movies.list()).length, 0, 'Lab movies stay out of soReal until kept');
  studio.holdShot = true;
  await movies.run(m.id);
  await until(() => studio.reqs.some((r) => r.kind === 'video'));
  assert.ok(studio.reqs.every((r) => r.background === true), 'every step of a Lab movie is a background job');

  // You ask for a picture: the Lab's shot stops and makes way, and the movie waits (paused).
  studio.holdOwner = true;
  const mine = await studio.createJob({ kind: 'image', prompt: 'my own picture' });
  studio.holdShot = false;
  await until(async () => (await movies.get(m.id)).paused);
  const before = studio.reqs.length;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(studio.reqs.length, before, 'nothing new is started while your job runs');
  assert.equal((await movies.get(m.id)).running, true, 'still running: only paused');
  studio.holdOwner = false;
  studio.job(mine.id);
  studio.job(mine.id);
  await until(async () => {
    const x = await movies.get(m.id);
    return x.phase === 'done' && !x.running;
  });
  const done = await movies.get(m.id);
  assert.equal(done.shots.length, 6);
  assert.ok(done.shots.every((s) => s.status === 'done'));
  assert.equal(studio.preempted, 1, 'the Lab step being made stopped for your job');
  // A lead, 7 storyboard pictures and 6 shots, plus the step that made way, made again.
  assert.equal(studio.reqs.filter((r) => r.background).length, 1 + 7 + 6 + 1, 'the stopped step was made again');
  const cut = studio.added.at(-1);
  assert.equal(cut.lab, true, 'the final cut is a Lab item');
  assert.equal(cut.nsfw, true, 'blurred when the style leans spicy');

  // Kept: it moves into soReal, with its pictures and shots in your gallery.
  assert.equal(await movies.adopt(m.id), true);
  assert.equal((await movies.list()).length, 1);
  assert.ok(![...studio.items.values()].some((i) => i.lab), 'nothing of it is left in the Lab');

  // A Lab movie thrown away takes its pictures and shots with it.
  const n = await movies.create({ flow: 'auto', idea: 'Another', length: 10, lab: true });
  await movies.run(n.id);
  await until(async () => (await movies.get(n.id)).phase === 'done' && !(await movies.get(n.id)).running);
  const madeOf = [...studio.items.values()].filter((i) => i.lab).length;
  assert.ok(madeOf > 0);
  await movies.remove(n.id);
  assert.equal([...studio.items.values()].filter((i) => i.lab).length, 0);
});

test('soReal: your own movies are never background jobs, and a request cannot make a Lab movie', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yours-'));
  const studio = preemptingStudio();
  const movies = createMovies({ dir, studio, pollMs: 1, ffmpeg: async () => {}, chat: async () => STORY, log: quiet });
  const m = await movies.create({ flow: 'auto', idea: 'Mine', length: 10 });
  await movies.run(m.id);
  await until(async () => (await movies.get(m.id)).phase === 'done' && !(await movies.get(m.id)).running);
  assert.ok(studio.reqs.every((r) => !r.background));
  assert.equal(studio.added.at(-1).lab, undefined);
});
