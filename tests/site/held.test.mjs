// Results held for the owner (lib/held.ts) read and reviewed straight from Cloudflare R2 with the AI machine off.
// The records are written by the machine's own code (ai/gate/src/held.js) to prove both sides agree.
// Run with: npm run test:site (Node strips the TypeScript types itself).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createR2 } from '../../lib/r2.ts';
import { HeldError, approveHeld, listHeld, noteHeld } from '../../lib/held.ts';
import { listGallery, forgetNotes } from '../../lib/gallery.ts';
import { createR2 as gateR2 } from '../../ai/gate/src/r2.js';
import { createHeld } from '../../ai/gate/src/held.js';

const CONF = { accountId: 'acct', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', bucket: 'orbit-models' };
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const NOW = () => new Date('2026-10-24T10:17:00Z');

/** One bucket in memory with both clients on it: the site's and the machine's. */
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
    if (method === 'GET') return store.has(key) ? new Response(store.get(key)) : new Response('<Error><Message>The specified key does not exist.</Message></Error>', { status: 404 });
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
  return { store, site: createR2(CONF, fetchImpl, NOW), machine: gateR2({ ...CONF, fetchImpl }) };
}

async function hold(machine, id, extra = {}, { canApprove = true, category = 'checker-unavailable' } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'held-site-'));
  const file = path.join(dir, `${id}.mp4`);
  await fs.writeFile(file, 'the video bytes');
  const item = { id, kind: 'video', maker: 'person-swap', prompt: 'Swapped a person: the man', width: 832, height: 480, seconds: 5, file: `orbit/video-${id}.mp4`, nsfw: true, owner: 'm:afterdark:ann', character: { id: 'anna01', name: 'Anna' }, createdAt: '2026-10-23T10:00:00Z', ...extra };
  const held = createHeld({ dir, r2: machine, log: { warn() {} }, now: () => Date.parse('2026-10-24T09:00:00Z') });
  await held.hold({ item, file, reason: 'The safety check could not look at this.', category, canApprove });
  return item;
}

test('the owner sees what is held, with a preview link, why, who made it and the character; nothing else', async () => {
  const { site, machine, store } = bucket();
  await hold(machine, 'held0001');
  store.set('gallery/orbit/other001.json', Buffer.from(JSON.stringify({ id: 'other001', kind: 'image', file: 'orbit/a.png', createdAt: '2026-10-22T00:00:00Z' })));
  store.set('gallery/orbit/a.png', Buffer.from('png'));
  const list = await listHeld(site, { now: () => Date.parse('2026-10-24T10:17:00Z') });
  assert.equal(list.length, 1);
  const [h] = list;
  assert.equal(h.id, 'held0001');
  assert.equal(h.kind, 'video');
  assert.equal(h.nsfw, true);
  assert.equal(h.madeBy, 'A studio member');
  assert.equal(h.character.name, 'Anna');
  assert.equal(h.canApprove, true);
  assert.match(h.reason, /safety check/);
  assert.match(h.url, /^https:\/\/acct\.r2\.cloudflarestorage\.com\/orbit-models\/held\/held0001\.mp4\?/);
  assert.equal(new URL(h.url).searchParams.get('response-content-type'), 'video/mp4');
  assert.ok(!h.url.includes(CONF.secretAccessKey));
  // The gallery listing never shows a held result.
  forgetNotes();
  const gallery = await listGallery(site);
  assert.deepEqual(gallery.map((i) => i.id), ['other001']);
});

test('a note is added without the machine; there is no way to delete from here', async () => {
  const { site, machine, store } = bucket();
  await hold(machine, 'held0002');
  const r = await noteHeld(site, 'held0002', '  Wait for a better check.  ', { now: () => Date.parse('2026-10-24T11:00:00Z') });
  assert.equal(r.notes[0].text, 'Wait for a better check.');
  assert.equal(r.notes[0].by, 'owner');
  assert.equal((await listHeld(site))[0].notes.length, 1);
  await assert.rejects(noteHeld(site, 'held0002', '   '), HeldError);
  await assert.rejects(noteHeld(site, '../x', 'hi'), HeldError);
  const mod = await import('../../lib/held.ts');
  assert.deepEqual(Object.keys(mod).filter((k) => /delete|remove/i.test(k)), []);
  assert.ok(store.has('held/held0002.mp4'), 'still there');
});

test('approve (machine off): back in the gallery with its NSFW mark and an audit line; the record stays', async () => {
  const { site, machine, store } = bucket();
  await hold(machine, 'held0003');
  assert.deepEqual((await listHeld(site)).map((i) => i.id), ['held0003']);
  const r = await approveHeld(site, 'held0003', { now: () => Date.parse('2026-10-24T12:00:00Z') });
  assert.equal(r.approvedAt, '2026-10-24T12:00:00.000Z');
  assert.equal(store.get('gallery/orbit/video-held0003.mp4').toString(), 'the video bytes');
  const note = JSON.parse(store.get('gallery/orbit/held0003.json'));
  assert.equal(note.nsfw, true, 'the blur and hold-to-reveal still apply');
  assert.equal(note.owner, 'm:afterdark:ann', "that person's gallery");
  assert.deepEqual(note.review, [{ at: '2026-10-24T12:00:00.000Z', by: 'owner', action: 'approved' }]);
  assert.ok(!store.has('held/held0003.mp4'), 'the held copy moved');
  assert.equal(JSON.parse(store.get('held/held0003.json')).status, 'approved');
  assert.deepEqual(await listHeld(site), []);
  forgetNotes();
  assert.deepEqual((await listGallery(site)).map((i) => [i.id, i.nsfw]), [['held0003', true]]);
  await assert.rejects(approveHeld(site, 'held0003'), (e) => e.status === 404);
  // The machine reads the same record as approved.
  const m = createHeld({ dir: await fs.mkdtemp(path.join(os.tmpdir(), 'held-site-')), r2: machine, log: { warn() {} } });
  assert.deepEqual(await m.list(), []);
});

test('a result with a real person in it cannot be approved, only kept held with notes', async () => {
  const { site, machine, store } = bucket();
  await hold(machine, 'held0004', { photo: true, photoGuard: true }, { canApprove: false, category: 'flagged' });
  const [h] = await listHeld(site);
  assert.equal(h.canApprove, false);
  await assert.rejects(approveHeld(site, 'held0004'), (e) => e.status === 409 && /can't be approved/.test(e.message));
  assert.ok(store.has('held/held0004.mp4'));
  assert.ok(!store.has('gallery/orbit/held0004.json'));
});
