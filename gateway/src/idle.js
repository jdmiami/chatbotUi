// The Linux machine turns itself off after an hour without touch, mouse or keyboard input
// (in the desktop, the terminal, Orbit or VS Code) while no Antigravity turn is running.
// An open page or a live connection is not input: only what a person does counts.

/**
 * @param {object} o
 *   limitMinutes   minutes without input before stopping (0 = never)
 *   busy()         true while a job runs (an Antigravity turn); counts at most `maxBusyMinutes`
 *                  past the last input, so a turn that never ends can't keep the machine on
 *   stop()         async: stops this pod
 */
export function createInputWatch({ limitMinutes, busy = () => false, stop, log = console, now = Date.now, everyMs = 60_000, maxBusyMinutes = 180, retryMinutes = 2 }) {
  let last = now(); // last input (or boot)
  let lastBusy = 0;
  let retryAt = 0;
  let stopping = null;
  let timer = null;
  const limitMs = limitMinutes * 60_000;
  const busyCounts = () => now() - last < maxBusyMinutes * 60_000;
  const idleSince = () => (busyCounts() ? Math.max(last, lastBusy) : last);

  async function check() {
    if (!(limitMinutes > 0)) return;
    if (await Promise.resolve(busy()).catch(() => false)) {
      if (busyCounts()) lastBusy = now();
      else log.warn?.(`[idle] a job has run for over ${maxBusyMinutes} min with no input; ignoring it`);
    }
    const t = now();
    if (t - idleSince() < limitMs || t < retryAt) return;
    log.info?.(`[idle] no input for ${limitMinutes} min, stopping the machine`);
    try {
      await stop();
      stopping = { ok: true, at: new Date(t).toISOString() };
    } catch (err) {
      stopping = { ok: false, at: new Date(t).toISOString(), error: err.message };
      log.warn?.(`[idle] could not stop the machine: ${err.message}; trying again in ${retryMinutes} min`);
      retryAt = t + retryMinutes * 60_000;
    }
  }

  return {
    input: () => (last = now()),
    check,
    start: () => {
      timer = setInterval(() => void check(), everyMs);
      timer.unref?.();
    },
    stopTimer: () => clearInterval(timer),
    state: () => ({
      limitMinutes,
      idleMinutes: Math.floor((now() - idleSince()) / 60_000),
      offAt: limitMinutes > 0 ? new Date(idleSince() + limitMs).toISOString() : null,
      lastStop: stopping,
    }),
  };
}

/**
 * True while a terminal coding agent (Claude Code) runs as this user, so a long task it works on
 * by itself doesn't count as "nobody here". It still counts only up to `maxBusyMinutes` past the
 * last real input, like an Antigravity turn.
 */
export async function cliAgentRunning({ procDir = '/proc', names = ['claude'], uid = process.getuid?.() } = {}) {
  const { readdir, readFile, stat } = await import('node:fs/promises');
  let entries;
  try { entries = await readdir(procDir); } catch { return false; }
  for (const pid of entries) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const comm = (await readFile(`${procDir}/${pid}/comm`, 'utf8')).trim();
      if (!names.includes(comm)) continue;
      if (uid != null && (await stat(`${procDir}/${pid}`)).uid !== uid) continue;
      return true;
    } catch { /* the process ended while we looked */ }
  }
  return false;
}

/** Guacamole instructions from the browser that are a person's input (not pings or sizes). */
export const GUAC_INPUT = /(?:^|;)\d+\.(?:mouse|key|touch),/;

/** Stop this pod with the key Runpod gives every pod (RUNPOD_API_KEY, scoped to the pod). */
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
  }).catch((err) => ({ ok: false, status: 0, text: async () => err.message }));
  const body = gql.ok ? await gql.json().catch(() => null) : null;
  if (gql.ok && body && !body.errors) return;
  throw new Error(`Runpod refused to stop the pod (REST ${rest.status}, GraphQL ${gql.status}${body?.errors ? `: ${body.errors[0]?.message}` : ''})`);
}
