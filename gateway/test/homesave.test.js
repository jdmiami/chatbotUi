import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { createHomeSaver } from '../src/homesave.js';
import { createGateway, loadConfig } from '../src/server.js';

const quiet = { info() {}, warn() {}, error() {} };

test('home saver: runs the save script through sudo, one run at a time; no script, no save', async () => {
  const calls = [];
  let finish;
  const saver = createHomeSaver({ command: '/usr/local/bin/orbit-home-save', run: (cmd, args) => (calls.push([cmd, ...args]), new Promise((r) => (finish = r))), log: quiet });
  assert.equal(saver.enabled, true);
  const a = saver.save();
  const b = saver.save();
  finish();
  assert.deepEqual(await a, { saved: true });
  assert.deepEqual(await b, { saved: true });
  assert.deepEqual(calls, [['sudo', '-n', '/usr/local/bin/orbit-home-save']], 'two asks share one run');

  const none = createHomeSaver({ command: '', run: () => assert.fail('nothing to run'), log: quiet });
  assert.equal(none.enabled, false);
  assert.deepEqual(await none.save(), { saved: false, reason: 'no save command' });
});

test('the gateway saves the home at /save for the owner only', async () => {
  const SECRET = 'z'.repeat(40);
  let saves = 0;
  let fail = false;
  const saver = { enabled: true, save: async () => { saves++; if (fail) throw new Error('R2 down'); return { saved: true }; } };
  const config = loadConfig({ GATEWAY_SECRET: SECRET, RDP_HOST: 'pc', ALLOWED_ORIGINS: 'https://site.example' });
  const server = createGateway(config, quiet, null, null, null, saver);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = (aud = 'orbit-host') =>
    new SignJWT({ scope: 'orbit' }).setProtectedHeader({ alg: 'HS256' }).setSubject('owner').setIssuer('rdp-web').setAudience(aud).setIssuedAt().setExpirationTime('120s').sign(new TextEncoder().encode(SECRET));
  const save = (headers = {}) => fetch(`${base}/save`, { method: 'POST', headers });
  try {
    assert.equal((await save()).status, 401);
    assert.equal((await save({ authorization: `Bearer ${await token('rdp-gateway')}` })).status, 401);
    assert.equal((await fetch(`${base}/save`)).status, 405);
    assert.equal(saves, 0);
    const ok = await save({ authorization: `Bearer ${await token()}` });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { saved: true });
    fail = true;
    const bad = await save({ authorization: `Bearer ${await token()}` });
    assert.equal(bad.status, 502);
    assert.match((await bad.json()).error, /R2 down/);
  } finally {
    server.close();
  }
});
