import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPush, vapidHeader, vapidKeys } from '../src/push.js';
import { createAutoOff as createIdleWatch } from '../../../shared/autooff.js';

const SECRET = 'x'.repeat(40);

test('the push key comes from the secret, and the header is a valid ES256 signature', () => {
  const a = vapidKeys(SECRET);
  assert.equal(vapidKeys(SECRET).publicKey, a.publicKey);
  assert.notEqual(vapidKeys('y'.repeat(40)).publicKey, a.publicKey);
  assert.equal(Buffer.from(a.publicKey, 'base64url').length, 65);

  const header = vapidHeader({ endpoint: 'https://web.push.apple.com/abc', keys: a, subject: 'mailto:o@x', now: 1_000_000 });
  const [, t, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, a.publicKey);
  const [h, c, s] = t.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'mailto:o@x');
  const pub = crypto.createPublicKey(a.privateKey);
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});

test('push keeps browsers, sends to each, and drops the ones that are gone', async () => {
  let saved = null;
  const calls = [];
  const push = createPush({
    secret: SECRET,
    subject: 'mailto:o@x',
    load: async () => [{ endpoint: 'https://a.push/1' }],
    save: async (l) => void (saved = l),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: url.endsWith('/1'), status: url.endsWith('/1') ? 201 : 410 };
    },
    log: {},
  });
  await assert.rejects(push.add({ endpoint: 'http://not-https/x' }));
  await assert.rejects(push.add({}));
  assert.equal(await push.add({ endpoint: 'https://b.push/2', keys: { p256dh: 'k', auth: 'a' } }), 2);
  assert.deepEqual(saved, [{ endpoint: 'https://a.push/1' }, { endpoint: 'https://b.push/2' }]);
  assert.equal(await push.send(), 1);
  assert.equal(calls.length, 2);
  assert.match(calls[0].init.headers.authorization, /^vapid t=/);
  assert.equal(calls[0].init.headers.ttl, '600');
  assert.equal(calls[0].init.body, undefined); // no message: nothing to encrypt
  assert.deepEqual(saved, [{ endpoint: 'https://a.push/1' }]);
  await push.remove('https://a.push/1');
  assert.equal(await push.count(), 0);
});

test('idle watch warns once, 10 minutes before turning off, and again after new use', async () => {
  let t = 0;
  const warned = [];
  const w = createIdleWatch({ limitMinutes: 20, busy: async () => false, stop: async () => {}, now: () => t, warn: async (at) => void warned.push(at), log: {} });
  t = 9 * 60_000;
  await w.check();
  assert.equal(warned.length, 0);
  t = 10 * 60_000;
  await w.check();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(warned, [20 * 60_000]);
  t = 11 * 60_000;
  await w.check();
  await new Promise((r) => setImmediate(r));
  assert.equal(warned.length, 1);
  w.activity(); // used again: a new countdown, a new warning
  t = 21 * 60_000;
  await w.check();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(warned, [20 * 60_000, 31 * 60_000]);
});

test('the auto-off countdown starts only once a download is done', async () => {
  let t = 0;
  let downloading = true;
  let stops = 0;
  const w = createIdleWatch({ limitMinutes: 20, busy: async () => downloading, stop: async () => void stops++, now: () => t, log: {} });
  for (t = 0; t <= 60 * 60_000; t += 60_000) await w.check();
  assert.equal(stops, 0);
  downloading = false; // finished at minute 60
  for (; t < 80 * 60_000; t += 60_000) await w.check();
  assert.equal(stops, 0);
  t = 81 * 60_000;
  await w.check();
  assert.equal(stops, 1);
});

test('the AI machine downloads every gate file (ai/setup.sh)', async () => {
  const fs = await import('node:fs');
  const setup = fs.readFileSync(new URL('../../setup.sh', import.meta.url), 'utf8');
  for (const f of fs.readdirSync(new URL('../src/', import.meta.url))) assert.ok(setup.includes(`src/${f}`), `ai/setup.sh is missing src/${f}`);
  // The shared auto-off timer, laid out like the repository so ../../../shared resolves.
  for (const f of fs.readdirSync(new URL('../../../shared/', import.meta.url)).filter((x) => /\.js$|^package\.json$/.test(x))) {
    assert.ok(setup.includes(`shared/${f}`), `ai/setup.sh is missing shared/${f}`);
  }
  assert.match(setup, /GATE="\$APP\/ai\/gate"/);
});
