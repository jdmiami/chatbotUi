// The Lab (promptlab.js): the writer studies your own Make prompts and writes new ones in your style;
// this machine makes them in the background, with the maker, size and look you used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPromptLab, parsePrompts, writerMessages } from '../src/promptlab.js';
import { forMix, remixSources, sizeOf } from '../src/remix.js';
import { createGate } from '../src/gate.js';
import { signJwt } from '../src/jwt.js';

const quiet = { warn() {}, info() {} };
const MAKERS = [
  { id: 'qwen', kind: 'image', installed: true },
  { id: 'krea-real', kind: 'image', installed: true },
  { id: 'ltx', kind: 'video', installed: true },
  { id: 'wan', kind: 'video', name: 'Wan', installed: true },
  { id: 's2v', kind: 'video', installed: true, needs: ['photo', 'audio'] },
  { id: 'h3-max', kind: 'video', installed: false },
  { id: 'edit', kind: 'edit', installed: true },
];
const at = (n) => `2026-10-2${n}T10:00:00Z`;
const GALLERY = [
  { id: 'a', kind: 'image', maker: 'krea-real', prompt: 'A lone astronaut in a rainy neon market, anamorphic, teal and orange', width: 832, height: 1216, style: 'style-darkbrush', createdAt: at(3) },
  { id: 'b', kind: 'video', maker: 'ltx', prompt: 'Slow dolly through a foggy forest at dawn', width: 1280, height: 720, seconds: 5, createdAt: at(2) },
  { id: 'c', kind: 'image', maker: 'qwen', prompt: 'A lone astronaut in a rainy neon market, anamorphic, teal and orange', width: 1024, height: 1024, createdAt: at(1) },
  { id: 'd', kind: 'image', maker: 'edit', prompt: 'make the sky purple', fromImage: true, createdAt: at(4) },
  { id: 'e', kind: 'image', maker: 'qwen', prompt: 'my photo, smiling', fromImage: true, createdAt: at(5) },
  { id: 'f', kind: 'video', maker: 'h3-max', prompt: 'not installed any more', createdAt: at(6) },
  { id: 'g', kind: 'image', maker: 'qwen', prompt: 'a Lab picture', lab: true, createdAt: at(7) },
  { id: 'h', kind: 'image', maker: 'qwen', prompt: 'a studio member’s', owner: 'm1', createdAt: at(8) },
];

test('remix sources: your own Make prompts, newest first, one per wording, with their maker, size and style', () => {
  const s = remixSources(GALLERY, MAKERS);
  assert.deepEqual(
    s.map((x) => [x.id, x.kind, x.maker, x.size, x.style]),
    [
      ['a', 'picture', 'krea-real', 'portrait', 'style-darkbrush'],
      ['b', 'clip', 'ltx', 'landscape', null],
    ],
  );
  assert.equal(sizeOf(1024, 1024), 'square');
  assert.deepEqual(forMix(s, 'pictures').map((x) => x.id), ['a']);
  assert.deepEqual(forMix(s, 'videos').map((x) => x.id), ['b']);
});

function fakeStudio() {
  const jobs = new Map();
  const items = new Map();
  let n = 0;
  return {
    user: false,
    jobs,
    items,
    created: [],
    hasUserWork() { return this.user; },
    recent: { image: null, video: null, loaded: null },
    recentMakers() { return this.recent; },
    async state() { return { image: { ready: true }, video: { ready: true } }; },
    async items() { return GALLERY; },
    async makers() { return MAKERS; },
    estimate: () => 40,
    async createJob(req) {
      const j = { id: `j${++n}`, kind: ['ltx', 'wan'].includes(req.maker) ? 'video' : 'image', status: 'running', notes: [], req };
      jobs.set(j.id, j);
      this.created.push(req);
      return j;
    },
    job(id) { return jobs.get(id) || null; },
    finish(id) {
      const j = jobs.get(id);
      const it = { id: `it-${id}`, kind: j.kind, seconds: j.kind === 'video' ? 5 : undefined, lab: true };
      items.set(it.id, it);
      Object.assign(j, { status: 'done', item: it });
    },
    async cancel(id) { const j = jobs.get(id); if (j) Object.assign(j, { status: 'error', error: 'Stopped.' }); },
    async labItems() { return [...items.values()].filter((i) => i.lab); },
    async promote(id) { const it = items.get(id); if (!it?.lab) return false; delete it.lab; return true; },
    async remove(id) { return items.delete(id); },
    async itemPath() { return null; },
    async yieldGpu() {},
  };
}


const NEW = [
  'A lone astronaut sleeps in a flooded neon subway car, anamorphic, teal and orange',
  'A lone astronaut buys noodles from a robot stall in the rain, anamorphic, teal and orange',
  'A lone astronaut on a rooftop watching neon blimps, anamorphic, teal and orange',
];
const writer = (asked, prompts = NEW) => async (m) => {
  asked.push(m);
  return `Here you go:\n${JSON.stringify({ prompts })}`;
};

test('the writer is shown your own prompts and asked for new scenes in your style; answers in any shape are read', () => {
  const m = writerMessages({ kind: 'picture', examples: ['A', 'B'], count: 3, avoid: ['old one'], focus: 'B' });
  assert.match(m.system, /exact style of one creator/);
  assert.match(m.system, /never anyone under 18/);
  assert.match(m.user, /1\. A\n2\. B/);
  assert.match(m.user, /Build every new one on this prompt of theirs[^\n]*B/);
  assert.match(m.user, /don't repeat: old one/);
  assert.match(m.user, /Write 3 new prompts for pictures/);
  assert.match(writerMessages({ kind: 'clip', examples: ['x'] }).user, /5-second videos/);
  assert.deepEqual(parsePrompts('{"prompts": ["one prompt here", "two prompt here"]}'), ['one prompt here', 'two prompt here']);
  assert.deepEqual(parsePrompts('["first prompt", "second prompt"]'), ['first prompt', 'second prompt']);
  assert.deepEqual(parsePrompts('Sure!\n1. A cat on a neon roof at night\n2) A dog in the rain under a lamp'), ['A cat on a neon roof at night', 'A dog in the rain under a lamp']);
});

test('on its own the Lab keeps videos coming, made with a loaded video maker, the one you used last', async () => {
  const studio = fakeStudio();
  const asked = [];
  const lab = createPromptLab({ studio, chat: writer(asked), log: quiet });
  // Nothing waiting: a round of video prompts is written, then the first one is made.
  await lab.tick();
  let st = await lab.state();
  assert.equal(st.mix, 'videos', 'videos until you pick otherwise');
  assert.deepEqual(st.yours, { pictures: 1, videos: 2 }, 'every prompt of yours counts, whatever made it');
  assert.equal(asked.length, 1);
  assert.match(asked[0].user, /5-second videos/);
  assert.match(asked[0].user, /Slow dolly through a foggy forest/, 'your video prompts');
  assert.match(asked[0].user, /A lone astronaut in a rainy neon market/, 'with few video prompts, your picture prompts teach your style too');
  assert.doesNotMatch(asked[0].user, /a Lab picture|my photo|make the sky purple/, 'never Lab work, photos or edits');
  assert.equal(st.queue.length, 2);
  assert.ok(st.queue.every((q) => q.kind === 'clip' && q.maker === 'ltx'));
  // Your newest video was made with LTX (H3 Max isn't loaded; a talking photo needs a photo): LTX it is.
  const req = studio.created[0];
  assert.deepEqual(req, { maker: 'ltx', prompt: NEW[0], size: 'landscape', seconds: 5, background: true });
  assert.deepEqual((await lab.state()).makers, { picture: { id: 'krea-real', name: 'krea-real' }, clip: { id: 'ltx', name: 'ltx' } });

  // Done: it waits in the Lab until you keep or delete it.
  studio.finish('j1');
  await lab.tick();
  st = await lab.state();
  assert.equal(st.records.length, 1);
  assert.equal(st.records[0].kind, 'video');
  assert.equal(await lab.keep('it-j1'), true);
  assert.equal((await lab.state()).records.length, 0, 'kept: it moved to your gallery');

  // The next one started at once. You make a video with Wan: the Lab's one makes way (the studio
  // stops it), nothing new starts while you work, then it carries on with Wan.
  assert.equal(studio.created.length, 2);
  studio.user = true;
  studio.recent.video = 'wan';
  studio.jobs.get('j2').status = 'error';
  studio.jobs.get('j2').notes.push('Made way for your job.');
  await lab.tick();
  assert.equal(studio.created.length, 2, 'nothing starts while your job runs');
  assert.equal((await lab.state()).queue[0].prompt, NEW[1], 'the one that made way goes first again');
  studio.user = false;
  await lab.tick();
  assert.equal(studio.created.at(-1).maker, 'wan', 'the maker you used last, already loaded');
  // The line is topped up so it never runs dry.
  assert.ok(asked.length >= 2);

  // Off: nothing is made.
  await lab.cancelCurrent();
  await lab.configure({ enabled: false });
  const n = studio.created.length;
  await lab.tick();
  assert.equal(studio.created.length, n);
});

test('with no video maker loaded the Lab says to load one in Make', async () => {
  const studio = fakeStudio();
  studio.makers = async () => MAKERS.map((m) => (m.kind === 'video' && !m.needs ? { ...m, installed: false } : m));
  const lab = createPromptLab({ studio, chat: writer([]), log: quiet });
  await lab.tick();
  const st = await lab.state();
  assert.equal(studio.created.length, 0);
  assert.match(st.lastError, /Load a video maker in Make first/);
  assert.equal(st.makers.clip, null);
});

test('multiply one prompt: new ones built on it, made next; videos use your video maker for 5 seconds', async () => {
  const studio = fakeStudio();
  const asked = [];
  const lab = createPromptLab({ studio, chat: writer(asked, ['Fog rolls through pines as the camera glides low', 'Mist lifts off a lake at dawn, slow dolly']), log: quiet });
  await lab.configure({ enabled: false });
  assert.equal(await lab.addIdea({ prompt: 'Slow dolly through a foggy forest at dawn', count: 2, kind: 'clip' }), true);
  let st = await lab.state();
  assert.match(asked[0].user, /Build every new one on this prompt of theirs[^\n]*foggy forest/);
  assert.deepEqual(st.queue.map((q) => [q.kind, q.maker]).slice(0, 2), [['clip', 'ltx'], ['clip', 'ltx']]);
  assert.ok(st.queue.slice(0, 2).every((q) => q.from === 'Slow dolly through a foggy forest at dawn'));
  await lab.configure({ enabled: true });
  await lab.tick();
  assert.equal(studio.created[0].maker, 'ltx');
  assert.equal(studio.created[0].seconds, 5);
  // Only pictures: the waiting videos are not made.
  await lab.cancelCurrent();
  await lab.configure({ mix: 'pictures' });
  const n = studio.created.length;
  await lab.tick();
  assert.ok(studio.created.slice(n).every((r) => r.maker !== 'ltx'));
});

test('the Lab never makes anything past the line, and one that made way for your job is made again first', async () => {
  const studio = fakeStudio();
  const lab = createPromptLab({ studio, chat: writer([], ['A sexy teen at the beach', NEW[1]]), log: quiet });
  await assert.rejects(lab.addIdea({ prompt: 'a nude child' }), /never allowed/);
  await lab.configure({ enabled: false });
  await lab.addIdea({ prompt: 'A lone astronaut in a rainy neon market' });
  let st = await lab.state();
  assert.deepEqual(st.queue.map((q) => q.prompt), [NEW[1]], 'the one about a teen is thrown away');
  await lab.configure({ enabled: true });
  await lab.tick();
  studio.jobs.get('j1').status = 'error';
  studio.jobs.get('j1').notes.push('Made way for your job.');
  await lab.tick();
  st = await lab.state();
  assert.equal(st.queue[0]?.prompt ?? studio.created.at(-1).prompt, NEW[1], 'made again first');
});

test('with no writer the Lab says so instead of making copies', async () => {
  const studio = fakeStudio();
  const lab = createPromptLab({ studio, chat: null, log: quiet });
  await assert.rejects(lab.writeNow(), /writer is not set up/);
  await lab.tick();
  assert.equal(studio.created.length, 0);
  assert.equal((await lab.state()).writerReady, false);
});

const SECRET = 'p'.repeat(40);
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

test('routes: GET the Lab, POST on/off and mix, write a round, multiply a prompt, keep and delete', async () => {
  const studio = fakeStudio();
  let round = 0;
  const lab = createPromptLab({ studio, chat: async () => JSON.stringify({ prompts: NEW.map((p) => `${p}, take ${round}`) }, round++), log: quiet });
  const gate = createGate({ secret: SECRET, webui: 'http://127.0.0.1:9', ollama: 'http://127.0.0.1:9', allowedOrigins: 'https://site.example', siteUrl: 'https://site.example', status: async () => ({}), studio, lab }, quiet);
  const port = await listen(gate);
  const token = signJwt({ sub: 'jd', aud: 'orbit-ai', iss: 'rdp-web' }, SECRET, { expiresIn: 3600 });
  const call = async (p, method = 'GET', body) => {
    const r = await fetch(`http://127.0.0.1:${port}/_orbit/studio/lab${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  try {
    let r = await call('', 'POST', { enabled: false, mix: 'pictures' });
    assert.equal(r.status, 200);
    assert.equal(r.body.enabled, false);
    assert.equal(r.body.mix, 'pictures');
    r = await call('/write', 'POST', {});
    assert.equal(r.status, 200);
    assert.equal(r.body.queue.length, 3);
    r = await call('/queue', 'POST', { prompt: 'A lone astronaut in a rainy neon market', count: 2 });
    assert.equal(r.status, 200);
    const first = r.body.queue[0].id;
    r = await call(`/queue/${first}`, 'DELETE');
    assert.equal(r.status, 200);
    assert.ok(!r.body.queue.some((q) => q.id === first));
    r = await call('/nope/keep', 'POST');
    assert.equal(r.status, 404);
    r = await call('/profile');
    assert.equal(r.status, 404, 'the old style profile is gone');
  } finally {
    gate.close();
  }
});
