import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInputWatch, GUAC_INPUT } from '../src/idle.js';

test('input watch: stops after 20 minutes without input; input and a running turn postpone it', async () => {
  let t = 0;
  let stops = 0;
  let turn = false;
  const w = createInputWatch({ limitMinutes: 20, busy: () => turn, stop: async () => void stops++, now: () => t, log: {} });
  t = 19 * 60_000;
  await w.check();
  assert.equal(stops, 0);
  w.input();
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

test('input watch fail-safes: a turn that never ends stops counting; a failed stop is retried in minutes', async () => {
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
