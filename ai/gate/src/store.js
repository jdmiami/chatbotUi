// Model store for the AI machine: what chat models are installed (with size and abilities), a
// featured shelf, search across Hugging Face's GGUF models, and install / delete / load. Models
// live on the network volume; only the one in use is in GPU memory.
import fs from 'node:fs/promises';
import { installModel, parseModelSpec } from './machine.js';

/** Hand-checked chat models that fit a 48 GB GPU. `spec` uses parseModelSpec's format. */
export const FEATURED = [
  {
    spec: 'qwen3.8:27b',
    title: 'Qwen 3.8 27B',
    blurb: 'Best all-rounder. Sees images, uses tools, thinks step by step.',
    tags: ['general', 'vision', 'tools'],
    size: 17.7e9,
  },
  {
    spec: 'qwen3.6:35b',
    title: 'Qwen 3.6 35B (coder)',
    blurb: 'Fast mixture-of-experts model, strongest for code and agents.',
    tags: ['coding', 'tools', 'fast'],
    size: 22.6e9,
  },
  {
    spec: 'qwen3.8-obliterated:27b=hf.co/OBLITERATUS/Qwen3.8-27B-OBLITERATED:Q6_K|like=qwen3.8:27b|temperature=0|repeat_penalty=1.15',
    title: 'Qwen 3.8 27B OBLITERATED',
    blurb: 'Uncensored (refusals removed) Qwen 3.8, high-quality 6-bit.',
    tags: ['uncensored', 'tools'],
    size: 23.4e9,
  },
  {
    spec: 'qwen3.8-abliterated:27b=hf.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF:UD-Q4_K_XL|like=qwen3.8:27b',
    title: 'Qwen 3.8 27B abliterated (huihui)',
    blurb: 'Popular uncensored Qwen 3.8 that keeps image understanding. Smaller 4-bit.',
    tags: ['uncensored', 'vision'],
    size: 18.3e9,
  },
  {
    spec: 'defiant-fable:9b=hf.co/DavidAU/Qwen3.5-9B-The-Defiant-Fable-Uncensored-Heretic-NEO-IMATRIX-MAX-MTP-GGUF:NEO-MAX-Q6_K',
    title: 'Defiant Fable 9B',
    blurb: 'Small, very fast uncensored storyteller. Good for role-play and quick chats.',
    tags: ['uncensored', 'fast', 'creative'],
    size: 9.5e9,
  },
];

const nameOf = (spec) => parseModelSpec(spec).name;
const HF = 'https://huggingface.co';
const QUANT = /[-_.]((?:UD-)?(?:I?Q\d(?:_[A-Z0-9]+)*|BF16|F16|F32))\.gguf$/i;

/**
 * @param {object} o  ollama (URL), volume (path for free-space), fetchImpl, statfs (tests)
 */
export function createModelStore(o) {
  const ollama = o.ollama;
  const f = o.fetchImpl || fetch;
  const statfs = o.statfs || ((p) => fs.statfs(p));
  const pulls = new Map(); // name -> { status, percent, error, done }
  const caps = new Map(); // digest -> { vision, tools, thinking, family, params, quant }

  const json = async (p, init = {}) => {
    const res = await f(`${ollama}${p}`, { ...init, headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(init.timeout ?? 10_000) });
    if (!res.ok) throw Object.assign(new Error(`${p}: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`), { status: res.status });
    return res.json();
  };

  async function details(m) {
    if (caps.has(m.digest)) return caps.get(m.digest);
    const d = await json('/api/show', { method: 'POST', body: JSON.stringify({ model: m.name }) }).catch(() => ({}));
    const c = d.capabilities || [];
    const info = {
      vision: c.includes('vision'),
      tools: c.includes('tools'),
      thinking: c.includes('thinking'),
      family: d.details?.family || m.details?.family || '',
      params: d.details?.parameter_size || m.details?.parameter_size || '',
      quant: d.details?.quantization_level || m.details?.quantization_level || '',
    };
    if (m.digest) caps.set(m.digest, info);
    return info;
  }

  async function disk() {
    try {
      const s = await statfs(o.volume || '/workspace');
      return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
    } catch {
      return null;
    }
  }

  async function list() {
    const [tags, ps, space] = await Promise.all([json('/api/tags'), json('/api/ps').catch(() => ({ models: [] })), disk()]);
    const loaded = new Set((ps.models || []).map((m) => m.name));
    const installed = [];
    for (const m of tags.models || []) {
      installed.push({ name: m.name, size: m.size, modifiedAt: m.modified_at, loaded: loaded.has(m.name), ...(await details(m)) });
    }
    installed.sort((a, b) => a.name.localeCompare(b.name));
    return {
      installed,
      pulls: [...pulls].map(([name, p]) => ({ name, ...p })),
      disk: space,
    };
  }

  async function featured() {
    const have = new Set(((await json('/api/tags')).models || []).map((m) => m.name));
    return FEATURED.map((m) => ({ ...m, name: nameOf(m.spec), installed: have.has(nameOf(m.spec)) || have.has(`${nameOf(m.spec)}:latest`) }));
  }

  /** Search Hugging Face for GGUF chat models. */
  async function search(q) {
    const url = `${HF}/api/models?search=${encodeURIComponent(q)}&filter=gguf&sort=downloads&direction=-1&limit=25`;
    const res = await f(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Hugging Face search: ${res.status}`);
    return (await res.json()).map((m) => ({ repo: m.id || m.modelId, downloads: m.downloads ?? 0, likes: m.likes ?? 0, updatedAt: m.lastModified || null }));
  }

  /** The quantizations a GGUF repo offers, with sizes. */
  async function files(repo) {
    if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(repo) || repo.includes('..')) throw Object.assign(new Error('Not a Hugging Face model name'), { status: 400 });
    const res = await f(`${HF}/api/models/${repo}/tree/main?recursive=true`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw Object.assign(new Error(`Hugging Face: ${res.status}`), { status: res.status === 404 ? 404 : 502 });
    // One entry per size: Hugging Face picks the file when a repo has several with the same one.
    const out = new Map();
    for (const e of await res.json()) {
      const m = e.type === 'file' && !/mmproj/i.test(e.path) && QUANT.exec(e.path);
      const quant = m && m[1].toUpperCase();
      if (m && (!out.has(quant) || e.path.length < out.get(quant).file.length)) out.set(quant, { quant, file: e.path, size: e.lfs?.size ?? e.size ?? 0 });
    }
    return [...out.values()].sort((a, b) => a.size - b.size);
  }

  /** Start installing; progress shows in list().pulls. Returns the friendly name. */
  function install({ spec, repo, quant, name }) {
    let s = spec;
    if (!s) {
      if (!repo || !quant) throw Object.assign(new Error('Choose a model and a size'), { status: 400 });
      const friendly = (name || `${repo.split('/')[1].replace(/-?GGUF$/i, '')}:${quant}`).toLowerCase().replace(/[^a-z0-9._:-]+/g, '-');
      s = `${friendly}=hf.co/${repo}:${quant}`;
    }
    const target = nameOf(s);
    if (pulls.get(target)?.status && !pulls.get(target).done) return target;
    pulls.set(target, { status: 'starting', percent: 0, error: null, done: false });
    installModel({
      ollama,
      spec: s,
      fetchImpl: f,
      onProgress: (p) => pulls.set(target, { status: p.status, percent: p.total ? Math.floor((p.completed / p.total) * 100) : 0, error: null, done: false }),
    }).then(
      () => pulls.delete(target),
      (err) => pulls.set(target, { status: 'failed', percent: 0, error: err.message, done: true }),
    );
    return target;
  }

  async function remove(name) {
    const res = await f(`${ollama}/api/delete`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: name }) });
    if (!res.ok) throw Object.assign(new Error(`Could not delete ${name}`), { status: res.status });
    pulls.delete(name);
  }

  /** Load a model into the GPU now (the previous one is unloaded), so the first reply is quick. */
  async function load(name) {
    await json('/api/generate', { method: 'POST', body: JSON.stringify({ model: name, keep_alive: '10m' }), timeout: 300_000 });
  }

  /** Take a model out of GPU memory now (it stays installed). */
  async function unload(name) {
    await json('/api/generate', { method: 'POST', body: JSON.stringify({ model: name, keep_alive: 0 }), timeout: 30_000 });
  }

  return { list, featured, search, files, install, remove, load, unload, dismiss: (name) => pulls.delete(name) };
}
