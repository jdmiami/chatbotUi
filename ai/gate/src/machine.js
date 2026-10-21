// Machine-level helpers for the AI machine: Ollama calls and default-model downloads.

export async function ollamaJson(base, path, init) {
  const res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`ollama ${path} ${res.status}`);
  return res.json();
}

/**
 * One default model. Either an Ollama library name ("qwen3.8:27b"), or a friendly name for a model
 * from elsewhere with its own settings:
 *   "qwen3.8-obliterated:27b=hf.co/OBLITERATUS/Qwen3.8-27B-OBLITERATED:Q6_K|like=qwen3.8:27b|temperature=0"
 * like= borrows the chat format of a library model of the same family. Downloaded files come with a
 * plain format that can't use tools (web search, code), so Open WebUI would refuse them.
 */
export function parseModelSpec(spec) {
  const [main, ...opts] = spec.split('|').map((s) => s.trim());
  const eq = main.indexOf('=');
  const name = eq > 0 ? main.slice(0, eq).trim() : main;
  const source = eq > 0 ? main.slice(eq + 1).trim() : main;
  const parameters = {};
  let like;
  for (const o of opts) {
    const i = o.indexOf('=');
    if (i <= 0) continue;
    const key = o.slice(0, i).trim();
    const v = o.slice(i + 1).trim();
    if (key === 'like') like = v;
    else parameters[key] = v !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
  }
  return like ? { name, source, parameters, like } : { name, source, parameters };
}

/** Download a model into Ollama, reporting { status, completed, total } as it goes. */
export async function pullModel({ ollama, model, onProgress = () => {}, fetchImpl = fetch }) {
  let cur = { status: 'starting', completed: 0, total: 0 };
  onProgress(cur);
  const res = await fetchImpl(`${ollama}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`pull ${model}: ${res.status}`);
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.error) throw new Error(`pull ${model}: ${msg.error}`);
      cur = { status: msg.status || cur.status, completed: msg.completed ?? cur.completed, total: msg.total ?? cur.total };
      onProgress(cur);
    }
  }
}

// The chat format (template, renderer, parser) of a library model, for like=.
async function chatFormat({ ollama, model, fetchImpl }) {
  const res = await fetchImpl(`${ollama}/api/show`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) throw new Error(`show ${model}: ${res.status}`);
  const d = await res.json();
  const line = (k) => (d.modelfile || '').match(new RegExp(`^${k} (\\S+)`, 'm'))?.[1];
  const format = {};
  if (d.template) format.template = d.template;
  if (line('RENDERER')) format.renderer = line('RENDERER');
  if (line('PARSER')) format.parser = line('PARSER');
  return format;
}

/**
 * Install one model spec (see parseModelSpec). A model from elsewhere gets its friendly name and
 * settings, then the long source name is removed from the list (the files stay, the friendly name
 * uses them). onProgress({ model, status, completed, total }).
 */
export async function installModel({ ollama, spec, onProgress = () => {}, fetchImpl = fetch }) {
  const { name, source, parameters, like } = typeof spec === 'string' ? parseModelSpec(spec) : spec;
  const report = (model) => (p) => onProgress({ model, ...p });
  if (like) await pullModel({ ollama, model: like, onProgress: report(like), fetchImpl }); // no-op when it's already there
  await pullModel({ ollama, model: source, onProgress: report(name), fetchImpl });
  if (source === name && !Object.keys(parameters || {}).length) return;
  onProgress({ model: name, status: 'setting up', completed: 0, total: 0 });
  const format = like ? await chatFormat({ ollama, model: like, fetchImpl }) : {};
  const res = await fetchImpl(`${ollama}/api/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: name, from: source, ...format, parameters, stream: false }),
  });
  if (!res.ok) throw new Error(`create ${name}: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  if (source !== name) {
    await fetchImpl(`${ollama}/api/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: source }),
    }).catch(() => {});
  }
}

/**
 * Makes sure the default models are downloaded (on the machine's storage, so this happens once).
 * Downloads run one at a time; progress is visible in /_orbit/status.
 */
export function createModelKeeper({ ollama, wanted: specs, retryMs = 60_000, fetchImpl = fetch, restore = null, saved = async () => {} }) {
  const wantedModels = specs.map(parseModelSpec);
  const wanted = wantedModels.map((m) => m.name);
  let current = null; // { model, completed, total, status }
  let running = false;

  async function have() {
    const res = await fetchImpl(`${ollama}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`tags ${res.status}`);
    const body = await res.json();
    const names = new Set();
    for (const m of body.models || []) {
      names.add(m.name);
      if (m.name.endsWith(':latest')) names.add(m.name.slice(0, -7));
    }
    return names;
  }

  const install = (spec) => installModel({ ollama, spec, fetchImpl, onProgress: (p) => (current = p) });

  async function loop() {
    if (running) return;
    running = true;
    try {
      // Models kept in R2 come back first, so they aren't downloaded from their home sites again.
      if (restore) {
        current = { model: 'your saved models', status: 'bringing back', completed: 0, total: 0 };
        await restore((p) => (current = { ...current, ...p })).catch((err) => console.warn(`[gate] could not bring models back from R2: ${err.message}`));
        current = null;
      }
      for (;;) {
        let missing;
        try {
          const names = await have();
          missing = wantedModels.filter((m) => !names.has(m.name));
        } catch {
          await new Promise((r) => setTimeout(r, 3000)); // Ollama still starting
          continue;
        }
        if (!missing.length) break;
        try {
          await install(missing[0]);
          await saved().catch((err) => console.warn(`[gate] could not keep ${missing[0].name} in R2: ${err.message}`));
        } catch (err) {
          console.warn(`[gate] ${err.message}; retrying in ${Math.round(retryMs / 1000)}s`);
          current = null;
          await new Promise((r) => setTimeout(r, retryMs));
        }
      }
    } finally {
      current = null;
      running = false;
    }
  }

  return {
    wanted,
    start: () => void loop(),
    pulling: () => current !== null,
    progress: () =>
      current && {
        model: current.model,
        status: current.status,
        percent: current.total ? Math.floor((current.completed / current.total) * 100) : 0,
      },
  };
}

// The auto-off timer and stopping this pod live in shared/autooff.js (the same code on every machine).
