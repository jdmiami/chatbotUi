import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createGate } from '../src/gate.js';
import { signJwt } from '../src/jwt.js';
import { runFfmpeg } from '../src/movies.js';
import { createStudio } from '../src/studio.js';
import { THUMB_SIDE, createThumbs, isWebp, posterAt, thumbArgs, wantsThumb } from '../src/thumbs.js';
import { memoryR2 } from './fakes/memoryR2.js';

// Gallery thumbnails: a small WebP for every picture and video (a video's from half a second in), made
// when it is saved and in the background for older ones, mirrored to R2, gone with the item, never public for a held one.

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const quiet = { warn() {}, info() {} };
const SECRET = 't'.repeat(40);
const FILES = {
  image: [{ dir: 'diffusion_models', name: 'img.safetensors', repo: 'o/r', path: 'img.safetensors', size: 4 }],
  video: [{ dir: 'checkpoints', name: 'vid.safetensors', repo: 'o/r', path: 'vid.safetensors', size: 4 }],
};
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
/** The smallest file isWebp() takes for a WebP: what a pretend ffmpeg writes. */
const FAKE_WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(24)]);

const size = (file) =>
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file])
    .toString()
    .trim()
    .split(',')
    .map(Number);

async function tmp(name) {
  return fs.mkdtemp(path.join(os.tmpdir(), `thumbs-${name}-`));
}

test('thumbnail arguments: at most 480 px on the long side, never bigger, a WebP; a video from half a second in', () => {
  const a = thumbArgs({ input: 'in.png', output: 'out.webp' });
  assert.ok(!a.includes('-ss'), 'a picture has no seek');
  assert.equal(a.at(-1), 'out.webp');
  assert.equal(a[a.indexOf('-c:v') + 1], 'libwebp');
  assert.equal(a[a.indexOf('-frames:v') + 1], '1');
  assert.match(a[a.indexOf('-vf') + 1], /min\(480,iw\).*min\(480,ih\).*force_original_aspect_ratio=decrease/);
  const v = thumbArgs({ input: 'in.mp4', output: 'out.webp', at: 0.5, threads: 1 });
  assert.deepEqual(v.slice(0, 2), ['-ss', '0.5'], 'the seek comes before the input (fast, reads little)');
  assert.equal(v[v.indexOf('-threads') + 1], '1');
  assert.equal(posterAt(8), 0.5);
  assert.equal(posterAt(0.4), 0.2, 'a very short video: its middle');
  assert.equal(posterAt(undefined), 0.5);
  assert.equal(THUMB_SIDE, 480);
});

test('which items get a public thumbnail: never one still waiting for its check', () => {
  assert.equal(wantsThumb({ id: 'abcdef1', kind: 'image' }), true);
  assert.equal(wantsThumb({ id: 'abcdef1', kind: 'video', nsfw: true }), true, 'NSFW ones too: the grid blurs the tile');
  assert.equal(wantsThumb({ id: 'abcdef1', kind: 'image', minorGuard: true }), false);
  assert.equal(wantsThumb({ id: 'abcdef1', kind: 'image', minorGuard: true, nsfw: false }), true);
  assert.equal(wantsThumb({ id: 'abcdef1', kind: 'video', photoGuard: true }), false);
  assert.equal(wantsThumb({ id: 'abcdef1', kind: 'video', photoGuard: true, nsfw: false }), true);
  assert.equal(wantsThumb({ id: '../x', kind: 'image' }), false);
  assert.equal(wantsThumb({ id: 'abcdef1', kind: 'audio' }), false);
});

test('real ffmpeg: a big picture becomes a small WebP; a video gets its frame from half a second in; a very short one its first', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const dir = await tmp('real');
  const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  ff(['-f', 'lavfi', '-i', 'testsrc=size=1328x1992:rate=1', '-frames:v', '1', path.join(dir, 'tall.png')]);
  ff(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=1', '-frames:v', '1', path.join(dir, 'small.png')]);
  ff(['-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=24', '-t', '2', '-pix_fmt', 'yuv420p', path.join(dir, 'clip.mp4')]);
  ff(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24', '-t', '0.1', '-pix_fmt', 'yuv420p', path.join(dir, 'blip.mp4')]);
  const calls = [];
  const thumbs = createThumbs({ root: dir, ffmpeg: (args, opts) => (calls.push(args), runFfmpeg(args, opts)), log: quiet });
  const tall = await thumbs.make({ id: 'tall001', kind: 'image' }, path.join(dir, 'tall.png'));
  assert.ok(await isWebp(tall));
  assert.deepEqual(size(tall), [320, 480], 'long side 480, shape kept');
  const st = await fs.stat(tall);
  assert.ok(st.size < (await fs.stat(path.join(dir, 'tall.png'))).size / 4, `much smaller (${st.size} bytes)`);
  assert.deepEqual(size(await thumbs.make({ id: 'small01', kind: 'image' }, path.join(dir, 'small.png'))), [320, 180], 'never made bigger');
  const poster = await thumbs.make({ id: 'clip001', kind: 'video', seconds: 2 }, path.join(dir, 'clip.mp4'));
  assert.deepEqual(size(poster), [480, 270]);
  assert.deepEqual(calls.at(-1).slice(0, 2), ['-ss', '0.5']);
  // 0.1 s long: half a second in has no frame, so the first one is used.
  const blip = await thumbs.make({ id: 'blip001', kind: 'video' }, path.join(dir, 'blip.mp4'));
  assert.ok(blip && (await isWebp(blip)), 'a very short video still gets one');
  assert.equal(path.relative(dir, blip), path.join('thumbs', 'blip001.webp'));
  assert.deepEqual((await fs.readdir(path.join(dir, 'thumbs'))).sort(), ['blip001.webp', 'clip001.webp', 'small01.webp', 'tall001.webp'], 'no half-made files left behind');
  await fs.rm(dir, { recursive: true, force: true });
});

test('a thumbnail that cannot be made never fails anything: the grid shows the file', async () => {
  const dir = await tmp('fail');
  const thumbs = createThumbs({ root: dir, ffmpeg: async () => Promise.reject(new Error('ffmpeg failed')), log: quiet });
  assert.equal(await thumbs.make({ id: 'abc1234', kind: 'image' }, '/nowhere.png'), null);
  const none = createThumbs({ root: dir, ffmpeg: null, log: quiet });
  assert.equal(await none.make({ id: 'abc1234', kind: 'image' }, '/nowhere.png'), null);
  assert.equal(await none.backfill({ list: async () => [{ id: 'abc1234', kind: 'image' }], source: () => 'x' }), 0);
  await fs.rm(dir, { recursive: true, force: true });
});

test('backfill: a couple at a time, niced, waits while you are making something, picks up where it stopped, drops one deleted meanwhile', async () => {
  const dir = await tmp('backfill');
  const { r2, objects } = memoryR2();
  const { createMirror } = await import('../src/r2.js');
  const mirror = createMirror({ r2, root: dir, prefix: 'gallery/', log: quiet });
  // Made on the other machine already: in R2, not made again.
  objects.set('gallery/thumbs/there01.webp', FAKE_WEBP);
  let running = 0;
  let most = 0;
  const niced = [];
  const ffmpeg = async (args, opts) => {
    niced.push(Boolean(opts?.nice));
    running++;
    most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    if (args.includes('/broken.png')) throw new Error('not a picture');
    await fs.writeFile(args.at(-1), FAKE_WEBP);
  };
  const slept = [];
  let busyFor = 2;
  const thumbs = createThumbs({ root: dir, ffmpeg, mirror, log: quiet, sleep: async (ms) => void slept.push(ms) });
  const list = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `item00${i}`, kind: i % 2 ? 'video' : 'image', seconds: 4 })),
    { id: 'there01', kind: 'image' },
    { id: 'broken1', kind: 'image' },
    { id: 'guard01', kind: 'image', minorGuard: true },
    { id: 'gone001', kind: 'image' },
  ];
  const made = await thumbs.backfill({
    list: async () => list,
    source: (it) => (it.id === 'broken1' ? '/broken.png' : `/files/${it.id}.png`),
    still: async (id) => id !== 'gone001',
    busy: () => busyFor-- > 0,
    batch: 2,
    pauseMs: 1500,
    waitMs: 5000,
  });
  assert.equal(made, 5, 'the five new ones (not the one R2 had, the broken one, the guarded one or the deleted one)');
  assert.ok(most <= 2, `at most two at a time (${most})`);
  assert.ok(niced.every(Boolean), 'every one niced');
  assert.deepEqual(slept.slice(0, 2), [5000, 5000], 'waited while you were making something');
  assert.ok(slept.includes(1500), 'a pause between each couple');
  assert.ok(objects.has('gallery/thumbs/item000.webp') && objects.has('gallery/thumbs/item004.webp'), 'mirrored to R2');
  assert.ok(!objects.has('gallery/thumbs/gone001.webp'), 'deleted while it was made: not left in R2');
  assert.ok(!(await fs.stat(path.join(dir, 'thumbs', 'gone001.webp')).catch(() => null)), 'nor here');
  assert.ok(!objects.has('gallery/thumbs/guard01.webp'));
  assert.ok(thumbs.has('there01') && thumbs.has('item003'));

  // Started again (a restart): nothing is made twice; the broken one is tried once more, then left alone.
  const again = createThumbs({ root: dir, ffmpeg, mirror, log: quiet, sleep: async () => {} });
  niced.length = 0;
  assert.equal(await again.backfill({ list: async () => list, source: (it) => (it.id === 'broken1' ? '/broken.png' : `/files/${it.id}.png`) }), 1, 'only the one deleted earlier is in the list again');
  assert.equal(niced.length, 2, 'the broken one (its second try) and the one that was dropped');
  niced.length = 0;
  await createThumbs({ root: dir, ffmpeg, mirror, log: quiet, sleep: async () => {} }).backfill({ list: async () => list, source: (it) => (it.id === 'broken1' ? '/broken.png' : `/files/${it.id}.png`) });
  assert.equal(niced.length, 0, 'failed twice: left alone');
  await fs.rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- in the studio and through the gate

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

async function studioWith({ r2, nsfw, thumbFfmpeg = runFfmpeg } = {}) {
  const dir = await tmp('studio');
  for (const f of [...FILES.image, ...FILES.video]) {
    const p = path.join(dir, 'models', f.dir, f.name);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, 'xxxx');
  }
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/system_stats') return Response.json({});
    if (u.pathname === '/api/ps') return Response.json({ models: [] });
    return Response.json({});
  };
  const studio = createStudio({ dir, files: FILES, fetchImpl, WebSocketImpl: null, log: quiet, ffmpeg: async () => {}, thumbFfmpeg, nsfw, ...(r2 ? { r2 } : {}), statfs: async () => ({ bavail: 1e6, bsize: 1024 ** 2 }) });
  return { dir, studio };
}

test('saved items get a thumbnail, mirrored to R2 next to the gallery; the listing links it, deleting the item deletes it', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const { r2, objects } = memoryR2();
  const { dir, studio } = await studioWith({ r2 });
  // A cloud import (also how Lab, soReal cuts and Live Draw keeps are saved: addItem), and a real little video.
  const pic = await studio.importItem({ url: `data:image/png;base64,${PNG}`, kind: 'image', prompt: 'a lighthouse' });
  await fs.mkdir(path.join(dir, 'output', 'movies'), { recursive: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24', '-t', '1', '-pix_fmt', 'yuv420p', path.join(dir, 'output', 'movies', 'cut.mp4')]);
  const vid = await studio.addItem({ kind: 'video', prompt: 'a cut', file: path.join('movies', 'cut.mp4'), seconds: 1, width: 640, height: 360, movie: 'mv1' });
  for (const it of [pic, vid]) {
    assert.ok(await isWebp(path.join(dir, 'output', 'thumbs', `${it.id}.webp`)), `${it.kind}: made here`);
    assert.ok(objects.has(`gallery/thumbs/${it.id}.webp`), `${it.kind}: in R2 next to the gallery`);
  }
  // Sent before the note: a listing that sees the note sees its thumbnail.
  const keys = [...objects.keys()];
  assert.ok(keys.indexOf(`gallery/thumbs/${vid.id}.webp`) < keys.indexOf(`gallery/orbit/${vid.id}.json`));

  const server = createGate({ secret: SECRET, webui: 'http://127.0.0.1:9', ollama: 'http://127.0.0.1:9', allowedOrigins: 'https://site.example', siteUrl: 'https://site.example', status: async () => ({}), studio }, quiet);
  const base = `http://127.0.0.1:${await listen(server)}`;
  const key = signJwt({ sub: 'jd', aud: 'orbit-ai' }, SECRET, { expiresIn: 600 });
  const { items } = await (await fetch(`${base}/_orbit/studio/items`, { headers: { authorization: `Bearer ${key}` } })).json();
  for (const it of items) {
    assert.match(it.thumbUrl, new RegExp(`^/_orbit/studio/thumb/${it.id}\\?t=`), 'a thumbnail link for the grid');
    assert.match(it.url, new RegExp(`^/_orbit/studio/file/${it.id}\\?t=`), 'and the file for the viewer');
  }
  // The link works in an <img> (no bearer), is a small WebP the browser may keep.
  const res = await fetch(base + items.find((i) => i.id === vid.id).thumbUrl);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/webp');
  assert.match(res.headers.get('cache-control'), /max-age=\d+/);
  assert.ok((await res.arrayBuffer()).byteLength < 30_000);
  assert.equal((await fetch(`${base}/_orbit/studio/thumb/${vid.id}`)).status, 401, 'not without its token');

  // Made on this machine but gone from its disk (a restart on a fresh disk): it comes down from R2.
  await fs.rm(path.join(dir, 'output', 'thumbs', `${pic.id}.webp`));
  assert.equal((await fetch(base + items.find((i) => i.id === pic.id).thumbUrl)).status, 200);

  // Deleting the item (your own delete) deletes its thumbnail too, here and in R2.
  const del = await fetch(`${base}/_orbit/studio/items/${vid.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${key}` } });
  assert.equal(del.status, 200);
  assert.ok(!objects.has(`gallery/thumbs/${vid.id}.webp`));
  assert.ok(!(await fs.stat(path.join(dir, 'output', 'thumbs', `${vid.id}.webp`)).catch(() => null)));
  assert.equal((await fetch(base + items.find((i) => i.id === vid.id).thumbUrl)).status, 404);
  server.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('an NSFW note change does not send the whole file to R2 again', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const { r2, log } = memoryR2();
  const { dir, studio } = await studioWith({ r2 });
  const pic = await studio.importItem({ url: `data:image/png;base64,${PNG}`, kind: 'image', prompt: 'a lighthouse' });
  const fileKey = `gallery/${pic.file.split(path.sep).join('/')}`;
  const puts = () => log.filter((l) => l === `PUT ${fileKey}`).length;
  assert.equal(puts(), 1);
  await studio.markNsfw(pic.id, true);
  assert.equal(puts(), 1, 'only the note goes up again');
  assert.equal(log.filter((l) => l === `PUT gallery/thumbs/${pic.id}.webp`).length, 1, 'and the thumbnail is not made again');
  await fs.rm(dir, { recursive: true, force: true });
});

test('the background backfill in the studio makes thumbnails for older items, from R2 when the file is not here', async () => {
  const { r2, objects } = memoryR2();
  const seen = [];
  const thumbFfmpeg = async (args) => {
    seen.push(args[args.indexOf('-i') + 1]);
    await fs.writeFile(args.at(-1), FAKE_WEBP);
  };
  const { dir, studio } = await studioWith({ r2, thumbFfmpeg });
  // An older picture made here, and one made on the other machine (only its note and file are in R2).
  await fs.mkdir(path.join(dir, 'output', 'orbit'), { recursive: true });
  await fs.writeFile(path.join(dir, 'output', 'orbit', 'old.png'), Buffer.from(PNG, 'base64'));
  await fs.writeFile(path.join(dir, 'output', 'orbit', 'old0001.json'), JSON.stringify({ id: 'old0001', kind: 'image', prompt: 'old', file: 'orbit/old.png', createdAt: '2026-10-01T00:00:00Z' }));
  objects.set('gallery/orbit/old0001.json', Buffer.from(JSON.stringify({ id: 'old0001', kind: 'image', prompt: 'old', file: 'orbit/old.png', createdAt: '2026-10-01T00:00:00Z' })));
  objects.set('gallery/orbit/old.png', Buffer.from(PNG, 'base64'));
  objects.set('gallery/orbit/far0001.json', Buffer.from(JSON.stringify({ id: 'far0001', kind: 'video', prompt: 'far', file: 'orbit/far.mp4', seconds: 5, createdAt: '2026-10-02T00:00:00Z' })));
  objects.set('gallery/orbit/far.mp4', Buffer.from('MP4'));
  await fs.writeFile(path.join(dir, 'output', '.r2-gallery-copied'), 'yes');
  const made = await studio.backfillThumbs();
  assert.equal(made, 2);
  assert.ok(objects.has('gallery/thumbs/old0001.webp') && objects.has('gallery/thumbs/far0001.webp'));
  assert.ok(seen.includes(path.join(dir, 'output', 'orbit', 'old.png')), 'the file on this machine');
  assert.ok(seen.some((s) => /^https:\/\/acct\.r2\.cloudflarestorage\.com\/orbit-models\/gallery\/orbit\/far\.mp4\?.*X-Amz-Signature=/.test(s)), 'a short-lived link for one only in R2 (nothing downloaded)');
  assert.ok(!(await fs.stat(path.join(dir, 'output', 'orbit', 'far.mp4')).catch(() => null)), 'the video was not brought down');
  assert.equal(await studio.backfillThumbs(), 0, 'nothing twice');
  await fs.rm(dir, { recursive: true, force: true });
});

test('a held result never gets a public thumbnail: its own is kept with it under held/', async () => {
  const { r2, objects } = memoryR2();
  const thumbFfmpeg = async (args) => fs.writeFile(args.at(-1), FAKE_WEBP);
  // The check says adult content on a real person's photo: held, not shown.
  const nsfw = { check: async () => ({ nsfw: true, score: 0.97 }) };
  const { dir, studio } = await studioWith({ r2, nsfw, thumbFfmpeg });
  await fs.mkdir(path.join(dir, 'output', 'orbit'), { recursive: true });
  await fs.writeFile(path.join(dir, 'output', 'orbit', 'swap.png'), Buffer.from(PNG, 'base64'));
  await fs.writeFile(path.join(dir, 'output', 'orbit', 'swap001.json'), JSON.stringify({ id: 'swap001', kind: 'image', prompt: 'a swap', photoGuard: true, file: 'orbit/swap.png', createdAt: '2026-10-01T00:00:00Z' }));
  // Not checked yet: the backfill leaves it alone.
  assert.equal(await studio.backfillThumbs(), 0);
  assert.ok(![...objects.keys()].some((k) => k.startsWith('gallery/thumbs/')));
  await studio.rateAll();
  assert.equal(await studio.item('swap001'), null, 'out of the gallery');
  assert.ok(objects.has('held/swap001.json') && objects.has('held/swap001.png'), 'held');
  assert.ok(objects.has('held/thumbs/swap001.webp'), 'its preview is kept with it');
  assert.ok(![...objects.keys()].some((k) => k.startsWith('gallery/thumbs/')), 'nothing under gallery/thumbs/');
  assert.ok(!(await fs.readdir(path.join(dir, 'output', 'thumbs')).catch(() => [])).some((n) => n.endsWith('.webp')), 'nor in the gallery folder here');
  assert.equal(await studio.thumbFile('swap001'), null, 'the gallery thumbnail route has nothing for it');
  const f = await studio.held.thumbFile('swap001');
  assert.equal(f.type, 'image/webp');
  assert.equal((await studio.held.list())[0].thumb, true);

  // Through the gate: only the owner's held list links it, under its own held link.
  const server = createGate({ secret: SECRET, webui: 'http://127.0.0.1:9', ollama: 'http://127.0.0.1:9', allowedOrigins: 'https://site.example', siteUrl: 'https://site.example', status: async () => ({}), studio }, quiet);
  const base = `http://127.0.0.1:${await listen(server)}`;
  const key = signJwt({ sub: 'jd', aud: 'orbit-ai' }, SECRET, { expiresIn: 600 });
  const held = await (await fetch(`${base}/_orbit/studio/held`, { headers: { authorization: `Bearer ${key}` } })).json();
  assert.match(held.items[0].thumbUrl, /^\/_orbit\/studio\/held\/thumb\/swap001\?t=/);
  const r = await fetch(base + held.items[0].thumbUrl);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/webp');
  const gallery = await (await fetch(`${base}/_orbit/studio/items`, { headers: { authorization: `Bearer ${key}` } })).json();
  assert.equal(gallery.items.length, 0);
  server.close();
  await fs.rm(dir, { recursive: true, force: true });
});
