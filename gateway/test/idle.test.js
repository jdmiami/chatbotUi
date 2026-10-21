import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { GUAC_INPUT } from '../src/idle.js';
import { createGateway, loadConfig } from '../src/server.js';
import { AUTO_OFF, createAutoOff } from '../../shared/autooff.js';

// The Linux machine uses the same auto-off timer as the AI machine (shared/autooff.js).
const createInputWatch = createAutoOff;

test('auto-off on Linux: stops after the limit without input; input and a running turn postpone it', async () => {
  let t = 0;
  let stops = 0;
  let turn = false;
  const w = createInputWatch({ limitMinutes: 20, busy: () => turn, stop: async () => void stops++, now: () => t, log: {} });
  t = 19 * 60_000;
  await w.check();
  assert.equal(stops, 0);
  w.activity();
  t = 38 * 60_000;
  await w.check();
  assert.equal(stops, 0, 'input at 19 min keeps it on until 39');
  turn = true;
  t = 60 * 60_000;
  await w.check();
  assert.equal(stops, 0, 'an Antigravity turn is a job');
  turn = false;
  t = 81 * 60_000;
  await w.check();
  assert.equal(stops, 1);
  assert.equal(w.state().idleMinutes, 21);
});

test('auto-off on Linux fail-safes: a turn that never ends stops counting; a failed stop is retried in minutes', async () => {
  let t = 0;
  let tries = 0;
  const w = createInputWatch({ limitMinutes: 20, busy: () => true, stop: async () => { tries++; throw new Error('api down'); }, now: () => t, log: {} });
  t = 179 * 60_000;
  await w.check();
  assert.equal(tries, 0);
  t = 181 * 60_000;
  await w.check();
  assert.equal(tries, 1, 'busy for 3 hours without input no longer holds it on');
  t = 182 * 60_000;
  await w.check();
  assert.equal(tries, 1);
  t = 184 * 60_000;
  await w.check();
  assert.equal(tries, 2);
  assert.equal(w.state().lastStop.ok, false);
});

test('desktop input: mouse, keys and touches count; pings and screen sizes do not', () => {
  assert.ok(GUAC_INPUT.test('5.mouse,3.120,3.300,1.0;'));
  assert.ok(GUAC_INPUT.test('3.key,5.65307,1.1;'));
  assert.ok(GUAC_INPUT.test('4.sync,8.12345678;5.touch,1.0,2.10,2.20,1.5,1.5,1.0,1.1;'));
  assert.ok(!GUAC_INPUT.test('0.,4.ping,13.1700000000000;'));
  assert.ok(!GUAC_INPUT.test('4.size,4.1280,3.720;'));
  assert.ok(!GUAC_INPUT.test('4.sync,8.12345678;'));
});

test('a running Claude Code process owned by this user counts as busy', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const os = await import('node:os');
  const { cliAgentRunning } = await import('../src/idle.js');
  const dir = await mkdtemp(os.tmpdir() + '/proc-');
  await mkdir(dir + '/12'); await writeFile(dir + '/12/comm', 'bash\n');
  await mkdir(dir + '/self'); 
  assert.equal(await cliAgentRunning({ procDir: dir }), false);
  await mkdir(dir + '/34'); await writeFile(dir + '/34/comm', 'claude\n');
  assert.equal(await cliAgentRunning({ procDir: dir }), true);
  assert.equal(await cliAgentRunning({ procDir: dir, uid: 999999 }), false, 'another user\'s process does not count');
  assert.equal(await cliAgentRunning({ procDir: dir + '/missing' }), false);
});

test('the gateway reports its timer at /idle and keeps on for the owner at /keepawake', async () => {
  const SECRET = 'y'.repeat(40);
  let t = Date.UTC(2030, 0, 1);
  const idle = createAutoOff({ limitMinutes: 60, stop: async () => {}, now: () => t, log: {} });
  const config = loadConfig({ GATEWAY_SECRET: SECRET, RDP_HOST: 'pc', ALLOWED_ORIGINS: 'https://site.example' });
  const server = createGateway(config, { info() {}, warn() {}, error() {} }, null, null, idle);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const state = await (await fetch(`${base}/idle`)).json();
    assert.deepEqual(Object.keys(state).sort(), ['heldUntil', 'idleMinutes', 'idleSeconds', 'lastStop', 'limitMinutes', 'offAt']);
    assert.equal(state.offAt, new Date(t + 60 * 60_000).toISOString());

    const token = (aud = 'orbit-host') =>
      new SignJWT({ scope: 'orbit' }).setProtectedHeader({ alg: 'HS256' }).setSubject('owner').setIssuer('rdp-web').setAudience(aud).setIssuedAt().setExpirationTime('120s').sign(new TextEncoder().encode(SECRET));
    const keep = (headers, body = { minutes: AUTO_OFF.keepOnMinutes }) => fetch(`${base}/keepawake`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await keep({})).status, 401, 'needs the owner token');
    assert.equal((await keep({ authorization: `Bearer ${await token('rdp-gateway')}` })).status, 401, 'only a host token');
    assert.equal((await fetch(`${base}/keepawake`)).status, 405);
    t += 10 * 60_000;
    const res = await keep({ authorization: `Bearer ${await token()}` });
    assert.equal(res.status, 200);
    const held = await res.json();
    // Counts as use (off 60 min from now), then 30 more.
    assert.equal(held.offAt, new Date(t + 90 * 60_000).toISOString());
    assert.equal(held.heldUntil, held.offAt);
    const capped = await (await keep({ authorization: `Bearer ${await token()}` }, { minutes: 999 })).json();
    assert.equal(capped.offAt, new Date(t + AUTO_OFF.maxHoldMinutes * 60_000).toISOString(), 'never more than two hours from now');
  } finally {
    server.close();
  }
});
