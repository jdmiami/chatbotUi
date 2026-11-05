// The AI machine on GPU.ai (lib/gpuaiShared.ts): which instance is ours, what its status means, and
// when the address it published is the one to use. Run with: npm run test:site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_TERMINATE_HOURS, DISK_GB, ONLY_MAKERS, cleanPicks, libraryOf, STANDARD_GPUS, TURBO_GPUS, isLive, liveAddress, machineState, nextGpu, nextGpuAfterFailedOperation, pickMachine, pickOffering } from '../../lib/gpuaiShared.ts';

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

test('the machine picked: cheapest free one with room for the makers; a size is asked only where the disk can change', () => {
  const row = (o) => ({ gpu_type: 'rtx_a6000', gpu_count: 1, tier: 'on_demand', available: 5, disk_configurable: false, region: 'x', ...o });
  // As GPU.ai listed them on 2026-11-04: the cheapest A6000 has a fixed 100 GB disk (too small), the next 256 GB.
  const list = [
    row({ offering_id: 'ca', price_per_hour: 0.4, instance_disk_gb: 100 }),
    row({ offering_id: 'us', price_per_hour: 0.45, instance_disk_gb: 256 }),
    row({ offering_id: 'gone', price_per_hour: 0.3, instance_disk_gb: 500, available: 0 }),
    row({ offering_id: 'two', price_per_hour: 0.2, instance_disk_gb: 500, gpu_count: 2 }),
    row({ gpu_type: 'rtx_pro_6000', offering_id: 'flex', price_per_hour: 2.49, instance_disk_gb: 100, disk_configurable: true }),
  ];
  assert.deepEqual(pickOffering(list, 'rtx_a6000'), { offering: list[1], diskGb: null });
  assert.deepEqual(pickOffering(list, 'rtx_pro_6000'), { offering: list[4], diskGb: DISK_GB });
  assert.equal(pickOffering(list, 'l40'), null);
  assert.equal(pickOffering([row({ offering_id: 'small', price_per_hour: 0.4, instance_disk_gb: 100 })], 'rtx_a6000'), null);
  // GPU.ai's own words for the refusal seen that day: try the next GPU.
  assert.ok(nextGpuAfterFailedOperation('The selected machine cannot be configured with a custom disk size — pick another machine or launch with the default disk.'));
  assert.ok(!nextGpuAfterFailedOperation('env key GPUAI_X is reserved'));
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

test('what to load first: maker ids only, in the order picked, no repeats; your makers are the starting list and what you added', () => {
  assert.deepEqual(cleanPicks(['h3-max', 'qwen', 'h3-max', 'Bad Id', 7, '../x', 'anime']), ['h3-max', 'qwen', 'anime']);
  assert.deepEqual(cleanPicks('qwen'), []);
  assert.equal(cleanPicks(Array.from({ length: 30 }, (_, i) => `m${i}`)).length, 20);
  assert.deepEqual(libraryOf(ONLY_MAKERS, { wanted: ['anime', 'qwen'] }), ['qwen', 'edit', 'h3-max', 'anime']);
  assert.deepEqual(libraryOf(ONLY_MAKERS, null), ['qwen', 'edit', 'h3-max']);
});

test('every GPU to choose from: the cheapest machine of each type with room, what it can do, cheapest first', async () => {
  const { gpuOptions, cleanGpu } = await import('../../lib/gpuaiShared.ts');
  const o = (gpu_type, price_per_hour, extra = {}) => ({ gpu_type, gpu_count: 1, tier: 'on_demand', price_per_hour, available: 3, instance_disk_gb: 625, disk_configurable: false, offering_id: `${gpu_type}-${price_per_hour}`, region: 'us-central', ...extra });
  const list = [
    o('l40s', 0.8),
    o('a100_80gb', 1.07, { instance_disk_gb: 100 }), // fixed 100 GB: too small, the next one is picked
    o('a100_80gb', 1.23, { instance_disk_gb: 768 }),
    o('h200_nvl', 3.29, { instance_disk_gb: 750, region: 'us-east' }),
    o('h100_sxm', 3.99, { instance_disk_gb: 100, disk_configurable: true }),
    o('rtx_4000_ada', 0.28, { instance_disk_gb: 100, disk_configurable: true }),
    o('mi300x', 1.5),
    o('h100_pcie', 2.48, { available: 0 }),
    { ...o('l40', 1.56), gpu_count: 2 },
  ];
  const ai = gpuOptions(list, 'ai');
  assert.deepEqual(ai.options.map((x) => [x.gpu, x.pricePerHour, x.fits]), [
    ['rtx_4000_ada', 0.28, 'no'],
    ['l40s', 0.8, 'yes'],
    ['a100_80gb', 1.23, 'yes'],
    ['h200_nvl', 3.29, 'yes'],
    ['h100_sxm', 3.99, 'yes'],
  ]);
  assert.equal(ai.recommended, 'l40s', 'the cheapest that does everything');
  assert.equal(ai.options[1].name, 'L40S');
  assert.equal(ai.options[1].memoryGb, 48);
  assert.ok(ai.options[3].videoMinutes < ai.options[1].videoMinutes, 'faster GPUs make a video sooner');
  // The drawing machine needs H100-class for Bring to life: the cheapest such one is suggested.
  const draw = gpuOptions(list, 'canvas');
  assert.equal(draw.recommended, 'h200_nvl');
  assert.equal(draw.options.find((x) => x.gpu === 'l40s').fits, 'some');
  assert.equal(cleanGpu('h200_nvl'), 'h200_nvl');
  assert.equal(cleanGpu('H200; rm'), null);
});
