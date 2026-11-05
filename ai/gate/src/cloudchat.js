import { signJwt } from './jwt.js';

/**
 * The site's cloud AI as a chat model, for a machine with none of its own (the AI machine on GPU.ai
 * runs no Ollama). The Lab writes its ideas, stories and scores with it. Each request is signed with
 * the shared secret as the AI machine (audience site-island, like asking to be turned off) and goes to
 * the site's unfiltered writer (task "free", whose one rule keeps everyone in it an adult). Words only:
 * pictures are never sent out of the machine.
 *
 *   siteUrl     https://… (the site's own address)
 *   secret      GATEWAY_SECRET
 *   returns     async ({ system, user, temperature? }) => text
 */
export function createCloudChat({ siteUrl, secret, fetchImpl = fetch, timeoutMs = 60_000 }) {
  const base = String(siteUrl || '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('SITE_URL is not set');
  return async function cloudChat({ system, user, temperature = 0.9 }) {
    const token = signJwt({ sub: 'ai-machine', aud: 'site-island' }, secret, { expiresIn: 120 });
    const res = await fetchImpl(`${base}/api/orb/ai`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        task: 'free',
        messages: [
          { role: 'system', content: String(system || '') },
          { role: 'user', content: String(user || '') },
        ],
        max_tokens: 2048,
        temperature,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const why = await res.json().then((j) => j?.error, () => null);
      throw new Error(`cloud AI: ${why || res.status}`);
    }
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('cloud AI: no answer');
    return text;
  };
}
