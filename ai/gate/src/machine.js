// Machine-level helpers for the AI machine: Ollama calls, default-model downloads, idle shutdown.

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
export function createModelKeeper({ ollama, wanted: specs, retryMs = 60_000, fetchImpl = fetch }) {
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

/**
 * Stops the machine after `limitMinutes` without a job. A job = a request for real work reported by
 * the gate (a chat answer, a picture or video, a download) or busy() saying one is still running.
 * Open pages and polling never count. Never stops sooner than limitMinutes after boot.
 *
 * Fail-safes: busy() can't hold the machine on for more than `maxBusyMinutes` without a new request
 * (a job that never finishes), "keep awake" is capped at `maxHoldMinutes`, and a failed stop is
 * retried every `retryMinutes` instead of waiting out another idle period.
 */
export function createIdleWatch({
  limitMinutes,
  busy,
  stop,
  log = console,
  now = Date.now,
  everyMs = 60_000,
  maxBusyMinutes = 180,
  maxHoldMinutes = 120,
  retryMinutes = 2,
}) {
  let last = now(); // last request for work (or boot)
  let lastBusy = 0; // last time busy() said a job was running
  let hold = 0; // "keep awake" until this time, whatever the activity
  let stopping = null; // last stop attempt result
  let retryAt = 0;
  let timer = null;
  const limitMs = limitMinutes * 60_000;
  // Busy only counts while the last real request is recent enough.
  const busyCounts = () => now() - last < maxBusyMinutes * 60_000;
  const idleSince = () => (busyCounts() ? Math.max(last, lastBusy) : last);

  async function check() {
    if (!(limitMinutes > 0)) return;
    if (await busy().catch(() => false)) {
      if (busyCounts()) lastBusy = now();
      else log.warn?.(`[gate] a job has kept the machine busy for over ${maxBusyMinutes} min with no new request; ignoring it`);
    }
    const t = now();
    if (t - idleSince() < limitMs || t < hold || t < retryAt) return;
    log.info?.(`[gate] no job for ${limitMinutes} min, stopping the machine`);
    try {
      await stop();
      stopping = { ok: true, at: new Date(t).toISOString() };
    } catch (err) {
      stopping = { ok: false, at: new Date(t).toISOString(), error: err.message };
      log.warn?.(`[gate] could not stop the machine: ${err.message}; trying again in ${retryMinutes} min`);
      retryAt = t + retryMinutes * 60_000;
    }
  }

  return {
    touch: () => (last = now()),
    /** Push the turn-off time back by `minutes`, never more than `maxHoldMinutes` from now. Returns the new turn-off time. */
    extend: (minutes) => {
      const offAt = Math.max(idleSince() + limitMs, hold, now());
      hold = Math.min(offAt + Math.max(0, Math.min(240, minutes)) * 60_000, now() + maxHoldMinutes * 60_000);
      return hold;
    },
    check,
    start: () => {
      timer = setInterval(() => void check(), everyMs);
      timer.unref?.();
    },
    state: () => ({
      limitMinutes,
      idleMinutes: Math.floor((now() - idleSince()) / 60_000),
      idleSeconds: Math.floor((now() - idleSince()) / 1000),
      // When it will turn itself off if nobody uses it (the check runs every minute).
      offAt: limitMinutes > 0 ? new Date(Math.max(idleSince() + limitMs, hold)).toISOString() : null,
      heldUntil: hold > now() ? new Date(hold).toISOString() : null,
      lastStop: stopping,
    }),
  };
}

/** Stop this pod using the key Runpod gives every pod (RUNPOD_API_KEY, scoped to the pod). */
export async function runpodStopSelf({ podId, apiKey, fetchImpl = fetch }) {
  if (!podId || !apiKey) throw new Error('RUNPOD_POD_ID / RUNPOD_API_KEY not available');
  const headers = { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
  const rest = await fetchImpl(`https://api.runpod.io/v2/pods/${encodeURIComponent(podId)}/action`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'stop' }),
    signal: AbortSignal.timeout(15_000),
  }).catch((err) => ({ ok: false, status: 0, text: async () => err.message }));
  if (rest.ok) return;
  // Older pod keys may only work with the GraphQL API (what runpodctl uses).
  const gql = await fetchImpl('https://api.runpod.io/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: 'mutation($id:String!){podStop(input:{podId:$id}){id desiredStatus}}', variables: { id: podId } }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await gql.json().catch(() => ({}));
  if (!gql.ok || body.errors) {
    throw new Error(`REST ${rest.status}: ${(await rest.text()).slice(0, 120)}; GraphQL ${gql.status}: ${JSON.stringify(body.errors || body).slice(0, 160)}`);
  }
}
