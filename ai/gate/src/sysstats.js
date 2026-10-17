// Live machine stats for the status panel ("task manager"): CPU, memory, disk, network and the
// busiest processes, read from /proc and the container's cgroup. Rates (CPU %, network speed) are
// measured between two calls, so the first call reports them as null.
//
// The same file is used by the AI machine's gate (ai/gate) and the Linux machine's gateway
// (gateway/src). Keep the two copies identical.
import fs from 'node:fs/promises';
import os from 'node:os';

const read = (p) => fs.readFile(p, 'utf8').catch(() => null);
const num = (s) => (s == null || s === 'max' ? null : Number(String(s).trim()));

/** Friendly names for well-known processes (anything else shows its command name). */
const FRIENDLY = [
  [/ollama.*runner|ollama_llama_server/, 'AI chat model'],
  [/(^|\/)ollama( |$)/, 'Ollama (model server)'],
  [/ComfyUI|main\.py.*--listen 127\.0\.0\.1 --port 8188/, 'Image & video maker'],
  [/open_webui|open-webui|uvicorn/, 'AI playground (Open WebUI)'],
  [/code-server/, 'VS Code (code-server)'],
  [/\bagy\b|antigravity/, 'Antigravity agent'],
  [/Xvnc|xrdp|Xorg/, 'Desktop display'],
  [/xfce|xfwm|thunar/, 'Desktop (XFCE)'],
  [/guacd/, 'Remote desktop relay'],
  [/tmux/, 'Terminal sessions (tmux)'],
  [/node .*src\/index\.js/, 'Gateway'],
];

export function friendlyName(cmd, comm) {
  for (const [re, name] of FRIENDLY) if (re.test(cmd)) return name;
  return comm || cmd.split(/\s+/)[0]?.split('/').pop() || '?';
}

export function createSysStats({ volume = '/workspace', procRoot = '/proc', cgroupRoot = '/sys/fs/cgroup', now = Date.now } = {}) {
  let prev = null; // { t, cpuUsec, procs: Map<pid, ticks>, net: { rx, tx } }
  const hz = 100; // USER_HZ on Linux

  async function cpuUsage() {
    // cgroup v2 first (what the container is allowed), else the whole machine from /proc/stat.
    const stat = await read(`${cgroupRoot}/cpu.stat`);
    const m = stat && /usage_usec (\d+)/.exec(stat);
    const max = await read(`${cgroupRoot}/cpu.max`);
    let cores = os.cpus().length;
    if (max) {
      const [quota, period] = max.trim().split(/\s+/);
      if (quota !== 'max' && Number(period) > 0) cores = Math.max(0.1, Number(quota) / Number(period));
    }
    if (m) return { usec: Number(m[1]), cores };
    const s = await read(`${procRoot}/stat`);
    const parts = s?.split('\n')[0].trim().split(/\s+/).slice(1).map(Number) ?? [];
    const busy = parts.reduce((a, b) => a + b, 0) - (parts[3] ?? 0) - (parts[4] ?? 0);
    return { usec: (busy / hz) * 1e6, cores: os.cpus().length };
  }

  async function memory() {
    const used = num(await read(`${cgroupRoot}/memory.current`));
    const limit = num(await read(`${cgroupRoot}/memory.max`));
    if (used != null) {
      // Page cache counts as "used" in memory.current; subtract what the kernel can drop.
      const stat = (await read(`${cgroupRoot}/memory.stat`)) || '';
      const file = Number(/(?:^|\n)inactive_file (\d+)/.exec(stat)?.[1] ?? 0);
      return { used: Math.max(0, used - file), total: limit && limit < os.totalmem() * 4 ? limit : os.totalmem() };
    }
    return { used: os.totalmem() - os.freemem(), total: os.totalmem() };
  }

  async function disks() {
    const out = [];
    for (const [label, p] of [
      ['Saved storage', volume],
      ['System disk', '/'],
    ]) {
      try {
        const s = await fs.statfs(p);
        const total = s.blocks * s.bsize;
        // A shared network filesystem reports the whole cluster (hundreds of TB): that says nothing about yours.
        if (total > 0 && total < 20e12 && !out.some((d) => d.total === total && d.free === s.bavail * s.bsize)) out.push({ label, path: p, total, free: s.bavail * s.bsize });
      } catch {
        /* not mounted here */
      }
    }
    return out;
  }

  async function network() {
    const s = await read(`${procRoot}/net/dev`);
    let rx = 0;
    let tx = 0;
    for (const line of s?.split('\n').slice(2) ?? []) {
      const [name, rest] = line.split(':');
      if (!rest || name.trim() === 'lo') continue;
      const f = rest.trim().split(/\s+/).map(Number);
      rx += f[0] || 0;
      tx += f[8] || 0;
    }
    return { rx, tx };
  }

  async function processes() {
    const out = [];
    const ids = (await fs.readdir(procRoot).catch(() => [])).filter((d) => /^\d+$/.test(d));
    const page = 4096;
    await Promise.all(
      ids.map(async (pid) => {
        const [stat, cmd, statm] = await Promise.all([read(`${procRoot}/${pid}/stat`), read(`${procRoot}/${pid}/cmdline`), read(`${procRoot}/${pid}/statm`)]);
        if (!stat) return;
        const close = stat.lastIndexOf(')');
        const comm = stat.slice(stat.indexOf('(') + 1, close);
        const f = stat.slice(close + 2).split(' ');
        const ticks = Number(f[11]) + Number(f[12]);
        const rss = Number(statm?.split(' ')[1] ?? 0) * page;
        out.push({ pid: Number(pid), comm, cmd: (cmd || '').replace(/\0/g, ' ').trim() || comm, ticks, rss });
      }),
    );
    return out;
  }

  /** One reading. `top` = how many processes to list. */
  async function collect({ top = 8 } = {}) {
    const t = now();
    const [cpu, mem, disk, net, procs] = await Promise.all([cpuUsage(), memory(), disks(), network(), processes()]);
    const dt = prev ? (t - prev.t) / 1000 : 0;
    const cpuPct = prev && dt > 0 ? Math.min(100, Math.max(0, ((cpu.usec - prev.cpuUsec) / 1e6 / dt / cpu.cores) * 100)) : null;
    const ticks = new Map(procs.map((p) => [p.pid, p.ticks]));
    // Group processes by friendly name so "AI chat model" isn't six lines.
    const groups = new Map();
    for (const p of procs) {
      const name = friendlyName(p.cmd, p.comm);
      const before = prev?.procs.get(p.pid);
      const cpuP = prev && dt > 0 && before != null ? ((p.ticks - before) / hz / dt / cpu.cores) * 100 : null;
      const g = groups.get(name) ?? { name, cpu: prev ? 0 : null, memory: 0, count: 0 };
      if (cpuP != null) g.cpu = (g.cpu ?? 0) + Math.max(0, cpuP);
      g.memory += p.rss;
      g.count += 1;
      groups.set(name, g);
    }
    const list = [...groups.values()]
      .filter((g) => g.memory > 8 * 1024 * 1024 || (g.cpu ?? 0) > 0.5)
      .sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0) || b.memory - a.memory)
      .slice(0, top)
      .map((g) => ({ ...g, cpu: g.cpu == null ? null : Math.round(g.cpu * 10) / 10 }));
    const rates = prev && dt > 0 ? { rx: Math.max(0, (net.rx - prev.net.rx) / dt), tx: Math.max(0, (net.tx - prev.net.tx) / dt) } : { rx: null, tx: null };
    prev = { t, cpuUsec: cpu.usec, procs: ticks, net };
    return {
      at: new Date(t).toISOString(),
      cpu: { percent: cpuPct == null ? null : Math.round(cpuPct * 10) / 10, cores: Math.round(cpu.cores * 10) / 10 },
      memory: mem,
      disks: disk,
      network: { rxPerSec: rates.rx, txPerSec: rates.tx },
      processes: list,
    };
  }

  return { collect };
}
