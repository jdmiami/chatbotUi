import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemeLab, draftIdea, FORMATS, parseJson } from '../src/memes.js';

test('written ideas: every format fills all its blanks and avoids the last few formats used', () => {
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 200; i++) {
    const idea = draftIdea(rand, ['pov', 'nobody', 'glitch']);
    assert.ok(!/\{\w+\}/.test(idea.prompt + idea.title), `unfilled blank in ${idea.prompt}`);
    assert.ok(!['pov', 'nobody', 'glitch'].includes(idea.format));
  }
  assert.ok(FORMATS.length >= 10);
  assert.deepEqual(parseJson('Sure! {"score": 82, "why": "x"} hope that helps'), { score: 82, why: 'x' });
  assert.equal(parseJson('no json'), null);
});

function fakeStudio() {
  const jobs = new Map();
  const items = new Map();
  let n = 0;
  return {
    user: false,
    videoReady: true,
    made: [],
    hasUserWork() { return this.user; },
    async state() { return { video: { ready: this.videoReady } }; },
    async createJob(req) { const id = `j${++n}`; jobs.set(id, { id, status: 'running', req }); this.made.push(req); return { id }; },
    job: (id) => jobs.get(id) || null,
    finish(id) { const j = jobs.get(id); j.status = 'done'; j.item = { id: `i${id}`, seconds: 5 }; items.set(j.item.id, { id: j.item.id, lab: true }); },
    async cancel(id) { jobs.get(id).status = 'stopped'; },
    async labItems() { return [...items.values()].filter((i) => i.lab); },
    async promote(id) { const it = items.get(id); if (!it?.lab) return false; delete it.lab; return true; },
    async remove(id) { return items.delete(id); },
    async itemPath() { return null; },
    async yieldGpu() {},
  };
}

test('meme lab: waits for quiet, makes one video at a time, judges it, marks the best ready to post', async () => {
  const studio = fakeStudio();
  let quiet = 0;
  let saved = null;
  const asked = [];
  const lab = createMemeLab({
    studio,
    quietSeconds: () => quiet,
    log: {},
    load: async () => null,
    save: async (s) => void (saved = JSON.parse(JSON.stringify(s))),
    chat: async ({ system, user }) => {
      asked.push(system.slice(0, 20));
      if (/judge/.test(system)) return '{"score": 88, "why": "Strong hook in the first second.", "better_caption": "When the goose clocks in"}';
      return JSON.stringify({ title: 'The goose has a 9-to-5', prompt: 'A goose at an office desk, typing, sighing.', caption: 'Monday energy', hashtags: ['#goose', '#office'] });
    },
  });

  await lab.tick();
  assert.equal(studio.made.length, 0, 'someone used the machine a moment ago: wait');
  quiet = 200;
  studio.user = true;
  await lab.tick();
  assert.equal(studio.made.length, 0, 'your job is running: wait');
  studio.user = false;
  await lab.tick();
  assert.equal(studio.made.length, 1);
  assert.deepEqual({ kind: studio.made[0].kind, size: studio.made[0].size, background: studio.made[0].background }, { kind: 'video', size: 'portrait', background: true });
  assert.match(studio.made[0].prompt, /goose/);
  await lab.tick();
  assert.equal(studio.made.length, 1, 'one at a time');

  studio.finish('j1');
  await lab.tick();
  const st = await lab.state();
  assert.equal(st.records.length, 1);
  assert.equal(st.records[0].score, 88);
  assert.equal(st.records[0].status, 'ready', 'a high score is ready to post');
  assert.equal(st.records[0].caption, 'When the goose clocks in');
  assert.equal(saved.records.length, 1, 'kept between restarts');

  // Off: nothing more is made.
  await lab.setEnabled(false);
  await lab.tick();
  assert.equal(studio.made.length, 1);
  // Keep moves it to the gallery and out of the lab.
  assert.equal(await lab.keep('ij1'), true);
  assert.equal((await lab.state()).records.length, 0);
});

test('meme lab: a video stopped for your job is dropped, and the lab respects its hourly cap', async () => {
  const studio = fakeStudio();
  const lab = createMemeLab({ studio, quietSeconds: () => 999, log: {}, chat: null, maxPerHour: 1 });
  await lab.tick();
  assert.equal(studio.made.length, 1, 'with no chat model it uses a written idea');
  await studio.cancel('j1');
  await lab.tick();
  assert.equal((await lab.state()).records.length, 0);
  await lab.tick();
  assert.equal(studio.made.length, 2, 'starts another');
  studio.finish('j2');
  await lab.tick();
  const r = (await lab.state()).records[0];
  assert.equal(r.score, null);
  assert.equal(r.status, 'judged');
  await lab.tick();
  assert.equal(studio.made.length, 2, 'one an hour at most here');
});
