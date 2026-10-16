// Machine-level helpers for the AI machine: Ollama calls, default-model downloads, idle shutdown.

export async function ollamaJson(base, path, init) {
  const res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`ollama ${path} ${res.status}`);
  return res.json();
}

/**
 * Makes sure the default models are downloaded (on the machine's storage, so this happens once).
 * Downloads run one at a time; progress is visible in /_orbit/status.
 */
export function createModelKeeper({ ollama, wanted, retryMs = 60_000, fetchImpl = fetch }) {
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

  async function pull(model) {
    current = { model, completed: 0, total: 0, status: 'starting' };
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
        current = {
          model,
          status: msg.status || current.status,
          completed: msg.completed ?? current.completed,
          total: msg.total ?? current.total,
        };
      }
    }
  }

  async function loop() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        let missing;
        try {
          const names = await have();
          missing = wanted.filter((m) => !names.has(m));
        } catch {
          await new Promise((r) => setTimeout(r, 3000)); // Ollama still starting
          continue;
        }
        if (!missing.length) break;
        try {
          await pull(missing[0]);
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
 * Stops the machine after `limitMinutes` without use. "Use" = activity reported by the gate
 * (chat requests, page loads that change something, API calls) or busy() saying a model is loaded /
 * a download is running. Never stops sooner than limitMinutes after boot.
 */
export function createIdleWatch({ limitMinutes, busy, stop, log = console, now = Date.now, everyMs = 60_000 }) {
  let last = now();
  let stopping = null; // last stop attempt result
  let timer = null;
  const limitMs = limitMinutes * 60_000;

  async function check() {
    if (!(limitMinutes > 0)) return;
    if (await busy().catch(() => false)) last = now();
    if (now() - last < limitMs) return;
    log.info?.(`[gate] idle for ${limitMinutes} min, stopping the machine`);
    try {
      await stop();
      stopping = { ok: true, at: new Date(now()).toISOString() };
    } catch (err) {
      stopping = { ok: false, at: new Date(now()).toISOString(), error: err.message };
      log.warn?.(`[gate] could not stop the machine: ${err.message}`);
      last = now(); // try again after another idle period rather than every minute
    }
  }

  return {
    touch: () => (last = now()),
    check,
    start: () => {
      timer = setInterval(() => void check(), everyMs);
      timer.unref?.();
    },
    state: () => ({
      limitMinutes,
      idleMinutes: Math.floor((now() - last) / 60_000),
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
