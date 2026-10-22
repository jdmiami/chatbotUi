/**
 * OrbBrain for any HTTP 'chat completions' endpoint that streams server-sent events.
 * Lifted from docs/10-ai-adapter.md so it can be imported as code. No vendor names: fill in the
 * placeholders. Never put a secret key in browser code; proxy it.
 */
import type { OrbBrain } from '../orb';

export function httpChatBrain({
  url = 'YOUR_ENDPOINT/v1/chat/completions',
  model = 'YOUR_MODEL',
  key,
  maxTokens = 500,
  temperature = 0.3,
}: { url?: string; model?: string; key?: string; maxTokens?: number; temperature?: number }): OrbBrain {
  let okUntil = 0;
  let ok = false;

  return {
    why: 'The answer service is not reachable right now.',

    async ready() {
      if (Date.now() < okUntil) return ok;
      try {
        // Any cheap request that proves the service is there; a models listing is the usual one.
        const res = await fetch(url.replace(/\/chat\/completions$/, '/models'), { headers: key ? { authorization: `Bearer ${key}` } : {} });
        ok = res.ok;
      } catch {
        ok = false;
      }
      okUntil = Date.now() + 5000;
      return ok;
    },

    async chat(messages, onText, signal) {
      const res = await fetch(url, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model, messages, stream: true, max_tokens: maxTokens, temperature }),
      });
      if (!res.ok || !res.body) throw new Error(`The answer service said ${res.status}.`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE: events are separated by blank lines; each data line carries one JSON chunk.
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          try {
            const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) onText(delta);
          } catch {
            /* a partial or keep-alive line: skip it */
          }
        }
      }
    },
  };
}
