// The GPU and what is using it, for the status panel: nvidia-smi for the card, Ollama for the chat
// model in memory, ComfyUI for the image/video maker.
import { execFile } from 'node:child_process';

function run(cmd, args, exec = execFile) {
  return new Promise((resolve) => {
    exec(cmd, args, { timeout: 4000 }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

const MiB = 1024 * 1024;

export function parseGpus(csv) {
  return (csv || '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, util, used, total, temp, power] = line.split(',').map((s) => s.trim());
      const n = (v) => (v === undefined || v === '' || /N\/A|Not Supported/i.test(v) ? null : Number(v));
      return { name, percent: n(util), memoryUsed: (n(used) ?? 0) * MiB, memoryTotal: (n(total) ?? 0) * MiB, temperature: n(temp), watts: n(power) };
    });
}

export function createGpuStats({ ollama, comfy, exec = execFile, fetchImpl = fetch }) {
  async function json(url) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(3000) });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  return async function collect() {
    const [csv, ps, comfyStats] = await Promise.all([
      run('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw', '--format=csv,noheader,nounits'], exec),
      json(`${ollama}/api/ps`),
      comfy ? json(`${comfy}/system_stats`) : null,
    ]);
    // What sits in GPU memory, by who put it there.
    const users = [];
    for (const m of ps?.models ?? []) {
      users.push({ kind: 'model', name: m.name, label: `Chat model: ${m.name}`, memory: m.size_vram ?? m.size ?? 0, until: m.expires_at ?? null });
    }
    const dev = comfyStats?.devices?.[0];
    if (dev && dev.torch_vram_total > 0) users.push({ kind: 'studio', name: 'studio', label: 'Image & video maker', memory: dev.torch_vram_total });
    return { gpus: parseGpus(csv), users };
  };
}
