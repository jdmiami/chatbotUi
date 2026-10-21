import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AUTO_OFF, autoOffSentence, clampAutoOffMinutes, createAutoOff } from '../../../shared/autooff.js';

// One rule for every machine (shared/autooff.js): these tests pin the numbers and the shape.

test('one number: 60 by default, kept within 10–60, never 0', () => {
  assert.equal(AUTO_OFF.defaultMinutes, 60);
  assert.equal(clampAutoOffMinutes(undefined), 60);
  assert.equal(clampAutoOffMinutes(''), 60);
  assert.equal(clampAutoOffMinutes('0'), 60, '0 would mean never: not allowed');
  assert.equal(clampAutoOffMinutes('-5'), 60);
  assert.equal(clampAutoOffMinutes('abc'), 60);
  assert.equal(clampAutoOffMinutes('30'), 30);
  assert.equal(clampAutoOffMinutes(5), 10);
  assert.equal(clampAutoOffMinutes(240), 60, 'never longer than an hour');
  assert.equal(autoOffSentence(30), 'Turns itself off after 30 minutes unused.');
  assert.equal(autoOffSentence(), 'Turns itself off after 60 minutes unused.');
});

test('the timer reports the same shape on every machine', () => {
  const t = 0;
  const w = createAutoOff({ limitMinutes: 60, stop: async () => {}, now: () => t, log: {} });
  assert.deepEqual(Object.keys(w.state()).sort(), ['heldUntil', 'idleMinutes', 'idleSeconds', 'lastStop', 'limitMinutes', 'offAt']);
  assert.equal(w.state().offAt, new Date(60 * 60_000).toISOString());
  assert.equal(w.state().heldUntil, null);
  w.extend(AUTO_OFF.keepOnMinutes);
  assert.equal(w.state().offAt, new Date(90 * 60_000).toISOString());
  assert.equal(w.state().heldUntil, new Date(90 * 60_000).toISOString());
});

test('a sync busy() works too (the Linux machine), and keep on is capped from now', async () => {
  let t = 0;
  let stops = 0;
  const w = createAutoOff({ limitMinutes: 10, busy: () => false, stop: async () => void stops++, now: () => t, log: {} });
  for (let i = 0; i < 5; i++) w.extend(60);
  assert.equal(w.state().offAt, new Date(AUTO_OFF.maxHoldMinutes * 60_000).toISOString());
  t = (AUTO_OFF.maxHoldMinutes - 1) * 60_000;
  await w.check();
  assert.equal(stops, 0);
  t = AUTO_OFF.maxHoldMinutes * 60_000;
  await w.check();
  assert.equal(stops, 1);
});

test('the status pill on the machines uses the same numbers (orbit/public/island.js)', () => {
  const island = fs.readFileSync(new URL('../../../orbit/public/island.js', import.meta.url), 'utf8');
  const m = /const AUTO_OFF_FALLBACK = \{ minutes: (\d+), keepOnMinutes: (\d+) \}/.exec(island);
  assert.ok(m, 'island.js has its fallback numbers');
  assert.equal(Number(m[1]), AUTO_OFF.defaultMinutes);
  assert.equal(Number(m[2]), AUTO_OFF.keepOnMinutes);
});
