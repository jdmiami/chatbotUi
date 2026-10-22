/**
 * OrbBrain for a local model server with POST /api/chat streaming NDJSON.
 * Lifted from docs/10-ai-adapter.md so it can be imported as code. No vendor names: fill in the
 * placeholders. Never put a secret key in browser code; proxy it.
 */
import type { OrbBrain } from '../orb';

export function localChatBrain({ base = 'http://localhost:11434', model = 'YOUR_MODEL' }: { base?: string; model?: string } = {}): OrbBrain {
  let okUntil = 0;
  let ok = false;

  return {
    why: 'The local model is not running. Start it and try again.',

    async ready() {
      if (Date.now() < okUntil) return ok;
      try {
        // The tags listing says the server is up and which models it has.
        const res = await fetch(`${base}/api/tags`);
        const json = res.ok ? ((await res.json()) as { models?: { name: string }[] }) : null;
        ok = !!json?.models?.some((m) => m.name === model || m.name.startsWith(`${model}:`));
      } catch {
        ok = false;
      }
      okUntil = Date.now() + 5000;
      return ok;
    },

    async chat(messages, onText, signal) {
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: true, options: { temperature: 0.3, num_predict: 500 } }),
      });
      if (!res.ok || !res.body) throw new Error(`The local model said ${res.status}.`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const json = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
          if (json.error) throw new Error(json.error);
          if (json.message?.content) onText(json.message.content);
          if (json.done) return;
        }
      }
    },
  };
}
