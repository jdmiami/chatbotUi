import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemeLab, draftIdea, FORMATS, parseJson, SPICY_FORMATS, spicyProblem } from '../src/memes.js';

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

test('meme lab: plans the hour, waits behind your jobs, makes one at a time, judges it, marks the best ready to post', async () => {
  const studio = fakeStudio();
  let quiet = 0;
  let saved = null;
  let left = 60;
  let clock = Date.parse('2026-10-20T12:00:00Z');
  const lab = createMemeLab({
    studio,
    now: () => clock,
    quietSeconds: () => quiet,
    quietMinutes: 3,
    minutesLeft: () => left,
    log: {},
    load: async () => ({ style: 'comedy' }),
    save: async (s) => void (saved = JSON.parse(JSON.stringify(s))),
    chat: async ({ system }) => {
      if (/judge/.test(system)) return '{"score": 88, "why": "Strong hook in the first second.", "better_caption": "When the goose clocks in"}';
      return JSON.stringify({ title: 'The goose has a 9-to-5', prompt: 'A goose at an office desk, typing, sighing.', caption: 'Monday energy', hashtags: ['#goose', '#office'] });
    },
  });

  await lab.tick();
  assert.equal(studio.made.length, 0, 'someone used the machine a moment ago: wait');
  assert.equal((await lab.state()).queue.length, 10, 'an hour at about 6 minutes a video is planned');
  quiet = 200;
  studio.user = true;
  await lab.tick();
  assert.equal(studio.made.length, 0, 'your job is running: wait');
  studio.user = false;
  await lab.tick();
  assert.equal(studio.made.length, 1);
  assert.deepEqual({ kind: studio.made[0].kind, size: studio.made[0].size, background: studio.made[0].background }, { kind: 'video', size: 'portrait', background: true });
  assert.match(studio.made[0].prompt, /goose/, 'sharpened by the chat model');
  await lab.tick();
  assert.equal(studio.made.length, 1, 'one at a time');
  assert.equal((await lab.state()).making.title, 'The goose has a 9-to-5');

  clock += 6 * 60_000; // a lab video takes about 6 minutes
  studio.finish('j1');
  await lab.tick();
  const st = await lab.state();
  assert.equal(st.records.length, 1);
  assert.equal(st.records[0].score, 88);
  assert.equal(st.records[0].status, 'ready', 'a high score is ready to post');
  assert.equal(st.records[0].caption, 'When the goose clocks in');
  assert.equal(saved.records.length, 1, 'kept between restarts');

  // Less time left: fewer planned (never fewer than 2).
  left = 5;
  await lab.configure({ topics: ['my cat Luna'] });
  const q = (await lab.state()).queue;
  assert.equal(q.length, 2);
  assert.ok(q.every((x) => x.topic === 'my cat Luna'), 'new topics replace the planned ideas');

  // Off: nothing more is made.
  await lab.setEnabled(false);
  await lab.tick();
  assert.equal(studio.made.length, 1);
  assert.equal(await lab.keep('ij1'), true, 'keep moves it to the gallery');
  assert.equal((await lab.state()).records.length, 0);
});

test('meme lab: your own idea goes first, ideas can be edited, moved up, removed, and the current video cancelled', async () => {
  const studio = fakeStudio();
  const lab = createMemeLab({ studio, log: {}, chat: null, minutesLeft: () => 30, load: async () => ({ style: 'comedy' }) });
  await lab.tick();
  assert.equal(studio.made.length, 1, 'starts as soon as the machine is ready');
  assert.ok((await lab.state()).queue.length >= 2);

  assert.equal(await lab.addIdea({ title: 'Cat vs cucumber', prompt: 'A cat sees a cucumber and leaps.' }), true);
  let st = await lab.state();
  assert.equal(st.queue[0].title, 'Cat vs cucumber');
  assert.equal(st.queue[0].yours, true);
  const last = st.queue.at(-1).id;
  await lab.makeNext(last);
  st = await lab.state();
  assert.equal(st.queue[0].id, last);
  await lab.editIdea(last, { prompt: 'A pug sneezes at a candle.' });
  await lab.removeIdea(st.queue[1].id);
  st = await lab.state();
  assert.equal(st.queue[0].prompt, 'A pug sneezes at a candle.');
  assert.ok(!st.queue.some((x) => x.title === 'Cat vs cucumber'));

  assert.equal(await lab.cancelCurrent(), true);
  assert.equal(studio.job('j1').status, 'stopped');
  await lab.tick();
  assert.equal(studio.made.length, 2);
  assert.equal(studio.made[1].prompt, 'A pug sneezes at a candle.', 'your edit is made as written');
  studio.finish('j2');
  await lab.tick();
  const r = (await lab.state()).records[0];
  assert.equal(r.score, null, 'no chat model: not judged');
  assert.equal(r.status, 'judged');
});

test('spicy style: written ideas show made-up adults, stay platform-safe, and fill every blank', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 200; i++) {
    const idea = draftIdea(rand, [], i % 2 ? ['date night'] : [], 'spicy');
    assert.equal(idea.style, 'spicy');
    assert.ok(!/\{\w+\}/.test(idea.prompt + idea.title), `unfilled blank in ${idea.prompt}`);
    assert.match(idea.prompt, /fictional adult over 25/);
    assert.match(idea.prompt, /no nudity/);
    assert.equal(spicyProblem(`${idea.title} ${idea.prompt.replace(/ The person is a fictional[\s\S]*$/, '')}`), null, idea.prompt);
  }
  assert.equal(SPICY_FORMATS.length >= 8, true);
  assert.match(spicyProblem('a flirty teen at the beach'), /adults/);
  assert.match(spicyProblem('cheerleader in high school'), /adults/);
  assert.match(spicyProblem('she is 18 years old'), /adults/);
  assert.match(spicyProblem('topless on the beach'), /not explicit/);
  assert.match(spicyProblem('a deepfake of a famous singer'), /made-up/);
  assert.equal(spicyProblem('confident man in a tailored suit, slow glance at a rooftop bar'), null);
});

test('spicy lab: is the default, refuses ideas and topics over the line, and throws away a model idea that drifts', async () => {
  const studio = fakeStudio();
  let answer = { title: 'Rooftop glance', prompt: 'A confident woman in her thirties in a black dress turns on a rooftop at night.', caption: 'no words needed', hashtags: ['#rooftop', '#fyp'] };
  const lab = createMemeLab({ studio, log: {}, load: async () => null, save: async () => {}, chat: async ({ system }) => (/judge/.test(system) ? '{"score": 50, "why": "ok"}' : JSON.stringify(answer)) });
  const st = await lab.state();
  assert.equal(st.style, 'spicy');
  await assert.rejects(lab.addIdea({ prompt: 'a teen girl posing at the pool' }), /adults/);
  await assert.rejects(lab.addIdea({ prompt: 'fully naked on a bed' }), /explicit/);
  await assert.rejects(lab.configure({ topics: ['schoolgirl'] }), /adults|kids/);
  assert.equal(await lab.addIdea({ prompt: 'A man in a linen shirt walking the beach at sunset, glancing back' }), true);
  const mine = (await lab.state()).queue[0];
  assert.doesNotMatch(mine.prompt, /fictional adult/, 'the safety note is added behind the scenes, not shown');
  await assert.rejects(lab.editIdea(mine.id, { prompt: 'make her look 16' }), /adults/);

  await lab.tick();
  assert.equal(studio.made.length, 1);
  assert.match(studio.made[0].prompt, /linen shirt[\s\S]*fictional adult over 25/, 'your idea, with the adult note');
  studio.finish('j1');
  await lab.tick();

  answer = { title: 'Pool day', prompt: 'A topless woman by the pool', caption: 'x', hashtags: ['#pool'] };
  await lab.tick();
  assert.equal(studio.made.length, 2);
  assert.doesNotMatch(studio.made[1].prompt, /topless/, 'the drifting model idea is replaced by the written one');
  assert.match(studio.made[1].prompt, /fictional adult over 25/);
});

test('switching the lab to comedy replans the queue and stops the spicy video being made', async () => {
  const studio = fakeStudio();
  const lab = createMemeLab({ studio, log: {}, load: async () => ({ enabled: true, style: 'spicy', topics: [], queue: [], records: [] }), save: async () => {} });
  await lab.tick();
  assert.equal(studio.made.length, 1);
  await lab.configure({ style: 'comedy' });
  const st = await lab.state();
  assert.equal(st.style, 'comedy');
  assert.equal(st.making, null);
  assert.ok(st.queue.length >= 2);
  assert.ok(st.queue.every((q) => !/fictional adult/.test(q.prompt)));
  assert.ok(studio.made.length === 1 && studio.job('j1').status === 'stopped');
});
