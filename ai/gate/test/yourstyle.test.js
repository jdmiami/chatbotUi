// "Your style": the profile of the owner's own prompts (style.js), the Lab's 30-second movies made
// from it (memes.js) with soReal's auto flow in the background (movies.js), and the routes (gate.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chipsOf, createStyleProfile, gatherPrompts, leansSpicy, parseProfile, wordProfile } from '../src/style.js';
import { ADULT_NOTE, createMemeLab, draftMovieIdea, yoursProblem } from '../src/memes.js';
import { createMovies } from '../src/movies.js';
import { createGate } from '../src/gate.js';
import { signJwt } from '../src/jwt.js';

const quiet = { warn() {}, info() {} };
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

const ITEMS = [
  { id: 'a', prompt: 'A lone astronaut walks through a neon city at night, rain, anamorphic lens, slow dolly', createdAt: '2026-10-01' },
  { id: 'b', prompt: 'An astronaut in a neon diner at night, teal and orange, handheld', createdAt: '2026-10-02' },
  { id: 'c', prompt: 'Neon rain on a rooftop, the astronaut looks up, anamorphic, slow push in', createdAt: '2026-10-03' },
  { id: 'lab1', prompt: 'A goose at an office desk', lab: true, createdAt: '2026-10-04' },
  { id: 'cut1', prompt: 'My movie', movie: 'm1', createdAt: '2026-10-04' },
];
const MOVIES = [
  { id: 'm1', idea: 'An astronaut comes home to a flooded neon city', look: 'Neon noir, anamorphic, rain', shots: [{ prompt: 'She walks the empty street', says: 'Mara, softly: "Anyone?"' }], updatedAt: '2026-10-05' },
  { id: 'lm', lab: true, idea: 'A lab movie the owner never kept', shots: [], updatedAt: '2026-10-06' },
];
const LAB_IDEAS = [{ title: 'Astronaut karaoke', prompt: 'An astronaut sings karaoke in a neon bar', createdAt: '2026-10-07' }];

const PROFILE_REPLY = JSON.stringify({
  subjects: ['a lone astronaut'],
  characters: ['Mara, a tired explorer'],
  settings: ['neon city at night', 'rooftops'],
  light: ['neon', 'rain-soaked night'],
  colour: ['teal and orange'],
  lens: ['anamorphic'],
  camera: ['slow dolly', 'handheld'],
  mood: ['lonely', 'dreamy'],
  genre: ['sci-fi noir'],
  pacing: ['slow, lingering shots'],
  sound: ['rain and synths'],
  voice: ['few soft lines'],
  words: ['neon', 'rain'],
  never: ['comedy', 'bright daylight'],
  spicy: false,
  summary: 'You like lonely astronauts in rainy neon cities, shot slow and anamorphic.',
});

test('your style: gathers the owner’s own prompts (not Lab items, not Lab movies) and asks the chat model on this machine', async () => {
  const prompts = gatherPrompts({ items: ITEMS, movies: MOVIES, labIdeas: LAB_IDEAS });
  const texts = prompts.map((p) => p.text);
  assert.ok(texts.some((t) => /lone astronaut/.test(t)), 'gallery prompts');
  assert.ok(texts.includes('An astronaut comes home to a flooded neon city'), 'movie ideas');
  assert.ok(texts.includes('Neon noir, anamorphic, rain'), 'movie looks');
  assert.ok(texts.some((t) => /Anyone\?/.test(t)), 'lines');
  assert.ok(texts.includes('An astronaut sings karaoke in a neon bar'), 'Lab ideas you wrote');
  assert.ok(!texts.some((t) => /goose|never kept|My movie/.test(t)), 'Lab items, Lab movies and movie cuts are left out');
  assert.equal(prompts[0].at, '2026-10-07', 'newest first');

  const asked = [];
  let saved = null;
  let clock = Date.parse('2026-10-21T10:00:00Z');
  let items = [...ITEMS];
  const style = createStyleProfile({
    sources: async () => ({ items, movies: MOVIES, labIdeas: LAB_IDEAS }),
    chat: async (m) => (asked.push(m), PROFILE_REPLY),
    load: async () => null,
    save: async (s) => void (saved = JSON.parse(JSON.stringify(s))),
    now: () => clock,
    log: quiet,
  });
  assert.equal((await style.get()).ready, false);
  const v = await style.rebuild();
  assert.equal(asked.length, 1);
  assert.match(asked[0].system, /personal style/);
  assert.match(asked[0].system, /"never"/);
  assert.match(asked[0].user, /lone astronaut walks through a neon city/);
  assert.equal(v.by, 'ai');
  assert.equal(v.count, prompts.length, 'how many prompts it was built from');
  assert.equal(v.builtAt, '2026-10-21T10:00:00.000Z', 'and when');
  assert.deepEqual(v.profile.subjects, ['a lone astronaut']);
  assert.deepEqual(v.profile.never, ['comedy', 'bright daylight']);
  assert.match(v.summary, /lonely astronauts/);
  assert.equal(v.spicy, false);
  assert.ok(v.chips.some((c) => c.kind === 'subject' && c.text === 'a lone astronaut'));
  assert.ok(v.chips.some((c) => c.kind === 'look' && c.text === 'anamorphic'));
  assert.equal(saved.count, prompts.length, 'kept between restarts');

  // Only rebuilt for 10+ new prompts (or a day later with any new), checked every 10 minutes.
  clock += 11 * 60_000;
  items = [...items, ...Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, prompt: `New neon prompt number ${i}`, createdAt: '2026-10-20' }))];
  assert.equal(await style.maybeRebuild(), false);
  clock += 11 * 60_000;
  items = [...items, ...Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, prompt: `Another rainy prompt ${i}`, createdAt: '2026-10-20' }))];
  assert.equal(await style.maybeRebuild(), true, '10 new prompts: rebuilt');
  assert.equal(asked.length, 2);
  clock += 25 * 3_600_000;
  items = [...items, { id: 'p', prompt: 'One more astronaut', createdAt: '2026-10-21' }];
  assert.equal(await style.maybeRebuild(), true, 'a day later, any new prompt: rebuilt');
});

test('your style: your edits steer it, removed chips stay out, and nothing about kids is kept', async () => {
  const asked = [];
  const style = createStyleProfile({ sources: async () => ({ items: ITEMS, movies: MOVIES }), chat: async (m) => (asked.push(m), PROFILE_REPLY), log: quiet });
  await style.rebuild();
  let v = await style.edit({ summary: 'I want warmer light from now on, still lonely astronauts.', remove: ['handheld'] });
  assert.equal(v.summary, 'I want warmer light from now on, still lonely astronauts.');
  assert.equal(v.edited, true);
  assert.ok(!v.profile.camera.includes('handheld'));
  assert.ok(!v.chips.some((c) => c.text === 'handheld'));
  v = await style.rebuild();
  assert.match(asked[1].user, /follow this over the prompts\): I want warmer light/, 'your words go to the model');
  assert.match(asked[1].user, /Leave these out.*handheld/);
  assert.ok(!v.profile.camera.includes('handheld'), 'still out after a rebuild');
  assert.equal(v.summary, 'I want warmer light from now on, still lonely astronauts.', 'your summary stays');
  await assert.rejects(style.edit({ summary: 'teen girls at the beach' }), /kids or teens/);

  const kids = createStyleProfile({ sources: async () => ({ items: ITEMS }), chat: async () => JSON.stringify({ subjects: ['a toddler', 'a robot'], summary: 'x' }), log: quiet });
  assert.deepEqual((await kids.rebuild()).profile.subjects, ['a robot'], 'the Lab never makes films about kids');
});

test('your style: with no chat model (or a confused one), a word count builds it so it still works', async () => {
  const style = createStyleProfile({ sources: async () => ({ items: ITEMS, movies: MOVIES, labIdeas: LAB_IDEAS }), chat: null, log: quiet });
  const v = await style.rebuild();
  assert.equal(v.by, 'words');
  assert.ok(v.profile.subjects.includes('astronaut'), v.profile.subjects.join());
  assert.ok(v.profile.light.includes('neon'));
  assert.ok(v.profile.lens.includes('anamorphic'));
  assert.ok(v.profile.settings.includes('city') || v.profile.settings.includes('rooftop'));
  assert.match(v.summary, /astronaut/);
  assert.ok(chipsOf(v.profile).length > 0);

  const broken = createStyleProfile({ sources: async () => ({ items: ITEMS }), chat: async () => 'sorry, no idea', log: quiet });
  assert.equal((await broken.rebuild()).by, 'words');
  const down = createStyleProfile({ sources: async () => ({ items: ITEMS }), chat: async () => { throw new Error('No chat model is installed on the AI machine.'); }, log: quiet });
  assert.equal((await down.rebuild()).by, 'words');

  assert.equal(parseProfile('nope'), null);
  assert.deepEqual(parseProfile('{"look": {"light": ["neon"], "color": "teal, orange"}}').profile.colour, ['teal', 'orange'], 'a nested look and US spelling are read too');
  assert.equal(leansSpicy([{ text: 'a sexy look in lingerie' }, { text: 'a flirty glance' }, { text: 'a dog' }]), true);
  assert.equal(leansSpicy([{ text: 'a dog' }, { text: 'a cat' }]), false);
  assert.ok(wordProfile([]).subjects.length === 0);
});

function fakeLabStudio() {
  const jobs = new Map();
  const items = new Map();
  return {
    user: false,
    items,
    hasUserWork() { return this.user; },
    async state() { return { video: { ready: true } }; },
    async createJob() { throw new Error('a movie in your style is made by soReal, not as one clip'); },
    job: (id) => jobs.get(id) || null,
    async cancel() {},
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
    estimate: () => ({ seconds: 40 * 60, shots: 6, shotSeconds: 5 }),
    ownerBusy: () => false,
    async create(body) { const m = { id: `mv${++n}`, ...body, phase: 'draft', running: false, shots: [] }; all.set(m.id, m); return m; },
    async run(id) { Object.assign(all.get(id), { running: true, phase: 'story' }); },
    async get(id) { return all.get(id) || null; },
    async remove(id) { all.delete(id); return true; },
    async adopt(id) { const m = all.get(id); if (!m?.lab) return false; delete m.lab; return true; },
    finish(id) {
      const m = all.get(id);
      const cut = { id: `cut-${id}`, kind: 'video', seconds: 30, lab: true };
      studio.items.set(cut.id, cut);
      Object.assign(m, { running: false, phase: 'done', render: { itemId: cut.id }, length: 30 });
    },
  };
}
const STYLE = { subjects: ['a lone astronaut'], characters: [], settings: ['neon city at night'], light: ['neon'], colour: ['teal and orange'], lens: ['anamorphic'], camera: ['slow dolly'], mood: ['lonely'], genre: ['sci-fi noir'], pacing: ['slow'], sound: ['rain and synths'], voice: [], words: [], never: [], summary: 'You like lonely astronauts in neon rain.', spicy: false };
const fakeProfile = (p = STYLE) => ({ current: async () => p, maybeRebuild: async () => false, get: async () => ({ ready: true, ...p }), edit: async () => ({}), rebuild: async () => ({}) });

test('your style: ideas are 30-second movies written from the profile, and the chat model gets the profile', async () => {
  const idea = draftMovieIdea(STYLE, () => 0);
  assert.equal(idea.kind, 'movie');
  assert.equal(idea.length, 30);
  assert.match(idea.prompt, /lonely sci-fi noir about a lone astronaut in neon city at night/);
  assert.match(idea.look, /neon, teal and orange, anamorphic, slow dolly/);
  assert.match(draftMovieIdea(null, () => 0).prompt, /stranger/, 'with no profile yet, still an idea');

  const studio = fakeLabStudio();
  const movies = fakeMovies(studio);
  const asked = [];
  const lab = createMemeLab({
    studio,
    movies,
    profile: fakeProfile(),
    log: quiet,
    minutesLeft: () => 60,
    load: async () => ({ style: 'yours' }),
    chat: async (m) => {
      asked.push(m);
      if (/judge/.test(m.system)) return '{"score": 81, "why": "Feels like yours."}';
      return JSON.stringify({ title: 'Last light on Europa', idea: 'A lone astronaut wades through a flooded neon street and finds a lit window.', look: 'Neon rain, anamorphic, slow dolly', caption: 'Home is a light in the rain', hashtags: ['#scifi', '#neon'] });
    },
  });
  await lab.tick();
  const write = asked.find((m) => /30-second vertical short films/.test(m.system));
  assert.ok(write, 'the movie idea writer was asked');
  assert.match(write.user, /lonely astronauts in neon rain/, 'with your summary');
  assert.match(write.user, /settings: neon city at night/, 'and your profile');
  const [made] = movies.all.values();
  assert.deepEqual({ flow: made.flow, length: made.length, size: made.size, lab: made.lab }, { flow: 'auto', length: 30, size: 'portrait', lab: true });
  assert.equal(made.title, 'Last light on Europa');
  assert.match(made.idea, /flooded neon street/);
  assert.equal(made.look, 'Neon rain, anamorphic, slow dolly');
  const st = await lab.state();
  assert.equal(st.making.title, 'Last light on Europa');
  assert.equal(st.making.movie.phase, 'story');
  assert.equal(st.making.movie.seconds, 30);
});

test('your style: the Lab plans 30-second movies by how long one takes (often just 1), learning from the last ones', async () => {
  const studio = fakeLabStudio();
  const movies = fakeMovies(studio);
  let left = 60;
  let clock = Date.parse('2026-10-21T12:00:00Z');
  const lab = createMemeLab({ studio, movies, profile: fakeProfile(), log: quiet, now: () => clock, minutesLeft: () => left, quietMinutes: 999, quietSeconds: () => 0, load: async () => ({ style: 'yours' }), chat: null });
  await lab.tick();
  let st = await lab.state();
  assert.equal(st.minutesPerVideo, 48, 'soReal says 40 min here, plus slack for waiting behind your jobs');
  assert.equal(st.queue.length, 1, 'an hour fits one 30-second movie');
  assert.equal(st.queue[0].kind, 'movie');
  assert.equal(st.queue[0].seconds, 30);
  left = 150;
  await lab.tick();
  assert.equal((await lab.state()).queue.length, 3, 'two and a half hours: 3 (never more)');
  left = 5;
  await lab.configure({ style: 'comedy' });
  await lab.configure({ style: 'yours' });
  assert.equal((await lab.state()).queue.length, 1, 'never fewer than 1');

  // Learned: it took 20 minutes.
  left = 60;
  const lab2 = createMemeLab({ studio, movies, profile: fakeProfile(), log: quiet, now: () => clock, minutesLeft: () => left, load: async () => ({ style: 'yours' }), chat: null });
  await lab2.tick();
  const id = [...movies.all.keys()].at(-1);
  clock += 20 * 60_000;
  movies.finish(id);
  await lab2.tick();
  st = await lab2.state();
  assert.equal(st.records.length, 1);
  assert.equal(st.minutesPerVideo, 20);
});

test('your style: a finished movie lands in the Lab gallery, is judged on its frames, kept into soReal or deleted with its shots', async () => {
  const studio = fakeLabStudio();
  const movies = fakeMovies(studio);
  const lab = createMemeLab({ studio, movies, profile: fakeProfile({ ...STYLE, spicy: true }), log: quiet, minutesLeft: () => 60, load: async () => ({ style: 'yours' }), chat: async ({ system }) => (/judge/.test(system) ? '{"score": 90, "why": "Very you."}' : 'no json') });
  await lab.tick();
  const [first] = movies.all.values();
  assert.equal(first.nsfw, true, 'a style that leans spicy: the cut is blurred as NSFW');
  assert.match(first.idea, /fictional adult over 25/, 'and the spicy rules ride along');
  assert.equal((await lab.state()).making.nsfw, true);
  studio.user = true;
  movies.finish(first.id);
  await lab.tick();
  let st = await lab.state();
  assert.equal(st.records[0].status, 'made', 'your job is running: judged later');
  studio.user = false;
  await lab.tick();
  st = await lab.state();
  const r = st.records[0];
  assert.equal(r.id, `cut-${first.id}`);
  assert.equal(r.movieId, first.id);
  assert.equal(r.seconds, 30);
  assert.equal(r.style, 'yours');
  assert.equal(r.score, 90);
  assert.equal(r.status, 'ready');
  assert.equal(r.nsfw, true);
  assert.doesNotMatch(r.prompt, /fictional adult/, 'the safety note is not shown');

  assert.equal(await lab.keep(r.id), true);
  assert.equal(movies.all.get(first.id).lab, undefined, 'kept: the movie moves into soReal');
  assert.equal(studio.items.get(r.id).lab, undefined, 'and its cut into your gallery');

  await lab.tick();
  const second = [...movies.all.values()].at(-1);
  movies.finish(second.id);
  await lab.tick();
  const r2 = (await lab.state()).records[0];
  assert.equal(await lab.remove(r2.id), true);
  assert.equal(movies.all.has(second.id), false, 'deleted with its storyboard and shots');

  // Cancel: the movie being made is thrown away.
  await lab.tick();
  const third = [...movies.all.values()].at(-1);
  assert.equal((await lab.state()).making.movie.id, third.id);
  assert.equal(await lab.cancelCurrent(), true);
  assert.equal(movies.all.has(third.id), false);
  assert.equal((await lab.state()).making, null);
});

test('your style: content rules on profile-made ideas (blocked words, spicy rules when it leans spicy, your own ideas too)', async () => {
  assert.match(yoursProblem('nsfw loli'), /never allowed/);
  assert.equal(yoursProblem('a toddler builds a sandcastle'), null, 'a family film is fine when the style is not spicy');
  assert.match(yoursProblem('a flirty teen at the beach', { spicy: true }), /adults/);
  assert.match(yoursProblem('fully naked on the beach', { spicy: true }), /explicit/);
  assert.equal(yoursProblem('a confident woman in a silk dress on a rooftop', { spicy: true }), null);

  const studio = fakeLabStudio();
  const movies = fakeMovies(studio);
  let answer = { title: 'Pool party', idea: 'A teen girl in a bikini at a pool party at night.', look: 'Neon' };
  const lab = createMemeLab({ studio, movies, profile: fakeProfile({ ...STYLE, spicy: true }), log: quiet, minutesLeft: () => 60, load: async () => ({ style: 'yours' }), chat: async () => JSON.stringify(answer) });
  await lab.tick();
  const [m] = movies.all.values();
  assert.doesNotMatch(m.idea, /teen/, 'a model idea past the line is thrown away; the one from your profile is made');
  assert.match(m.idea, /lone astronaut/);
  await lab.cancelCurrent();
  await assert.rejects(lab.addIdea({ prompt: 'a schoolgirl posing' }), /adults/);
  await assert.rejects(lab.addIdea({ prompt: 'topless at the beach' }), /explicit/);
  assert.equal(await lab.addIdea({ prompt: 'A woman in a red coat crosses a neon bridge in the rain' }), true);
  const mine = (await lab.state()).queue[0];
  assert.equal(mine.kind, 'movie');
  assert.equal(mine.yours, true);
  await assert.rejects(lab.editIdea(mine.id, { prompt: 'make her look 16' }), /adults/);
  answer = null;
  await lab.tick();
  const last = [...movies.all.values()].at(-1);
  assert.match(last.idea, /red coat[\s\S]*fictional adult over 25/, 'your idea, made as written, with the adult note');
  assert.ok(ADULT_NOTE.includes('no nudity'));
});

// ---------------------------------------------------------------- soReal in the background

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

// ---------------------------------------------------------------- the routes

const SECRET = 'y'.repeat(40);
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

test('routes: GET the profile, POST an edit, POST rebuild; the Lab picks "yours"; requests cannot make Lab movies', async () => {
  const studio = { ...fakeLabStudio(), items: async () => [], makers: async () => [] };
  const created = [];
  const movies = { ...fakeMovies(studio), list: async () => [], create: async (b) => (created.push(b), { id: 'x', ...b }) };
  const asked = [];
  const profile = createStyleProfile({ sources: async () => ({ items: ITEMS, movies: MOVIES }), chat: async (m) => (asked.push(m), PROFILE_REPLY), log: quiet });
  const lab = createMemeLab({ studio, movies, profile, log: quiet, minutesLeft: () => 60, load: async () => null, chat: null });
  const gate = createGate({ secret: SECRET, webui: 'http://127.0.0.1:9', ollama: 'http://127.0.0.1:9', allowedOrigins: 'https://site.example', siteUrl: 'https://site.example', status: async () => ({}), studio, movies, lab }, quiet);
  const base = `http://127.0.0.1:${await listen(gate)}`;
  const token = signJwt({ sub: 'jd', aud: 'orbit-ai', iss: 'rdp-web' }, SECRET, { expiresIn: 3600 });
  const call = async (method, p, body) => {
    const res = await fetch(`${base}${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    assert.equal((await fetch(`${base}/_orbit/studio/lab/profile`)).status, 401);
    let r = await call('GET', '/_orbit/studio/lab/profile');
    assert.equal(r.status, 200);
    assert.equal(r.body.ready, false);
    r = await call('POST', '/_orbit/studio/lab/profile/rebuild', {});
    assert.equal(r.status, 200);
    await until(async () => (await call('GET', '/_orbit/studio/lab/profile')).body.ready);
    r = await call('GET', '/_orbit/studio/lab/profile');
    assert.equal(r.body.count, gatherPrompts({ items: ITEMS, movies: MOVIES }).length);
    assert.ok(r.body.chips.length > 0);
    r = await call('POST', '/_orbit/studio/lab/profile', { summary: 'Warmer light, please.', remove: ['anamorphic'] });
    assert.equal(r.status, 200);
    assert.equal(r.body.summary, 'Warmer light, please.');
    assert.ok(!r.body.chips.some((c) => c.text === 'anamorphic'));
    r = await call('POST', '/_orbit/studio/lab/profile', { summary: 'a 15 year old' });
    assert.equal(r.status, 422);
    assert.equal((await call('DELETE', '/_orbit/studio/lab/profile')).status, 405);

    r = await call('POST', '/_orbit/studio/lab', { style: 'yours' });
    assert.equal(r.status, 200);
    assert.equal(r.body.style, 'yours');
    assert.equal(r.body.queue[0].kind, 'movie');
    assert.equal(r.body.queue[0].seconds, 30);

    await call('POST', '/_orbit/studio/movies', { flow: 'auto', idea: 'x', lab: true, background: true, nsfw: true });
    assert.deepEqual([created[0].lab, created[0].background, created[0].nsfw], [undefined, undefined, undefined]);
  } finally {
    gate.close();
  }
});

test('routes: an older machine without your style says so', async () => {
  const studio = fakeLabStudio();
  const lab = createMemeLab({ studio, log: quiet, load: async () => null });
  await assert.rejects(lab.profile(), /not available/);
});
