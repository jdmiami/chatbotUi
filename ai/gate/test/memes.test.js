import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMemeLab, draftIdea, draftLabMovie, FORMATS, parseJson, SPICY_FORMATS, spicyProblem } from '../src/memes.js';
import { createMovies } from '../src/movies.js';

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

test('written ideas become 30-second movies: an arc to build to, the style’s look, and no adult note stored', () => {
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const comedy = draftLabMovie(rand, [], ['my cat Luna'], 'comedy');
  assert.equal(comedy.kind, 'movie');
  assert.equal(comedy.length, 30);
  assert.equal(comedy.style, 'comedy');
  assert.match(comedy.prompt, /Over 30 seconds: a setup/);
  assert.match(comedy.look, /sitcom/);
  const spicy = draftLabMovie(rand, [], [], 'spicy');
  assert.match(spicy.prompt, /Over 30 seconds: a confident first look/);
  assert.doesNotMatch(spicy.prompt, /fictional adult/, 'the adult note is added when it is made, not stored');
});

function fakeStudio() {
  const items = new Map();
  return {
    user: false,
    videoReady: true,
    items,
    hasUserWork() { return this.user; },
    async state() { return { video: { ready: this.videoReady } }; },
    async createJob() { throw new Error('every Lab video is a soReal movie, never one clip'); },
    async labItems() { return [...items.values()].filter((i) => i.lab); },
    async promote(id) { const it = items.get(id); if (!it?.lab) return false; delete it.lab; return true; },
    async remove(id) { return items.delete(id); },
    async itemPath() { return null; },
    async yieldGpu() {},
  };
}
function fakeMovies(studio) {
  const all = new Map();
  let n = 0;
  return {
    all,
    made: [],
    estimate: () => ({ seconds: 25 * 60, shots: 6, shotSeconds: 5 }),
    ownerBusy: () => false,
    async create(body) { const m = { id: `mv${++n}`, ...body, phase: 'draft', running: false, shots: [] }; all.set(m.id, m); this.made.push(m); return m; },
    async run(id) { Object.assign(all.get(id), { running: true, phase: 'story' }); },
    async get(id) { return all.get(id) || null; },
    async remove(id) { all.delete(id); return true; },
    async adopt(id) { const m = all.get(id); if (!m?.lab) return false; delete m.lab; return true; },
    write(id, shots) { Object.assign(all.get(id), { phase: 'shots', shots: shots.map((prompt) => ({ prompt, status: 'todo' })) }); },
    finish(id) {
      const m = all.get(id);
      const cut = { id: `cut-${id}`, kind: 'video', seconds: 30, lab: true };
      studio.items.set(cut.id, cut);
      Object.assign(m, { running: false, phase: 'done', render: { itemId: cut.id }, length: 30 });
    },
  };
}

test('meme lab: every style makes a 30-second chained soReal movie, waits behind your jobs, judges it, marks the best ready to post', async () => {
  const studio = fakeStudio();
  const movies = fakeMovies(studio);
  let quiet = 0;
  let saved = null;
  let left = 60;
  let clock = Date.parse('2026-10-20T12:00:00Z');
  const asked = [];
  const lab = createMemeLab({
    studio,
    movies,
    now: () => clock,
    quietSeconds: () => quiet,
    quietMinutes: 3,
    minutesLeft: () => left,
    log: {},
    load: async () => ({ style: 'comedy' }),
    save: async (s) => void (saved = JSON.parse(JSON.stringify(s))),
    chat: async (m) => {
      asked.push(m);
      if (/judge/.test(m.system)) return '{"score": 88, "why": "Strong hook in the first second.", "better_caption": "When the goose clocks in"}';
      return JSON.stringify({ title: 'The goose has a 9-to-5', idea: 'A goose at an office desk types, sighs, and finally storms out with the stapler.', look: 'Fluorescent office, handheld', caption: 'Monday energy', hashtags: ['#goose', '#office'] });
    },
  });

  await lab.tick();
  assert.equal(movies.made.length, 0, 'someone used the machine a moment ago: wait');
  let st = await lab.state();
  assert.equal(st.minutesPerVideo, 30, 'soReal says 25 minutes for a chained movie, plus slack');
  assert.equal(st.queue.length, 2, 'an hour fits two 30-second movies');
  assert.ok(st.queue.every((q) => q.kind === 'movie' && q.seconds === 30));
  quiet = 200;
  studio.user = true;
  await lab.tick();
  assert.equal(movies.made.length, 0, 'your job is running: wait');
  studio.user = false;
  await lab.tick();
  assert.equal(movies.made.length, 1);
  const [m] = movies.made;
  assert.deepEqual(
    { flow: m.flow, length: m.length, size: m.size, continuity: m.continuity, lab: m.lab, template: m.template, nsfw: m.nsfw },
    { flow: 'auto', length: 30, size: 'portrait', continuity: 'chain', lab: true, template: 'comedy', nsfw: undefined },
    'a 30-second vertical movie, each shot from the last frame of the one before, kept in the Lab',
  );
  assert.match(m.idea, /storms out with the stapler/, 'sharpened by the chat model');
  assert.match(asked[0].system, /30-second vertical comedy meme movies/);
  await lab.tick();
  assert.equal(movies.made.length, 1, 'one at a time');
  st = await lab.state();
  assert.equal(st.making.title, 'The goose has a 9-to-5');
  assert.equal(st.making.movie.seconds, 30);

  clock += 28 * 60_000;
  movies.finish(m.id);
  await lab.tick();
  st = await lab.state();
  assert.equal(st.records.length, 1);
  const r = st.records[0];
  assert.equal(r.score, 88);
  assert.equal(r.status, 'ready', 'a high score is ready to post');
  assert.equal(r.caption, 'When the goose clocks in');
  assert.equal(r.why, 'Strong hook in the first second.');
  assert.equal(r.movieId, m.id);
  assert.equal(r.seconds, 30);
  assert.equal(saved.records.length, 1, 'kept between restarts');
  assert.equal(st.minutesPerVideo, 28, 'learned from the last one');

  // Less time left: fewer planned (never fewer than 1).
  left = 5;
  await lab.configure({ topics: ['my cat Luna'] });
  const q = (await lab.state()).queue;
  assert.equal(q.length, 1);
  assert.ok(q.every((x) => x.topic === 'my cat Luna'), 'new topics replace the planned ideas');

  // Off: nothing more is made.
  await lab.setEnabled(false);
  await lab.tick();
  assert.equal(movies.made.length, 1);
  assert.equal(await lab.keep(r.id), true, 'keep moves it to the gallery');
  assert.equal(movies.all.get(m.id).lab, undefined, 'and the movie into soReal');
  assert.equal((await lab.state()).records.length, 0);
});

test('meme lab: your own idea goes first, ideas can be edited, moved up, removed, and the movie being made cancelled', async () => {
  const studio = fakeStudio();
  const movies = fakeMovies(studio);
  const lab = createMemeLab({ studio, movies, log: {}, chat: null, minutesLeft: () => 90, load: async () => ({ style: 'comedy' }) });
  await lab.tick();
  assert.equal(movies.made.length, 1, 'starts as soon as the machine is ready');
  assert.ok((await lab.state()).queue.length >= 2);

  assert.equal(await lab.addIdea({ title: 'Cat vs cucumber', prompt: 'A cat sees a cucumber and leaps.' }), true);
  let st = await lab.state();
  assert.equal(st.queue[0].title, 'Cat vs cucumber');
  assert.equal(st.queue[0].yours, true);
  assert.equal(st.queue[0].kind, 'movie');
  const last = st.queue.at(-1).id;
  await lab.makeNext(last);
  st = await lab.state();
  assert.equal(st.queue[0].id, last);
  await lab.editIdea(last, { prompt: 'A pug sneezes at a candle.' });
  await lab.removeIdea(st.queue[1].id);
  st = await lab.state();
  assert.equal(st.queue[0].prompt, 'A pug sneezes at a candle.');
  assert.ok(!st.queue.some((x) => x.title === 'Cat vs cucumber'));

  const first = movies.made[0].id;
  assert.equal(await lab.cancelCurrent(), true);
  assert.equal(movies.all.has(first), false, 'thrown away with its pictures and shots');
  await lab.tick();
  assert.equal(movies.made.length, 2);
  assert.equal(movies.made[1].idea, 'A pug sneezes at a candle.', 'your edit is made as written');
  movies.finish(movies.made[1].id);
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

test('spicy lab: is the default, refuses ideas and topics over the line, throws away a model idea that drifts, and checks the story soReal wrote', async () => {
  const studio = fakeStudio();
  const movies = fakeMovies(studio);
  let answer = { title: 'Rooftop glance', idea: 'A confident woman in her thirties in a black dress turns on a rooftop at night.', caption: 'no words needed', hashtags: ['#rooftop', '#fyp'] };
  const lab = createMemeLab({ studio, movies, log: {}, load: async () => null, save: async () => {}, chat: async ({ system }) => (/judge/.test(system) ? '{"score": 50, "why": "ok"}' : JSON.stringify(answer)) });
  const st = await lab.state();
  assert.equal(st.style, 'spicy');
  await assert.rejects(lab.addIdea({ prompt: 'a teen girl posing at the pool' }), /adults/);
  await assert.rejects(lab.addIdea({ prompt: 'fully naked on a bed' }), /explicit/);
  await assert.rejects(lab.configure({ topics: ['schoolgirl'] }), /adults|kids/);
  await assert.rejects(lab.configure({ style: 'horror' }), /no such style/);
  assert.equal(await lab.addIdea({ prompt: 'A man in a linen shirt walking the beach at sunset, glancing back' }), true);
  const mine = (await lab.state()).queue[0];
  assert.doesNotMatch(mine.prompt, /fictional adult/, 'the safety note is added behind the scenes, not shown');
  await assert.rejects(lab.editIdea(mine.id, { prompt: 'make her look 16' }), /adults/);

  await lab.tick();
  assert.equal(movies.made.length, 1);
  assert.match(movies.made[0].idea, /linen shirt[\s\S]*fictional adult over 25/, 'your idea, with the adult note');
  assert.equal(movies.made[0].continuity, 'chain');
  assert.equal(movies.made[0].nsfw, undefined, 'never blurred for its style alone');
  movies.finish(movies.made[0].id);
  await lab.tick();
  const rec = (await lab.state()).records[0];
  assert.equal(rec.nsfw, undefined, 'only the check, the words or your say blur it');
  assert.doesNotMatch(rec.prompt, /fictional adult|nudity/, 'the record never carries the adult note (its words would blur it)');

  answer = { title: 'Pool day', idea: 'A topless woman by the pool', caption: 'x', hashtags: ['#pool'] };
  await lab.tick();
  assert.equal(movies.made.length, 2);
  assert.doesNotMatch(movies.made[1].idea, /topless/, 'the drifting model idea is replaced by the written one');
  assert.match(movies.made[1].idea, /fictional adult over 25/);

  // The story soReal wrote: one shot past the line and the movie is thrown away.
  movies.write(movies.made[1].id, ['She smiles at the camera, no nudity, nothing explicit.', 'She turns away and goes topless.']);
  await lab.tick();
  const after = await lab.state();
  assert.equal(after.making, null);
  assert.match(after.lastError, /not explicit/);
  assert.equal(movies.all.has(movies.made[1].id), false);
});

test('switching the lab to comedy replans the queue and stops the spicy movie being made', async () => {
  const studio = fakeStudio();
  const movies = fakeMovies(studio);
  const lab = createMemeLab({ studio, movies, log: {}, load: async () => ({ enabled: true, style: 'spicy', topics: [], queue: [{ qid: 'old', title: 'An old clip idea', prompt: 'A man walks.' + ' The person is a fictional adult over 25, not a real or famous person. Flirty and confident but tasteful: clothed or in swimwear, no nudity, nothing explicit.', style: 'spicy' }], records: [] }), save: async () => {} });
  let st = await lab.state();
  assert.equal(st.queue[0].kind, 'movie', 'an idea saved before every style made movies is a movie now');
  assert.equal(st.queue[0].prompt, 'A man walks.');
  await lab.tick();
  assert.equal(movies.made.length, 1);
  await lab.configure({ style: 'comedy' });
  st = await lab.state();
  assert.equal(st.style, 'comedy');
  assert.equal(st.making, null);
  assert.ok(st.queue.length >= 1);
  assert.ok(st.queue.every((q) => !/fictional adult/.test(q.prompt)));
  assert.equal(movies.all.has(movies.made[0].id), false);
});

// ---------------------------------------------------------------- the real soReal engine, chained

const quiet = { warn() {}, info() {} };
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

test('soReal chained: a Lab movie makes one opening picture, then each shot from the last frame of the shot before', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chain-'));
  const items = new Map();
  const jobs = new Map();
  const reqs = [];
  let n = 0;
  const studio = {
    async item(id) { return items.get(id) || null; },
    hasUserWork: () => false,
    async createJob(req) {
      reqs.push(req);
      const id = `job${++n}`;
      const video = req.kind === 'video';
      const item = { id: `item${n}`, kind: video ? 'video' : 'image', seconds: video ? 5 : undefined, lab: req.background || undefined };
      items.set(item.id, item);
      jobs.set(id, { id, status: 'done', item });
      return { id, status: 'running' };
    },
    job: (id) => jobs.get(id) || null,
    async cancel() {},
    estimate: ({ kind }) => (kind === 'video' ? 200 : 45),
    itemPath: async (id) => `/v/${id}.mp4`,
    added: [],
    addItem: async (it) => {
      const item = { id: `cut${++n}`, ...it };
      items.set(item.id, item);
      studio.added.push(item);
      return item;
    },
  };
  const STORY = JSON.stringify({ title: 'Goose at work', lead: 'a goose in a tie', look: 'Office', sound: 'shots', opening: 'A goose at a desk', shots: Array.from({ length: 6 }, (_, i) => ({ action: `Shot ${i + 1}`, end: `End ${i + 1}`, says: [] })) });
  const movies = createMovies({ dir, studio, pollMs: 1, ffmpeg: async () => {}, chat: async () => STORY, log: quiet });
  const est = movies.estimate({ length: 30, size: 'portrait', maker: 'ltx', continuity: 'chain' });
  const keyed = movies.estimate({ length: 30, size: 'portrait', maker: 'ltx' });
  assert.ok(est.seconds < keyed.seconds, 'chained is quicker: one opening picture instead of seven');
  const m = await movies.create({ flow: 'auto', idea: 'A goose has a 9-to-5', length: 30, size: 'portrait', maker: 'ltx', lead: { mode: 'auto' }, continuity: 'chain', lab: true });
  assert.equal(m.continuity, 'chain');
  await movies.run(m.id);
  await until(async () => {
    const x = await movies.get(m.id);
    return x.phase === 'done' && !x.running;
  });
  const pictures = reqs.filter((r) => r.kind === 'image');
  const shots = reqs.filter((r) => r.kind === 'video');
  assert.equal(pictures.length, 2, 'the lead and one opening picture');
  assert.equal(shots.length, 6);
  assert.ok(shots[0].fromItem && !shots[0].toItem, 'the first shot starts on the opening picture');
  const done = await movies.get(m.id);
  for (let i = 1; i < 6; i++) assert.equal(shots[i].fromLastFrameOf, done.shots[i - 1].itemId, `shot ${i + 1} starts from the last frame of shot ${i}`);
  assert.ok(reqs.every((r) => r.background), 'all background work');
  assert.equal(studio.added.at(-1).lab, true, 'the final cut is a Lab item');
  assert.equal(studio.added.at(-1).nsfw, undefined);
});
