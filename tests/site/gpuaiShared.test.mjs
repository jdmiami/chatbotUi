// The AI machine on GPU.ai (lib/gpuaiShared.ts): which instance is ours, what its status means, and
// when the address it published is the one to use. Run with: npm run test:site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_TERMINATE_HOURS, DISK_GB, ONLY_MAKERS, STANDARD_GPUS, TURBO_GPUS, isLive, liveAddress, machineState, nextGpu, pickMachine } from '../../lib/gpuaiShared.ts';

const inst = (o) => ({ id: 'gpu-1', name: 'orbit-ai', status: 'running', created_at: '2026-11-04T10:00:00Z', ...o });

test('the newest live instance with the AI machine’s name is the machine; gone ones never are', () => {
  const list = [
    inst({ id: 'old', created_at: '2026-11-04T09:00:00Z' }),
    inst({ id: 'new', created_at: '2026-11-04T10:00:00Z' }),
    inst({ id: 'dead', status: 'terminated', created_at: '2026-11-04T11:00:00Z' }),
    inst({ id: 'other', name: 'something-else', created_at: '2026-11-04T12:00:00Z' }),
  ];
  assert.equal(pickMachine(list, 'orbit-ai').id, 'new');
  assert.equal(pickMachine([], 'orbit-ai'), null);
  assert.ok(isLive({ status: 'allocating' }));
  assert.ok(!isLive({ status: 'stopped' }));
});

test('GPU.ai’s status as the site’s state', () => {
  assert.equal(machineState(null), 'off');
  assert.equal(machineState(inst({ status: 'allocating' })), 'starting');
  assert.equal(machineState(inst({ status: 'starting' })), 'starting');
  assert.equal(machineState(inst({ status: 'running' })), 'running');
  assert.equal(machineState(inst({ status: 'unreachable' })), 'running');
  assert.equal(machineState(inst({ status: 'terminated' })), 'off');
  assert.equal(machineState(inst({ status: 'error' })), 'off');
});

test('the published address counts only when it is this instance’s own, a tunnel, and fresh', () => {
  const now = Date.parse('2026-11-04T10:10:00Z');
  const i = inst({});
  const good = { name: 'orbit-ai', url: 'https://wise-fox-tunnel.trycloudflare.com', startedAt: '2026-11-04T10:02:00Z', at: '2026-11-04T10:09:30Z' };
  assert.equal(liveAddress(good, i, now), 'https://wise-fox-tunnel.trycloudflare.com');
  // Stale heartbeat: the machine is gone or stuck.
  assert.equal(liveAddress({ ...good, at: '2026-11-04T10:05:00Z' }, i, now), null);
  // An older machine's note (started before this instance existed).
  assert.equal(liveAddress({ ...good, startedAt: '2026-11-04T09:30:00Z' }, i, now), null);
  // A minute of clock slack is fine.
  assert.equal(liveAddress({ ...good, startedAt: '2026-11-04T09:59:30Z' }, i, now), good.url);
  // Another machine's note, or something that is not a tunnel address.
  assert.equal(liveAddress({ ...good, name: 'orbit-ai-canvas' }, i, now), null);
  assert.equal(liveAddress({ ...good, url: 'https://evil.example' }, i, now), null);
  assert.equal(liveAddress({ ...good, url: 'http://wise-fox-tunnel.trycloudflare.com' }, i, now), null);
  assert.equal(liveAddress(null, i, now), null);
});

test('a GPU type GPU.ai cannot place our image on is skipped; anything else is a real error', () => {
  assert.ok(nextGpu(422, '{"code":"image_unavailable"}'));
  assert.ok(nextGpu(422, 'no capacity for rtx_a6000'));
  assert.ok(!nextGpu(422, '{"code":"validation_failed","detail":"env key reserved"}'));
  assert.ok(!nextGpu(401, 'unauthorized'));
});

test('the machine loads only Qwen Image (with its edit) and H3 Max, on a 48 GB GPU or better, and never runs past its limit', () => {
  assert.equal(ONLY_MAKERS, 'qwen,edit,h3-max');
  assert.equal(STANDARD_GPUS[0].gpu, 'rtx_a6000');
  assert.ok(STANDARD_GPUS.every((g, i, a) => i === 0 || g.pricePerHour >= a[i - 1].pricePerHour), 'cheapest first');
  assert.ok(TURBO_GPUS[0].pricePerHour > STANDARD_GPUS[STANDARD_GPUS.length - 1].pricePerHour);
  assert.ok(AUTO_TERMINATE_HOURS >= 2 && AUTO_TERMINATE_HOURS <= 24);
  assert.ok(DISK_GB >= 120);
});
