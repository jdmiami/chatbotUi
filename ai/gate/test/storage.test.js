import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorageReport, r2MonthlyCost } from '../src/storage.js';

const GB = 1024 ** 3;

test('storage: R2 grouped by what it is for, each item its size (biggest first), the monthly cost', async () => {
  let lists = 0;
  const r2 = {
    async list(prefix) {
      lists++;
      assert.equal(prefix, '');
      return [
        { key: 'gallery/a.png', size: 2_000_000 },
        { key: 'gallery/orbit/a.json', size: 500 },
        { key: 'gallery/b.mp4', size: 9_000_000 },
        { key: 'gallery/orbit/b.json', size: 700 },
        { key: 'models/zimage/model.safetensors', size: 12 * GB },
        { key: 'ollama/blobs/sha256-1', size: 4 * GB },
        { key: 'state/makers.json', size: 300 },
        { key: 'linux/home.tar', size: 2 * GB },
        { key: 'odd/thing', size: 10 },
      ];
    },
  };
  let t = 1000;
  const report = createStorageReport({
    r2,
    items: async () => [{ id: 'a', file: 'a.png' }, { id: 'b', file: 'b.mp4' }, { id: 'gone', file: 'gone.png' }],
    disks: async () => [{ label: 'System disk', path: '/', total: 100, free: 40 }],
    now: () => t,
  });
  const r = await report.get();
  assert.deepEqual(r.disks, [{ label: 'System disk', path: '/', total: 100, free: 40 }]);
  const byId = Object.fromEntries(r.cloud.folders.map((f) => [f.id, f]));
  assert.equal(byId.gallery.bytes, 11_001_200);
  assert.equal(byId.gallery.files, 4);
  assert.equal(byId.makers.bytes, 12 * GB);
  assert.equal(byId.chat.bytes, 4 * GB);
  assert.equal(byId.state.files, 1);
  assert.equal(byId.linux.bytes, 2 * GB, 'the Linux machine\'s home has its own row');
  assert.equal(byId.other.bytes, 10);
  assert.equal(r.cloud.files, 9);
  // 18 GB and a bit: 8 GB over the free 10 GB at $0.015.
  assert.ok(Math.abs(r.cloud.costPerMonth - 0.12) < 0.001);
  assert.deepEqual(r.items, [{ id: 'b', bytes: 9_000_700 }, { id: 'a', bytes: 2_000_500 }]);

  // Kept a few minutes; a delete (or ?fresh) lists again.
  await report.get();
  assert.equal(lists, 1);
  report.forget();
  await report.get();
  assert.equal(lists, 2);
  t += 6 * 60_000;
  await report.get();
  assert.equal(lists, 3);
  await report.get({ fresh: true });
  assert.equal(lists, 4);
});

test('storage: without R2 only the disks', async () => {
  const r = await createStorageReport({ r2: null, items: async () => [], disks: async () => [{ label: 'Saved storage', total: 1, free: 1 }] }).get();
  assert.equal(r.cloud, null);
  assert.deepEqual(r.items, []);
  assert.equal(r2MonthlyCost(5 * GB), 0);
});
