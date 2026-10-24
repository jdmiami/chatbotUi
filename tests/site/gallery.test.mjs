// The site's gallery from Cloudflare R2 (lib/r2.ts, lib/gallery.ts) against an R2 kept in memory.
// Run with: npm run test:site (Node strips the TypeScript types itself).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createR2, r2Config } from '../../lib/r2.ts';
import { deleteItem, forgetNotes, importCloudItem, keepLabItem, listGallery, markNsfw, sourceOf } from '../../lib/gallery.ts';
import { createR2 as gateR2 } from '../../ai/gate/src/r2.js';

const CONF = { accountId: 'acct', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', bucket: 'orbit-models' };
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** An R2 bucket in memory, answering the S3 calls the client makes (and checking each is signed). */
function fakeR2(files = {}) {
  const store = new Map(Object.entries(files).map(([k, v]) => [k, Buffer.from(typeof v === 'string' ? v : JSON.stringify(v))]));
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    calls.push(`${method} ${u.pathname}${u.search}`);
    assert.match(init.headers?.authorization ?? '', /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/);
    assert.equal(u.host, 'acct.r2.cloudflarestorage.com');
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
  return { store, calls, r2: createR2(CONF, fetchImpl, () => new Date('2026-10-24T10:17:00Z')) };
}

const note = (id, extra = {}) => ({ id, kind: 'image', maker: 'qwen', prompt: `prompt ${id}`, file: `orbit/image-${id}_00001_.png`, createdAt: `2026-10-2${extra.day ?? 1}T10:00:00Z`, ...extra });
const withFile = (n) => ({ [`gallery/orbit/${n.id}.json`]: n, [`gallery/${n.file}`]: 'PNGDATA' });

test('the storage keys use the same names as the AI machine, and a missing one means not set up', () => {
  assert.equal(r2Config({}), null);
  assert.equal(r2Config({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b' }), null);
  assert.equal(r2Config({ R2_ACCOUNT_ID: '{{ RUNPOD_SECRET_r2_account_id }}', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c' }), null);
  assert.deepEqual(r2Config({ R2_ACCOUNT_ID: ' a ', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c' }), { accountId: 'a', accessKeyId: 'b', secretAccessKey: 'c', bucket: 'orbit-models' });
  assert.equal(r2Config({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'other' }).bucket, 'other');
});

test('a presigned link is the same one the AI machine signs', () => {
  const at = new Date('2026-10-24T10:00:00Z');
  const ours = createR2(CONF).presign('gallery/orbit/video-abc_00001_.mp4', 7200, { at });
  const theirs = gateR2(CONF).presign('gallery/orbit/video-abc_00001_.mp4', 7200, at);
  assert.equal(ours, theirs);
  const saved = createR2(CONF).presign('gallery/x.mp4', 60, { at, type: 'video/mp4', download: 'video-x.mp4' });
  const u = new URL(saved);
  assert.equal(u.searchParams.get('response-content-type'), 'video/mp4');
  assert.equal(u.searchParams.get('response-content-disposition'), 'attachment; filename="video-x.mp4"');
  assert.match(u.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
  assert.ok(!saved.includes(CONF.secretAccessKey), 'the secret never appears in a link');
});

test('the gallery lists every kind of creation, newest first, with where it came from and links that stay the same', async () => {
  forgetNotes();
  const files = {
    ...withFile(note('make01', { day: 1 })),
    ...withFile(note('cloud01', { day: 2, maker: 'cloud:fal', file: 'cloud/abc.jpg' })),
    ...withFile(note('labvid1', { day: 3, kind: 'video', maker: 'ltx', lab: true, file: 'orbit/video-labvid1.mp4', prompt: `Fit check.${' The person is a fictional adult over 25, not a real or famous person. Flirty and confident but tasteful: clothed or in swimwear, no nudity, nothing explicit.'}` })),
    ...withFile(note('movie01', { day: 4, kind: 'video', maker: 'soreal', movie: 'mv1', file: 'movies/mv1.mp4', nsfw: false })),
    ...withFile(note('draw01', { day: 5, maker: 'sketch-finish', nsfwUser: true })),
    // Still uploading: its file isn't there yet.
    'gallery/orbit/nofile1.json': note('nofile1', { day: 6 }),
    // About children and not checked yet: never shown.
    ...withFile(note('guard01', { day: 7, minorGuard: true })),
    // Not a note.
    'gallery/orbit/movies/mv1.json': { id: 'mv1' },
    'state/meme-lab.json': { records: [{ id: 'labvid1', title: 'Fit check: rooftop', caption: 'Golden hour', hashtags: ['#fit'], score: 81 }] },
  };
  const { r2, calls } = fakeR2(files);
  const items = await listGallery(r2, { now: () => Date.parse('2026-10-24T10:17:00Z') });
  assert.deepEqual(items.map((i) => [i.id, i.source]), [
    ['draw01', 'livedraw'],
    ['movie01', 'soreal'],
    ['labvid1', 'lab'],
    ['cloud01', 'cloud'],
    ['make01', 'make'],
  ]);
  const lab = items.find((i) => i.id === 'labvid1');
  assert.equal(lab.lab, true);
  assert.equal(lab.prompt, 'Fit check.', 'the adult note is never shown');
  assert.equal(lab.title, 'Fit check: rooftop');
  assert.equal(lab.score, 81);
  assert.equal(new URL(lab.url).searchParams.get('response-content-type'), 'video/mp4');
  assert.match(new URL(lab.downloadUrl).searchParams.get('response-content-disposition'), /attachment/);
  assert.equal(items.find((i) => i.id === 'draw01').nsfwUser, true);
  assert.equal(items.find((i) => i.id === 'movie01').nsfw, false);
  // Signed for the half hour: the same links a few minutes later, so nothing reloads.
  const again = await listGallery(r2, { now: () => Date.parse('2026-10-24T10:26:00Z') });
  assert.equal(again.find((i) => i.id === 'make01').url, items.find((i) => i.id === 'make01').url);
  // Notes that did not change are not read twice.
  const noteReads = calls.filter((c) => /^GET \/orbit-models\/gallery\/orbit\/make01\.json/.test(c));
  assert.equal(noteReads.length, 1);
});

test('marking NSFW, keeping a Lab picture and deleting work on R2 directly', async () => {
  forgetNotes();
  const pic = note('labpic1', { lab: true });
  const mov = note('labmov1', { lab: true, kind: 'video', movie: 'mv9', file: 'movies/mv9.mp4' });
  const { r2, store } = fakeR2({ ...withFile(pic), ...withFile(mov), ...withFile(note('keep01')) });

  assert.deepEqual(await markNsfw(r2, 'keep01', true), { ok: true, nsfwUser: true });
  assert.equal(JSON.parse(store.get('gallery/orbit/keep01.json')).nsfwUser, true);
  await markNsfw(r2, 'keep01', null);
  assert.equal('nsfwUser' in JSON.parse(store.get('gallery/orbit/keep01.json')), false);

  await keepLabItem(r2, 'labpic1');
  assert.equal('lab' in JSON.parse(store.get('gallery/orbit/labpic1.json')), false);
  await assert.rejects(keepLabItem(r2, 'labmov1'), (err) => err.status === 409 && /needs the AI machine/.test(err.message));

  await deleteItem(r2, 'keep01');
  assert.equal(store.has('gallery/orbit/keep01.json'), false);
  assert.equal(store.has('gallery/orbit/image-keep01_00001_.png'), false);
  await assert.rejects(deleteItem(r2, 'keep01'), (err) => err.status === 404);
  await assert.rejects(markNsfw(r2, '../state/x', true), (err) => err.status === 400);
});

test('a cloud creation is saved into the gallery, only from the cloud makers', async () => {
  forgetNotes();
  const { r2, store } = fakeR2();
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  const n = await importCloudItem(r2, { url: `data:image/png;base64,${png}`, kind: 'image', prompt: 'a red fox', maker: 'cloud:cloudflare' });
  assert.match(n.file, /^cloud\/[A-Za-z0-9_-]+\.png$/);
  assert.ok(store.has(`gallery/${n.file}`));
  assert.equal(JSON.parse(store.get(`gallery/orbit/${n.id}.json`)).prompt, 'a red fox');
  assert.equal(sourceOf(n), 'cloud');
  const items = await listGallery(r2);
  assert.equal(items[0].id, n.id);

  await assert.rejects(importCloudItem(r2, { url: 'https://evil.example/x.mp4', kind: 'video' }), /Only files from the cloud makers/);
  await assert.rejects(importCloudItem(r2, { url: 'http://v3.fal.media/x.mp4', kind: 'video' }), /Only files from the cloud makers/);
  const fetched = [];
  const fetchImpl = async (u) => {
    fetched.push(String(u));
    return new Response(Buffer.from('MP4'), { headers: { 'content-type': 'video/mp4' } });
  };
  const v = await importCloudItem(r2, { url: 'https://v3.fal.media/files/x.mp4', kind: 'video', prompt: 'waves' }, { fetchImpl });
  assert.deepEqual(fetched, ['https://v3.fal.media/files/x.mp4']);
  assert.match(v.file, /\.mp4$/);
});
