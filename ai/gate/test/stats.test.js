import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSysStats, friendlyName } from '../src/sysstats.js';
import { createGpuStats, parseGpus } from '../src/gpustats.js';

async function fakeProc(dir, { usage, ticks, rx, tx }) {
  const proc = path.join(dir, 'proc');
  const cg = path.join(dir, 'cg');
  await fs.mkdir(path.join(proc, '101'), { recursive: true });
  await fs.mkdir(path.join(proc, '202'), { recursive: true });
  await fs.mkdir(path.join(proc, 'net'), { recursive: true });
  await fs.mkdir(cg, { recursive: true });
  await fs.writeFile(path.join(cg, 'cpu.stat'), `usage_usec ${usage}\n`);
  await fs.writeFile(path.join(cg, 'cpu.max'), '400000 100000\n');
  await fs.writeFile(path.join(cg, 'memory.current'), String(6e9));
  await fs.writeFile(path.join(cg, 'memory.max'), String(16e9));
  await fs.writeFile(path.join(cg, 'memory.stat'), 'anon 1\ninactive_file 1000000000\n');
  const stat = (comm, t) => `1 (${comm}) S 0 0 0 0 0 0 0 0 0 0 ${t} 0 0 0 20 0 1 0 0 0 0`;
  await fs.writeFile(path.join(proc, '101', 'stat'), stat('ollama', ticks));
  await fs.writeFile(path.join(proc, '101', 'cmdline'), '/usr/bin/ollama\0runner\0--model\0x');
  await fs.writeFile(path.join(proc, '101', 'statm'), '0 262144 0');
  await fs.writeFile(path.join(proc, '202', 'stat'), stat('python3', 0));
  await fs.writeFile(path.join(proc, '202', 'cmdline'), 'python3\0main.py\0--listen 127.0.0.1 --port 8188');
  await fs.writeFile(path.join(proc, '202', 'statm'), '0 524288 0');
  await fs.writeFile(path.join(proc, 'net', 'dev'), `h\nh\n  lo: 999 0 0 0 0 0 0 0 999 0\n eth0: ${rx} 0 0 0 0 0 0 0 ${tx} 0\n`);
  return { procRoot: proc, cgroupRoot: cg };
}

test('system stats: CPU and network rates between readings, container memory, grouped processes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stats-'));
  let t = 1_000_000;
  const roots = await fakeProc(dir, { usage: 0, ticks: 0, rx: 0, tx: 0 });
  const s = createSysStats({ ...roots, volume: dir, now: () => t });
  const first = await s.collect();
  assert.equal(first.cpu.percent, null, 'no rate on the first reading');
  assert.equal(first.cpu.cores, 4);
  assert.deepEqual(first.memory, { used: 5e9, total: 16e9 });
  // 2 seconds later: 4 cores, 4 s of CPU used => 50%; ollama used 200 ticks = 2 s => 25%.
  t += 2000;
  await fakeProc(dir, { usage: 4e6, ticks: 200, rx: 2e6, tx: 1e6 });
  const second = await s.collect();
  assert.equal(second.cpu.percent, 50);
  assert.deepEqual(second.network, { rxPerSec: 1e6, txPerSec: 5e5 });
  const chat = second.processes.find((p) => p.name === 'AI chat model');
  assert.equal(chat.cpu, 25);
  assert.equal(chat.memory, 262144 * 4096);
  assert.ok(second.processes.find((p) => p.name === 'Image & video maker'));
  assert.ok(second.disks.length >= 1);
});

test('friendly names for known processes', () => {
  assert.equal(friendlyName('/usr/lib/code-server/lib/node /usr/lib/code-server', 'node'), 'VS Code (code-server)');
  assert.equal(friendlyName('/bin/bash', 'bash'), 'bash');
});

test('GPU stats: card readings, and what is in GPU memory', async () => {
  assert.deepEqual(parseGpus('NVIDIA A40, 37, 23000, 46068, 51, 120.5\n'), [
    { name: 'NVIDIA A40', percent: 37, memoryUsed: 23000 * 1048576, memoryTotal: 46068 * 1048576, temperature: 51, watts: 120.5 },
  ]);
  const collect = createGpuStats({
    ollama: 'http://o',
    comfy: 'http://c',
    exec: (cmd, args, opts, cb) => cb(null, 'NVIDIA A40, 5, 100, 46068, [N/A], [Not Supported]\n'),
    fetchImpl: async (url) =>
      Response.json(
        url.startsWith('http://o')
          ? { models: [{ name: 'qwen3.8:27b', size_vram: 20e9, expires_at: '2030-01-01T00:00:00Z' }] }
          : { devices: [{ torch_vram_total: 3e9 }] },
      ),
  });
  const r = await collect();
  assert.equal(r.gpus[0].temperature, null);
  assert.deepEqual(r.users.map((u) => [u.label, u.memory]), [
    ['Chat model: qwen3.8:27b', 20e9],
    ['Image & video maker', 3e9],
  ]);
});
