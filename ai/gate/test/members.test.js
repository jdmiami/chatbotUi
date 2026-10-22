import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGate } from '../src/gate.js';
import { signJwt } from '../src/jwt.js';

// Studio members (After Dark…): their key opens only /_studio/*, and they only ever see their own work.
const SECRET = 's'.repeat(40);
let gate;
let base;
let lastJob = null;
const jobs = new Map();
const films = new Map();
let lastFilm = null;
let revised = null;
const fakeMovies = {
  create: async (b) => {
    lastFilm = b;
    const m = { id: `film${films.size + 1}`, title: b.title, owner: b.owner, phase: 'draft', frames: [{ id: 'fa', itemId: null }, { id: 'fb', itemId: null }], render: null };
    films.set(m.id, m);
    return m;
  },
  get: async (id) => films.get(id) ?? null,
  run: async (id) => ({ ...films.get(id), phase: 'storyboard' }),
  revise: async (id, body) => {
    revised = { id, ...body };
    return films.get(id);
  },
};

const member = (sub) => signJwt({ sub, aud: 'studio-member', studio: 'afterdark' }, SECRET, { expiresIn: 600 });
const ownerKey = () => signJwt({ sub: 'jd', aud: 'orbit-ai' }, SECRET, { expiresIn: 600 });
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

before(async () => {
  const fakeStudio = {
    state: async () => ({}),
    makers: async () => [
      { id: 'qwen-real', kind: 'image', name: 'Qwen Real', installed: true },
      { id: 'h3-max', kind: 'video', name: 'H3 Max', installed: true },
      { id: 'edit', kind: 'edit', name: 'Edit with words', installed: true },
    ],
    items: async () => [
      { id: 'mine1', kind: 'image', owner: 'm:afterdark:ann', file: 'a.png' },
      { id: 'theirs', kind: 'image', owner: 'm:afterdark:bob', file: 'b.png' },
      { id: 'owners', kind: 'image', file: 'c.png' },
    ],
    createJob: async (req) => {
      lastJob = req;
      const j = { id: `job${jobs.size + 1}`, kind: req.kind, status: 'queued', progress: 0, owner: req.owner, item: null };
      jobs.set(j.id, j);
      return j;
    },
    job: (id) => jobs.get(id) ?? null,
    file: async () => null,
  };
  gate = createGate(
    { secret: SECRET, webui: 'http://127.0.0.1:9', ollama: 'http://127.0.0.1:9', allowedOrigins: 'https://site.example', siteUrl: 'https://site.example', status: async () => ({}), studio: fakeStudio, movies: fakeMovies },
    { warn() {}, info() {} },
  );
  base = `http://127.0.0.1:${await listen(gate)}`;
});
after(() => gate.close());

const get = (path, key) => fetch(base + path, { headers: key ? { authorization: `Bearer ${key}` } : {} });
const post = (path, key, body) => fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('members: a member key opens none of the owner routes', async () => {
  const k = member('afterdark:ann');
  assert.equal((await get('/_orbit/studio', k)).status, 401);
  assert.equal((await get('/_orbit/studio/items', k)).status, 401);
  assert.equal((await post('/_orbit/studio/jobs', k, { kind: 'image', prompt: 'x' })).status, 401);
  assert.equal((await get('/v1/models', k)).status, 401);
});

test('members: the studio door needs a member key (not none, not the owner one)', async () => {
  assert.equal((await get('/_studio/items')).status, 401);
  assert.equal((await get('/_studio/items', 'nope')).status, 401);
  assert.equal((await get('/_studio/items', ownerKey())).status, 401);
});

test('members: each member sees only their own pictures, with working file links', async () => {
  const r = await get('/_studio/items', member('afterdark:ann'));
  assert.equal(r.status, 200);
  const { items } = await r.json();
  assert.deepEqual(items.map((i) => i.id), ['mine1']);
  assert.match(items[0].url, /^\/_orbit\/studio\/file\/mine1\?t=/);
  assert.equal(items[0].owner, undefined, 'no internal fields');
});

test('members: jobs are tagged from the key, never from the body; only picture and video makers', async () => {
  const r = await post('/_studio/jobs', member('afterdark:ann'), { maker: 'qwen-real', prompt: 'a velvet lounge', owner: 'm:afterdark:bob', image: 'data:image/png;base64,AAA' });
  assert.equal(r.status, 200);
  assert.equal(lastJob.owner, 'm:afterdark:ann');
  assert.equal(lastJob.image, undefined, 'no uploads from members');
  assert.equal((await post('/_studio/jobs', member('afterdark:ann'), { maker: 'edit', prompt: 'x' })).status, 400);
  assert.equal((await post('/_studio/jobs', member('afterdark:ann'), { maker: 'nope', prompt: 'x' })).status, 400);
  const { id } = await r.json();
  assert.equal((await get(`/_studio/jobs/${id}`, member('afterdark:ann'))).status, 200);
  assert.equal((await get(`/_studio/jobs/${id}`, member('afterdark:bob'))).status, 404, "someone else's job is not found");
});

test('members: a film carries their own script; only they can redraw its storyboard', async () => {
  const ann = member('afterdark:ann');
  const r = await post('/_studio/movies', ann, {
    idea: 'Strangers at a cabin',
    owner: 'm:afterdark:bob',
    opening: 'Snow against the window',
    shots: [{ prompt: 'Mara opens the door', end: 'Their eyes meet', says: 'Mara, softly: "Come in."', itemId: 'x' }, 'nope', null],
  });
  assert.equal(r.status, 200);
  assert.equal(lastFilm.owner, 'm:afterdark:ann');
  assert.equal(lastFilm.opening, 'Snow against the window');
  assert.deepEqual(lastFilm.shots, [{ prompt: 'Mara opens the door', end: 'Their eyes meet', says: 'Mara, softly: "Come in."' }]);
  const { id } = await r.json();
  const redo = (key, frames) => post(`/_studio/movies/${id}/frames`, key, { frames });
  assert.equal((await redo(member('afterdark:bob'), [{ id: 'fa' }])).status, 404, "not someone else's film");
  assert.equal((await redo(ann, [{ id: 'other' }])).status, 400, 'only its own pictures');
  const ok = await redo(ann, [{ id: 'fa' }, { id: 'fb', prompt: 'Snow falling, closer' }]);
  assert.equal(ok.status, 200);
  assert.deepEqual(revised, { id, frames: [{ id: 'fa', redo: true }, { id: 'fb', prompt: 'Snow falling, closer' }] });
});
