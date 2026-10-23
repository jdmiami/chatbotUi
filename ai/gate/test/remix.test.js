import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemeLab } from '../src/memes.js';
import { TWISTS, forMix, pickSource, planRemix, remixMessages, remixSources, sizeOf } from '../src/remix.js';

const MAKERS = [
  { id: 'qwen', kind: 'image', installed: true },
  { id: 'krea-real', kind: 'image', installed: true },
  { id: 'ltx', kind: 'video', installed: true },
  { id: 'h3-max', kind: 'video', installed: false },
  { id: 'edit', kind: 'edit', installed: true },
];
const at = (n) => `2026-10-2${n}T10:00:00Z`;
const GALLERY = [
  { id: 'a', kind: 'image', maker: 'krea-real', prompt: 'A lone astronaut in a rainy neon market, anamorphic, teal and orange', width: 832, height: 1216, style: 'style-darkbrush', createdAt: at(3) },
  { id: 'b', kind: 'video', maker: 'ltx', prompt: 'Slow dolly through a foggy forest at dawn', width: 1280, height: 720, seconds: 5, createdAt: at(2) },
  { id: 'c', kind: 'image', maker: 'qwen', prompt: 'A lone astronaut in a rainy neon market, anamorphic, teal and orange', width: 1024, height: 1024, createdAt: at(1) },
  { id: 'd', kind: 'image', maker: 'edit', prompt: 'make the sky purple', createdAt: at(4) },
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
  // The one remixed least goes next; the newest first among equals.
  assert.equal(pickSource(s, {}).id, 'a');
  assert.equal(pickSource(s, { a: 2, b: 1 }).id, 'b');
});

test('a planned remix takes a new turn each time and asks the chat model to keep the style', () => {
  const [src] = remixSources(GALLERY, MAKERS);
  const first = planRemix(src, 0);
  const second = planRemix(src, 1);
  assert.notEqual(first.prompt, second.prompt);
  assert.match(first.prompt, /^A lone astronaut in a rainy neon market/);
  assert.equal(first.source.maker, 'krea-real');
  assert.equal(planRemix(src, TWISTS.length).twist, 0);
  const m = remixMessages(second, { summary: 'Lonely sci-fi', recent: ['Neon rain'] });
  assert.match(m.system, /Keep what makes it theirs/);
  assert.match(m.user, /Their prompt \(for a picture\): A lone astronaut/);
  assert.match(m.user, new RegExp(TWISTS[1].slice(0, 20)));
  assert.match(m.user, /don't repeat: Neon rain/);
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
    async state() { return { image: { ready: true }, video: { ready: true } }; },
    async items() { return GALLERY; },
    async makers() { return MAKERS; },
    estimate: () => 40,
    async createJob(req) {
      const j = { id: `j${++n}`, kind: req.maker === 'ltx' ? 'video' : 'image', status: 'running', notes: [], req };
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

test('Remix: makes pictures and clips from your prompts with the same maker, size and style, rewritten by the chat model, many an hour', async () => {
  const studio = fakeStudio();
  const asked = [];
  const chat = async ({ system, user }) => {
    asked.push({ system, user });
    if (/judge remixes/.test(system)) return '{"score": 81, "why": "Fresh and still theirs."}';
    return '{"title": "Neon rain, from above", "prompt": "Seen from high above, a lone astronaut crosses a rainy neon market, anamorphic, teal and orange", "caption": "Same world, new view", "hashtags": ["#scifi"]}';
  };
  const lab = createMemeLab({ studio, chat, log: { warn() {}, info() {} }, maxRemixesPerHour: 60 });
  await lab.configure({ style: 'remix' });
  let st = await lab.state();
  assert.equal(st.style, 'remix');
  assert.equal(st.mix, 'both');
  assert.deepEqual(st.remix, { sources: 2, pictures: 1, videos: 1 });
  assert.equal(st.queue.length, 4);
  // Every prompt gets its turn: two of each, each a different turn.
  assert.deepEqual(st.queue.map((q) => q.kind).sort(), ['clip', 'clip', 'picture', 'picture']);
  assert.ok(st.queue.every((q) => q.remixOf));

  await lab.tick();
  const req = studio.created[0];
  assert.equal(req.background, true);
  assert.equal(req.maker, 'krea-real');
  assert.equal(req.size, 'portrait');
  assert.equal(req.style, 'style-darkbrush');
  assert.match(req.prompt, /^Seen from high above/);
  st = await lab.state();
  assert.equal(st.making.title, 'Neon rain, from above');
  assert.equal(st.making.kind, 'picture');
  assert.ok(st.making.job);

  studio.finish('j1');
  await lab.tick();
  st = await lab.state();
  assert.equal(st.records.length, 1);
  assert.equal(st.records[0].kind, 'image');
  assert.equal(st.records[0].score, 81);
  assert.equal(st.records[0].status, 'ready');
  assert.match(st.records[0].remixOf, /A lone astronaut/);
  assert.equal(st.records[0].source, undefined, 'the source stays on the machine; the words show as remixOf');

  // The next one is a clip: the video maker, 5 seconds.
  await lab.tick();
  assert.equal(studio.created[1].maker, 'ltx');
  assert.equal(studio.created[1].seconds, 5);

  // Only pictures: the planned ones follow; the clip being made finishes.
  await lab.configure({ mix: 'pictures' });
  st = await lab.state();
  assert.ok(st.queue.length > 0 && st.queue.every((q) => q.kind === 'picture'));

  // Keep moves it into your gallery.
  assert.equal(await lab.keep('it-j1'), true);
});

test('Remix: a remix that made way for your job is made again first; one past the line is never made; no chat model makes your words with the turn', async () => {
  const studio = fakeStudio();
  const lab = createMemeLab({ studio, chat: null, log: { warn() {}, info() {} } });
  await lab.configure({ style: 'remix', mix: 'pictures' });
  await lab.tick();
  const first = studio.created[0];
  assert.match(first.prompt, /^A lone astronaut in a rainy neon market, anamorphic, teal and orange\. A moment later\.$/);
  Object.assign(studio.jobs.get('j1'), { status: 'error', notes: ['Made way for your job.'] });
  await lab.tick();
  let st = await lab.state();
  assert.equal(st.making, null);
  assert.equal(st.queue[0].prompt, first.prompt, 'made again first');
  await lab.tick();
  assert.equal(studio.created[1].prompt, first.prompt);

  // Your own prompt, remixed next with the maker you used.
  await lab.cancelCurrent();
  await lab.addIdea({ prompt: 'A paper boat sailing through a flooded library' });
  st = await lab.state();
  assert.match(st.queue[0].title, /^Remix: A paper boat/);
  await assert.rejects(lab.addIdea({ prompt: 'a 14 year old girl in a bikini' }), (e) => e.status === 422);
});
