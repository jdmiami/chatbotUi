// How an AI machine on GPU.ai tells the site where it is, and asks to be turned off.
//
// On Runpod the site knew a machine's address from its pod id. On GPU.ai the machine opens its own
// tunnel (ai/serverless/machine.sh: cloudflared, a trycloudflare.com address that changes every
// start) and writes the address into a file. This reads that file, publishes the address in R2
// (state/ai-machine.json, with a heartbeat the site uses to tell a live note from a stale one) and,
// when the auto-off rule fires, asks the site to terminate the instance (POST /api/ai/off with a
// token signed by the shared secret), since the machine holds no key of its own.
import fs from 'node:fs/promises';
import { signJwt } from './jwt.js';

export const MACHINE_KEY = 'state/ai-machine.json';
/** A note older than this is stale: the machine is gone (or stuck) and the site treats it as off. */
export const STALE_MS = 3 * 60_000;
const URL_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/**
 * { file, name, r2, log, now, intervalMs, fetchImpl }: watch `file` for the tunnel address, then keep
 * state/ai-machine.json fresh in R2 every `intervalMs` (a minute). `name` is the instance's name on
 * GPU.ai, so the site can match the note to the machine it started.
 */
export function createAnnounce({ file, name, r2, log = console, now = Date.now, intervalMs = 60_000, startedAt = now() }) {
  let url = null;
  let timer = null;
  let stopped = false;

  async function readUrl() {
    try {
      const text = (await fs.readFile(file, 'utf8')).trim();
      return URL_RE.test(text) ? text : null;
    } catch {
      return null;
    }
  }

  async function publish() {
    if (!url) url = await readUrl();
    if (!url) return false;
    // Without R2 (a trial machine) the address is only known here (the status says it).
    if (r2) await r2.putJson(MACHINE_KEY, { name, url, startedAt: new Date(startedAt).toISOString(), at: new Date(now()).toISOString() });
    return true;
  }

  async function tick() {
    if (stopped) return;
    try {
      const had = url;
      if ((await publish()) && !had) log.log?.(`[machine] reachable at ${url}`);
    } catch (err) {
      log.warn?.(`[machine] could not publish the address: ${err.message}`);
    }
  }

  return {
    start() {
      void tick();
      // Until the tunnel is up, look often; then once a minute.
      timer = setInterval(() => void tick(), url ? intervalMs : 5_000);
      timer.unref?.();
      const settle = setInterval(() => {
        if (!url || stopped) return;
        clearInterval(timer);
        clearInterval(settle);
        timer = setInterval(() => void tick(), intervalMs);
        timer.unref?.();
      }, 5_000);
      settle.unref?.();
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
    url: () => url,
    /** Read the file and publish now (tests, and the first look at start): true once the address is out. */
    publishNow: () => publish(),
  };
}

/**
 * Ask the site to terminate this machine: POST `${siteUrl}/api/ai/off` with a token the site checks
 * against the shared secret (audience site-island, like the status pill's). Throws when the site says no.
 */
export async function askSiteToTurnOff({ siteUrl, secret, name, fetchImpl = fetch, log = console }) {
  if (!siteUrl) throw new Error('SITE_URL is not set');
  const token = signJwt({ sub: 'ai-machine', aud: 'site-island', name }, secret, { expiresIn: 120 });
  const res = await fetchImpl(`${siteUrl.replace(/\/$/, '')}/api/ai/off`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`the site answered ${res.status}`);
  log.log?.('[machine] asked the site to turn this machine off');
}
