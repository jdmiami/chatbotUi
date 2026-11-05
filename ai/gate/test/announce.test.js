import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MACHINE_KEY, askSiteToTurnOff, createAnnounce } from '../src/announce.js';
import { verifyJwt } from '../src/jwt.js';
import { memoryR2 } from './fakes/memoryR2.js';

// An AI machine on GPU.ai: its tunnel address goes to R2 for the site, and the auto-off rule asks the
// site to terminate it.

test('the address from the tunnel file is published in R2 with a heartbeat; nothing until the file has one', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'announce-'));
  const file = path.join(dir, 'url');
  const { objects, r2 } = memoryR2();
  let t = 1_000_000;
  const a = createAnnounce({ file, name: 'orbit-ai', r2, log: {}, now: () => t, startedAt: t });
  // Nothing yet: the file is missing, then holds something that is not an address.
  assert.equal(await a.publishNow(), false);
  await fs.writeFile(file, 'connecting...\n');
  assert.equal(await a.publishNow(), false);
  assert.ok(!objects.has(MACHINE_KEY));
  await fs.writeFile(file, 'https://wise-fox-tunnel.trycloudflare.com\n');
  assert.equal(await a.publishNow(), true);
  const note = JSON.parse(objects.get(MACHINE_KEY).toString());
  assert.deepEqual(note, { name: 'orbit-ai', url: 'https://wise-fox-tunnel.trycloudflare.com', startedAt: new Date(1_000_000).toISOString(), at: new Date(1_000_000).toISOString() });
  assert.equal(a.url(), 'https://wise-fox-tunnel.trycloudflare.com');
  // A minute on: the heartbeat moves, the address stays.
  t += 60_000;
  await a.publishNow();
  assert.equal(JSON.parse(objects.get(MACHINE_KEY).toString()).at, new Date(1_060_000).toISOString());
  a.stop();
});

test('asking the site to turn the machine off: a short-lived token the site can check, and its name', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response('{}', { status: 200 });
  };
  await askSiteToTurnOff({ siteUrl: 'https://site.example/', secret: 's3cret-s3cret-s3cret-s3cret-s3cret', name: 'orbit-ai', fetchImpl, log: {} });
  assert.equal(calls[0].url, 'https://site.example/api/ai/off');
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: 'orbit-ai' });
  const token = calls[0].init.headers.authorization.replace(/^Bearer /, '');
  const payload = verifyJwt(token, 's3cret-s3cret-s3cret-s3cret-s3cret', { audience: 'site-island' });
  assert.equal(payload.sub, 'ai-machine');
  assert.equal(payload.name, 'orbit-ai');
  assert.ok(payload.exp - payload.iat <= 120);
  await assert.rejects(askSiteToTurnOff({ siteUrl: 'https://site.example', secret: 'x', name: 'orbit-ai', fetchImpl: async () => new Response('', { status: 403 }), log: {} }), /403/);
  await assert.rejects(askSiteToTurnOff({ siteUrl: '', secret: 'x', name: 'orbit-ai', fetchImpl, log: {} }), /SITE_URL/);
});

test('the drawing machine keeps its own note and asks to turn off only itself', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-note-'));
  const file = path.join(dir, 'url');
  await fs.writeFile(file, 'https://draw-me.trycloudflare.com\n');
  const { r2, objects } = memoryR2();
  const a = createAnnounce({ file, name: 'orbit-ai-canvas', r2, key: 'state/canvas-machine.json', log: {} });
  await a.publishNow();
  assert.equal(JSON.parse(objects.get('state/canvas-machine.json').toString()).url, 'https://draw-me.trycloudflare.com');
  assert.equal(objects.has(MACHINE_KEY), false, "the AI machine's note is left alone");
  let token = '';
  const fetchImpl = async (_url, init) => {
    token = init.headers.authorization.slice(7);
    return new Response('{}');
  };
  await askSiteToTurnOff({ siteUrl: 'https://site.example', secret: 's3cret-s3cret-s3cret-s3cret-s3cret', name: 'orbit-ai-canvas', sub: 'canvas-machine', fetchImpl, log: {} });
  assert.equal(verifyJwt(token, 's3cret-s3cret-s3cret-s3cret-s3cret', { audience: 'site-island' }).sub, 'canvas-machine');
});
