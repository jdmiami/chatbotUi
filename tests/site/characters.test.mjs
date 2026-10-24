// The site's characters library from Cloudflare R2 (lib/characters.ts) against an R2 kept in memory.
// Run with: npm run test:site (Node strips the TypeScript types itself).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createR2 } from '../../lib/r2.ts';
import { forgetCharacters, listCharacters } from '../../lib/characters.ts';
import { createCharacters } from '../../ai/gate/src/characters.js';
import { createR2 as gateR2 } from '../../ai/gate/src/r2.js';

const CONF = { accountId: 'acct', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', bucket: 'orbit-models' };
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** One bucket in memory that both the AI machine's client and the site's client talk to. */
function bucket() {
  const store = new Map();
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const key = decodeURIComponent(u.pathname.replace(/^\/orbit-models\/?/, ''));
    if (method === 'GET' && !key) {
      const prefix = u.searchParams.get('prefix') || '';
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const body = keys.map((k) => `<Contents><Key>${xml(k)}</Key><Size>${store.get(k).length}</Size><ETag>"${store.get(k).length}-${k.length}"</ETag></Contents>`).join('');
      return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${body}</ListBucketResult>`);
    }
    if (method === 'GET') return store.has(key) ? new Response(store.get(key)) : new Response('<Error><Message>missing</Message></Error>', { status: 404 });
    if (method === 'HEAD') return store.has(key) ? new Response(null, { headers: { 'content-length': String(store.get(key).length) } }) : new Response(null, { status: 404 });
    if (method === 'PUT') {
      store.set(key, Buffer.from(init.body));
      return new Response('');
    }
    if (method === 'DELETE') {
      store.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response('nope', { status: 400 });
  };
  return { store, site: createR2(CONF, fetchImpl, () => new Date('2026-10-24T10:17:00Z')), machine: gateR2({ ...CONF, fetchImpl }) };
}

const GOOD = { name: 'Mira Vale', age: 34, traits: { style: 'photoreal', gender: 'woman', hair: 'long wavy dark brown', eyes: 'green', outfits: ['a charcoal coat'] } };

test('the library lists what the AI machine kept in R2, with the machine off, and only the owner own', async () => {
  forgetCharacters();
  const b = bucket();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sitechars-'));
  const characters = createCharacters({ dir, r2: b.machine, log: { warn() {} } });
  await characters.start();
  const made = await characters.create(GOOD);
  const member = await characters.create({ ...GOOD, name: 'Someone Else' }, { owner: 'm:abc' });
  // A sheet picture (as the machine saves it) and a ready character.
  const c = characters.getAny(made.id);
  await fs.writeFile(path.join(dir, made.id, 'front-1.png'), 'PNG');
  await b.machine.put(`characters/${made.id}/front-1.png`, 'PNG');
  c.sheet = [
    { view: 'front', label: 'Front', core: true, file: `${made.id}/front-1.png`, seed: 1 },
    { view: 'back', label: 'Back', core: true, file: `${made.id}/back-1.png`, seed: 1 },
  ];
  c.status = 'ready';
  await characters.rename(made.id, 'Mira Okafor');

  const list = await listCharacters(b.site, { now: () => Date.parse('2026-10-24T10:17:00Z') });
  assert.deepEqual(
    list.map((x) => x.id),
    [made.id],
    "the member's character is not the owner's",
  );
  assert.equal(list[0].name, 'Mira Okafor');
  assert.equal(list[0].status, 'ready');
  assert.equal(list[0].age, 34);
  assert.equal(list[0].adult, true);
  assert.equal(list[0].fictional, true);
  assert.equal(list[0].sheet.length, 1, 'only pictures that are really there');
  assert.match(list[0].sheet[0].url, /^https:\/\/acct\.r2\.cloudflarestorage\.com\/orbit-models\/characters\/.+\/front-1\.png\?/);
  assert.ok(!list[0].sheet[0].url.includes(CONF.secretAccessKey));
  assert.equal(list[0].descriptor.startsWith('A photorealistic 34-year-old woman'), true);
  assert.notEqual(member.id, made.id);

  // Deleted on the machine: gone from the list.
  await characters.remove(made.id);
  assert.deepEqual(await listCharacters(b.site), []);
});
