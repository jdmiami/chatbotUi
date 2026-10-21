// The one rule that turns the Runpod machines off (the AI machine, its helper and the Linux machine):
//
//   A machine turns itself off after AUTO_OFF.defaultMinutes (the site's AUTO_OFF_MINUTES, 10–60)
//   without use. "Use" is what each machine counts as a job or input (its caller decides); open
//   pages and polling never count. "Keep on" pushes the time back, never more than maxHoldMinutes
//   from now. The site's watchdog (lib/watchdog.ts) turns off any machine that is still on
//   graceMinutes after that, or that has been on blindMinutes without saying how idle it is.
//
// Plain ESM with no dependencies: the site (lib/autoOff.ts), Orbit, the AI machine's gate
// (ai/gate/src) and the Linux machine's gateway (gateway/src) all import this file. The machines
// download it next to their own code (ai/setup.sh, linux/pod-setup.sh).

export const AUTO_OFF = Object.freeze({
  /** Minutes without use before a machine turns itself off, unless AUTO_OFF_MINUTES says otherwise. */
  defaultMinutes: 60,
  /** AUTO_OFF_MINUTES is kept within these (never longer than an hour: this is the money fail-safe). */
  minMinutes: 10,
  maxMinutes: 60,
  /** The "turning off soon" notice comes this long before. */
  warnMinutes: 10,
  /** One "Keep on" tap adds this much. */
  keepOnMinutes: 30,
  /** "Keep on" never holds a machine on longer than this from now. */
  maxHoldMinutes: 120,
  /** The watchdog waits this long past the limit for the machine's own timer. */
  graceMinutes: 5,
  /** The watchdog turns off a machine that has been on this long without saying how idle it is. */
  blindMinutes: 90,
  /** A job that never ends stops counting this long after the last real use. */
  maxBusyMinutes: 180,
  /** A failed stop is tried again this soon. */
  retryMinutes: 2,
});

/** The auto-off minutes from a setting: a whole number of minutes from 10 to 60; anything else (or 0) gives 60. */
export function clampAutoOffMinutes(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return AUTO_OFF.defaultMinutes;
  return Math.min(AUTO_OFF.maxMinutes, Math.max(AUTO_OFF.minMinutes, n));
}

/** The words every screen uses for the rule. */
export function autoOffSentence(minutes = AUTO_OFF.defaultMinutes) {
  return `Turns itself off after ${minutes} minutes unused.`;
}

/**
 * The timer itself. Stops the machine after `limitMinutes` without use.
 *
 *   activity()        call on every real use (a job, a tap, a key)
 *   busy()            sync or async: true while a job still runs; it counts at most `maxBusyMinutes`
 *                     past the last activity, so a job that never ends can't keep the machine on
 *   stop()            async: turns this machine off
 *   warn(offAt)       optional: called once when the turn-off time is `warnMinutes` away
 *   extend(minutes)   "Keep on": pushes the turn-off time back, capped at `maxHoldMinutes` from now
 *
 * Never stops sooner than limitMinutes after it starts. A failed stop is retried every `retryMinutes`.
 */
export function createAutoOff({
  limitMinutes,
  busy = () => false,
  stop,
  warnMinutes = AUTO_OFF.warnMinutes,
  warn = null,
  maxBusyMinutes = AUTO_OFF.maxBusyMinutes,
  maxHoldMinutes = AUTO_OFF.maxHoldMinutes,
  retryMinutes = AUTO_OFF.retryMinutes,
  now = Date.now,
  everyMs = 60_000,
  log = console,
  tag = '[auto-off]',
}) {
  let last = now(); // last use (or start)
  let lastBusy = 0; // last time busy() said a job was running
  let hold = 0; // "keep on" until this time, whatever the use
  let stopping = null; // last stop attempt
  let retryAt = 0;
  let timer = null;
  let warnedFor = 0; // the turn-off time already warned about
  const limitMs = limitMinutes * 60_000;
  const busyCounts = () => now() - last < maxBusyMinutes * 60_000;
  const idleSince = () => (busyCounts() ? Math.max(last, lastBusy) : last);
  const offAtMs = () => Math.max(idleSince() + limitMs, hold);

  async function check() {
    if (!(limitMinutes > 0)) return;
    if (await Promise.resolve().then(busy).catch(() => false)) {
      if (busyCounts()) lastBusy = now();
      else log.warn?.(`${tag} a job has kept the machine busy for over ${maxBusyMinutes} min with no new use; ignoring it`);
    }
    const t = now();
    const offAt = offAtMs();
    if (warn && offAt - t <= warnMinutes * 60_000 && offAt > t && offAt !== warnedFor) {
      warnedFor = offAt;
      Promise.resolve()
        .then(() => warn(offAt))
        .catch((err) => log.warn?.(`${tag} could not send the turn-off warning: ${err.message}`));
    }
    if (t - idleSince() < limitMs || t < hold || t < retryAt) return;
    log.info?.(`${tag} unused for ${limitMinutes} min, turning the machine off`);
    try {
      await stop();
      stopping = { ok: true, at: new Date(t).toISOString() };
    } catch (err) {
      stopping = { ok: false, at: new Date(t).toISOString(), error: err.message };
      log.warn?.(`${tag} could not turn the machine off: ${err.message}; trying again in ${retryMinutes} min`);
      retryAt = t + retryMinutes * 60_000;
    }
  }

  return {
    activity: () => void (last = now()),
    /** Push the turn-off time back by `minutes`, never more than `maxHoldMinutes` from now. Returns the new turn-off time (ms). */
    extend: (minutes) => {
      const add = Math.max(0, Math.min(maxHoldMinutes, Number(minutes) || 0));
      hold = Math.min(Math.max(offAtMs(), now()) + add * 60_000, now() + maxHoldMinutes * 60_000);
      return offAtMs();
    },
    check,
    start: () => {
      clearInterval(timer);
      timer = setInterval(() => void check(), everyMs);
      timer.unref?.();
    },
    stopTimer: () => clearInterval(timer),
    /** The same shape on every machine (its /idle answer). offAt: when it turns off if nobody uses it. */
    state: () => ({
      limitMinutes,
      idleMinutes: Math.floor((now() - idleSince()) / 60_000),
      idleSeconds: Math.floor((now() - idleSince()) / 1000),
      offAt: limitMinutes > 0 ? new Date(offAtMs()).toISOString() : null,
      heldUntil: hold > now() ? new Date(hold).toISOString() : null,
      lastStop: stopping,
    }),
  };
}

/** Turn this pod off with the key Runpod gives every pod (RUNPOD_API_KEY, scoped to the pod). */
export async function runpodStopSelf({ podId, apiKey, fetchImpl = fetch }) {
  if (!podId || !apiKey) throw new Error('RUNPOD_POD_ID / RUNPOD_API_KEY not available');
  const headers = { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
  const failed = (err) => ({ ok: false, status: 0, json: async () => null, text: async () => err.message });
  const rest = await fetchImpl(`https://api.runpod.io/v2/pods/${encodeURIComponent(podId)}/action`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'stop' }),
    signal: AbortSignal.timeout(15_000),
  }).catch(failed);
  if (rest.ok) return;
  // Older pod keys may only work with the GraphQL API (what runpodctl uses).
  const gql = await fetchImpl('https://api.runpod.io/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: 'mutation($id:String!){podStop(input:{podId:$id}){id desiredStatus}}', variables: { id: podId } }),
    signal: AbortSignal.timeout(15_000),
  }).catch(failed);
  const body = gql.ok ? await gql.json().catch(() => null) : null;
  if (gql.ok && body && !body.errors) return;
  throw new Error(`Runpod refused to stop the pod (REST ${rest.status}, GraphQL ${gql.status}${body?.errors ? `: ${body.errors[0]?.message ?? 'error'}` : ''})`);
}
