// The site's gallery and held lists read R2 the cheap way (lib/r2.ts IndexCache): one listing, one index
// object, then only what changed. Counts the requests a cold server makes for 500 items.
// Run with: npm run test:site (Node strips the TypeScript types itself).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createR2 } from '../../lib/r2.ts';
import { THUMBS_PER_CALL, deleteItem, forgetNotes, listGallery, makeThumbs, markNsfw, pictureThumb } from '../../lib/gallery.ts';
import { forgetHeld, listHeld } from '../../lib/held.ts';

const CONF = { accountId: 'acct', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', bucket: 'orbit-models' };
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const NOW = Date.parse('2026-10-24T10:17:00Z');

/** An R2 bucket in memory like the real one: ETags are the content's MD5, a listing page holds 1000 keys. */
function fakeR2(files = {}) {
  const store = new Map(Object.entries(files).map(([k, v]) => [k, Buffer.isBuffer(v) ? v : Buffer.from(typeof v === 'string' ? v : JSON.stringify(v))]));
  const calls = [];
  const kept = new Map();
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const key = decodeURIComponent(u.pathname.replace(/^\/orbit-models\/?/, ''));
    calls.push(`${method} ${key || `list ${u.searchParams.get('prefix')}`}`);
    if (method === 'GET' && !key) {
      const prefix = u.searchParams.get('prefix') || '';
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = Number(u.searchParams.get('continuation-token') || 0);
      const page = keys.slice(start, start + 1000);
      const more = start + 1000 < keys.length;
      const body = page.map((k) => `<Contents><Key>${xml(k)}</Key><Size>${store.get(k).length}</Size><ETag>"${crypto.createHash('md5').update(store.get(k)).digest('hex')}"</ETag></Contents>`).join('');
      return new Response(`<ListBucketResult><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + 1000}</NextContinuationToken>` : ''}${body}</ListBucketResult>`);
    }
    if (method === 'GET') return store.has(key) ? new Response(store.get(key)) : new Response('<Error><Message>The specified key does not exist.</Message></Error>', { status: 404 });
    if (method === 'PUT') {
      store.set(key, Buffer.from(init.body));
      kept.set(key, { type: init.headers['content-type'], cacheControl: init.headers['cache-control'] });
      return new Response('');
    }
    if (method === 'DELETE') {
      store.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response('nope', { status: 400 });
  };
  const counted = () => {
    const n = calls.length;
    calls.length = 0;
    return n;
  };
  return { store, calls, counted, kept, r2: createR2(CONF, fetchImpl, () => new Date(NOW)) };
}

const id = (i) => `item${String(i).padStart(4, '0')}`;
/** `n` gallery items, each with its file, its note and (unless `thumbs` is false) its thumbnail. */
function gallery(n, { thumbs = true } = {}) {
  const files = {};
  for (let i = 0; i < n; i++) {
    const note = { id: id(i), kind: i % 5 ? 'image' : 'video', maker: 'qwen', prompt: `a picture number ${i}`, width: 1024, height: 768, file: `orbit/${id(i)}.png`, createdAt: new Date(NOW - i * 60_000).toISOString() };
    files[`gallery/orbit/${id(i)}.json`] = note;
    files[`gallery/orbit/${id(i)}.png`] = 'PNG'.repeat(10);
    if (thumbs) files[`gallery/thumbs/${id(i)}.webp`] = 'WEBP';
  }
  return files;
}

test('500 items: a cold listing is 3 requests once the index exists (it was 500 notes read one by one)', async () => {
  forgetNotes();
  const { r2, counted, calls, store } = fakeR2(gallery(500));
  // The very first time (no index yet): everything is read once, and the index is written.
  const first = await listGallery(r2, { now: () => NOW });
  assert.equal(first.length, 500);
  const firstCalls = [...calls];
  const firstCount = counted();
  assert.equal(firstCalls.filter((c) => /^GET gallery\/orbit\//.test(c)).length, 500);
  assert.ok(firstCalls.includes('PUT gallery/_index.v1.json'));
  assert.ok(store.has('gallery/_index.v1.json'));
  assert.equal(firstCount, 2 + 1 + 500 + 1, 'two listing pages (1501 keys), the index (none yet), the notes, the index written');

  // A new server instance (cold), nothing changed: the listing (two pages) and the index. Nothing written.
  forgetNotes();
  const cold = await listGallery(r2, { now: () => NOW });
  assert.deepEqual([...calls].sort(), ['GET gallery/_index.v1.json', 'GET list gallery/', 'GET list gallery/']);
  assert.equal(counted(), 3);
  assert.deepEqual(cold, first, 'the same answer');

  // The same instance again (warm): only the listing.
  await listGallery(r2, { now: () => NOW });
  assert.equal(counted(), 2);
});

test('the index never beats the listing: changed, new and removed items are read or dropped by their ETags', async () => {
  forgetNotes();
  const { r2, store, calls, counted } = fakeR2(gallery(20));
  await listGallery(r2, { now: () => NOW });
  counted();
  // Changed on the machine, a new one, and one deleted, all while no site instance was running.
  const changed = JSON.parse(store.get('gallery/orbit/item0003.json'));
  store.set('gallery/orbit/item0003.json', Buffer.from(JSON.stringify({ ...changed, nsfw: true, prompt: 'changed words' })));
  store.set('gallery/orbit/new00001.json', Buffer.from(JSON.stringify({ id: 'new00001', kind: 'image', prompt: 'brand new', file: 'orbit/new.png', createdAt: new Date(NOW + 1000).toISOString() })));
  store.set('gallery/orbit/new.png', Buffer.from('PNG'));
  store.delete('gallery/orbit/item0007.json');
  store.delete('gallery/orbit/item0007.png');
  forgetNotes();
  const items = await listGallery(r2, { now: () => NOW });
  assert.deepEqual(calls.filter((c) => /^GET gallery\/orbit\//.test(c)).sort(), ['GET gallery/orbit/item0003.json', 'GET gallery/orbit/new00001.json']);
  assert.ok(calls.includes('PUT gallery/_index.v1.json'), 'the index is brought up to date');
  assert.equal(counted(), 1 + 1 + 2 + 1);
  assert.equal(items.find((i) => i.id === 'item0003').prompt, 'changed words');
  assert.equal(items.find((i) => i.id === 'item0003').nsfw, true);
  assert.equal(items[0].id, 'new00001');
  assert.ok(!items.some((i) => i.id === 'item0007'));
  const index = JSON.parse(store.get('gallery/_index.v1.json'));
  assert.ok(!('gallery/orbit/item0007.json' in index.entries), 'a removed one leaves the index');

  // A wrong index (another instance's half-written one, or tampered): an entry whose ETag doesn't match is never used.
  index.entries['gallery/orbit/item0001.json'].value.prompt = 'WRONG';
  index.entries['gallery/orbit/item0001.json'].etag = '"not-the-etag"';
  store.set('gallery/_index.v1.json', Buffer.from(JSON.stringify(index)));
  forgetNotes();
  const fixed = await listGallery(r2, { now: () => NOW });
  assert.equal(fixed.find((i) => i.id === 'item0001').prompt, 'a picture number 1', 'read again by its ETag');
  assert.equal(calls.filter((c) => /^GET gallery\/orbit\//.test(c)).length, 1);
  counted();

  // An unreadable index is no index: everything is read, and a good one written.
  store.set('gallery/_index.v1.json', Buffer.from('{not json'));
  forgetNotes();
  assert.equal((await listGallery(r2, { now: () => NOW })).length, 20);
  assert.equal(calls.filter((c) => /^GET gallery\/orbit\//.test(c)).length, 20);
  assert.equal(JSON.parse(store.get('gallery/_index.v1.json')).v, 1);
});

test('marks and deletes from the site show at once on the same instance, and the delete takes the thumbnail too', async () => {
  forgetNotes();
  const { r2, store } = fakeR2(gallery(3));
  await listGallery(r2, { now: () => NOW });
  await markNsfw(r2, 'item0001', true);
  assert.equal((await listGallery(r2, { now: () => NOW })).find((i) => i.id === 'item0001').nsfwUser, true);
  await deleteItem(r2, 'item0002');
  assert.ok(!store.has('gallery/thumbs/item0002.webp'), 'its thumbnail is deleted with it');
  assert.ok(!store.has('gallery/orbit/item0002.png') && !store.has('gallery/orbit/item0002.json'));
  assert.deepEqual((await listGallery(r2, { now: () => NOW })).map((i) => i.id), ['item0000', 'item0001']);
});

test('thumbnail links: only when the thumbnail is there, signed for the half hour like the file, typed as WebP', async () => {
  forgetNotes();
  const files = gallery(4);
  delete files['gallery/thumbs/item0002.webp'];
  const { r2 } = fakeR2(files);
  const a = await listGallery(r2, { now: () => NOW });
  assert.equal(a.find((i) => i.id === 'item0002').thumbUrl, undefined, 'none yet: the grid uses the file');
  const t = new URL(a.find((i) => i.id === 'item0001').thumbUrl);
  assert.equal(t.pathname, '/orbit-models/gallery/thumbs/item0001.webp');
  assert.equal(t.searchParams.get('response-content-type'), 'image/webp');
  assert.equal(t.searchParams.get('X-Amz-Date'), '20261024T100000Z', 'signed at the start of the half hour');
  assert.equal(t.searchParams.get('response-content-disposition'), null);
  assert.equal(t.searchParams.get('response-cache-control'), null, 'nothing that stops the browser keeping it');
  const b = await listGallery(r2, { now: () => NOW + 9 * 60_000 });
  assert.equal(b.find((i) => i.id === 'item0001').thumbUrl, a.find((i) => i.id === 'item0001').thumbUrl, 'the same link, so the browser keeps the picture');
  // What the listing sends per item: links and words, no picture data.
  const json = JSON.stringify(a);
  assert.ok(!/base64|data:/.test(json));
  assert.ok(json.length / a.length < 2000, `about ${Math.round(json.length / a.length)} bytes an item`);
});

test('a Lab item brings the Lab titles along (read alongside, not after); none at all without Lab items', async () => {
  forgetNotes();
  const files = gallery(3);
  files['gallery/orbit/lab00001.json'] = { id: 'lab00001', kind: 'video', maker: 'ltx', prompt: 'p', lab: true, file: 'orbit/lab.mp4', createdAt: new Date(NOW).toISOString() };
  files['gallery/orbit/lab.mp4'] = 'MP4';
  files['state/meme-lab.json'] = { records: [{ id: 'lab00001', title: 'Rooftop', score: 77 }] };
  const { r2, calls, counted } = fakeR2(files);
  assert.equal((await listGallery(r2, { now: () => NOW })).find((i) => i.id === 'lab00001').title, 'Rooftop');
  counted();
  forgetNotes();
  assert.equal((await listGallery(r2, { now: () => NOW })).find((i) => i.id === 'lab00001').title, 'Rooftop');
  assert.deepEqual(calls.sort(), ['GET gallery/_index.v1.json', 'GET list gallery/', 'GET state/meme-lab.json']);
  counted();
  forgetNotes();
  const plain = fakeR2(gallery(3));
  await listGallery(plain.r2, { now: () => NOW });
  assert.ok(!plain.calls.includes('GET state/meme-lab.json'));
});

test('held results: a cold look is the listing and the index; a held preview is linked from held/ only', async () => {
  forgetHeld();
  const files = {};
  for (let i = 0; i < 50; i++) {
    const hid = `held${String(i).padStart(4, '0')}`;
    files[`held/${hid}.json`] = { id: hid, status: 'held', kind: 'image', ext: '.png', reason: 'r', category: 'flagged', heldAt: new Date(NOW - i).toISOString(), canApprove: false, thumb: true, item: { id: hid, file: `orbit/${hid}.png` } };
    files[`held/${hid}.png`] = 'PNG';
    if (i % 2) files[`held/thumbs/${hid}.webp`] = 'WEBP';
  }
  const { r2, calls, counted } = fakeR2(files);
  const first = await listHeld(r2, { now: () => NOW });
  assert.equal(first.length, 50);
  counted();
  forgetHeld();
  const again = await listHeld(r2, { now: () => NOW });
  assert.deepEqual([...calls].sort(), ['GET held/_index.v1.json', 'GET list held/']);
  assert.deepEqual(again, first);
  assert.match(new URL(first.find((h) => h.id === 'held0001').thumbUrl).pathname, /^\/orbit-models\/held\/thumbs\/held0001\.webp$/);
  assert.equal(first.find((h) => h.id === 'held0002').thumbUrl, undefined);
  // Nothing about held results ever shows in the gallery.
  forgetNotes();
  assert.deepEqual(await listGallery(r2, { now: () => NOW }), []);
});

// ---------------------------------------------------------------- thumbnails made by the site (machine off)

/** A real picture (a 900x600 PNG), made with the same library the site uses. */
async function png(width = 900, height = 600) {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width, height, channels: 3, background: '#c84' } }).png().toBuffer();
}
const webpSize = async (buf) => {
  const sharp = (await import('sharp')).default;
  const m = await sharp(buf).metadata();
  return [m.format, m.width, m.height];
};

test('the site makes missing picture thumbnails itself, a few a call, the same as the machine makes them', async () => {
  forgetNotes();
  const pic = await png();
  const files = {};
  const add = (id, extra = {}, body = pic) => {
    const n = { id, kind: 'image', prompt: id, file: `orbit/${id}.png`, createdAt: new Date(NOW - Number(id.slice(-2)) * 60_000).toISOString(), ...extra };
    files[`gallery/orbit/${id}.json`] = n;
    files[`gallery/${n.file}`] = body;
  };
  for (let i = 0; i < 12; i++) add(`pict${String(i).padStart(4, '0')}`);
  add('vide0050', { kind: 'video', file: 'orbit/vide0050.mp4' }, 'MP4');
  add('kids0051', { minorGuard: true });
  add('swap0052', { photoGuard: true });
  add('nsfw0053', { nsfw: true });
  add('bad00054', {}, 'not a picture');
  // Held results live under held/: never looked at here.
  files['held/held0001.json'] = { id: 'held0001', status: 'held', kind: 'image', ext: '.png' };
  files['held/held0001.png'] = pic;
  const { r2, store, kept } = fakeR2(files);
  const before = await listGallery(r2, { now: () => NOW });
  assert.ok(before.every((i) => !i.thumbUrl));

  // The ones on screen first.
  const first = await makeThumbs(r2, { ids: ['pict0011', 'pict0010'], now: () => NOW });
  assert.equal(first.made.length, THUMBS_PER_CALL, 'capped per call, so a request never runs long');
  assert.deepEqual(first.made.slice(0, 2).map((m) => m.id).sort(), ['pict0010', 'pict0011']);
  for (const m of first.made) {
    const key = `gallery/thumbs/${m.id}.webp`;
    assert.deepEqual(await webpSize(store.get(key)), ['webp', 480, 320], 'at most 480 px on its long side, a WebP');
    assert.deepEqual(kept.get(key), { type: 'image/webp', cacheControl: 'private, max-age=86400' });
    assert.equal(new URL(m.thumbUrl).pathname, `/orbit-models/${key}`);
  }
  assert.ok(first.left > 0);
  const second = await makeThumbs(r2, { now: () => NOW });
  // The rest of the pictures, the NSFW one too (it still shows blurred, as its picture does).
  assert.deepEqual(second.made.map((m) => m.id).sort(), ['nsfw0053', 'pict0006', 'pict0007', 'pict0008', 'pict0009'].sort());
  assert.equal(second.left, 0, 'the unreadable one was tried and left alone');
  assert.deepEqual((await makeThumbs(r2, { now: () => NOW })).made, [], 'nothing twice');
  // Never: a video (the machine takes its frame), one about children or a real person's photo not checked yet, a held result.
  for (const id of ['vide0050', 'kids0051', 'swap0052', 'bad00054']) assert.ok(!store.has(`gallery/thumbs/${id}.webp`), id);
  assert.ok(![...store.keys()].some((k) => k.startsWith('held/thumbs/') || k === 'gallery/thumbs/held0001.webp'));
  // The listing links them now.
  const after = await listGallery(r2, { now: () => NOW });
  assert.equal(after.filter((i) => i.thumbUrl).length, 13);
  assert.equal(after.find((i) => i.id === 'vide0050').thumbUrl, undefined);
});

test('a picture deleted while its thumbnail was being made leaves no thumbnail behind', async () => {
  forgetNotes();
  const pic = await png(200, 300);
  const { r2, store } = fakeR2({ 'gallery/orbit/gone0001.json': { id: 'gone0001', kind: 'image', prompt: 'p', file: 'orbit/g.png', createdAt: new Date(NOW).toISOString() }, 'gallery/orbit/g.png': pic });
  const res = await makeThumbs(r2, {
    now: () => NOW,
    thumb: async (buf) => {
      store.delete('gallery/orbit/gone0001.json');
      return pictureThumb(buf);
    },
  });
  assert.deepEqual(res.made, []);
  assert.ok(!store.has('gallery/thumbs/gone0001.webp'));
  // A small picture is never made bigger.
  assert.deepEqual(await webpSize(await pictureThumb(pic)), ['webp', 200, 300]);
});
