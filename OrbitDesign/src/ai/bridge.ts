import type { OrbBrain } from '../orb';
import type { Assistant } from '../flow';

/**
 * One adapter for both slots: the orb's brain and the flow's assistant are the same model in most
 * apps. `awake()` must be free (no network), so it reports the last answer of `ready()`, refreshed
 * in the background every `everyMs`.
 */
export function assistantFromBrain(brain: OrbBrain, { everyMs = 5000, maxTokensHint = true }: { everyMs?: number; maxTokensHint?: boolean } = {}): Assistant {
  let awake = false;
  let checkedAt = 0;
  const check = () => {
    if (Date.now() - checkedAt < everyMs) return;
    checkedAt = Date.now();
    void brain.ready().then(
      (ok) => (awake = ok),
      () => (awake = false),
    );
  };
  check();
  return {
    awake() {
      check();
      return awake;
    },
    chat(messages, onText, signal, maxTokens) {
      // OrbBrain has no max-tokens field; a hint in the system line keeps replies short where it matters.
      const short = maxTokensHint && maxTokens && maxTokens <= 400 && messages[0]?.role === 'system';
      const msgs = short ? [{ ...messages[0], content: `${messages[0].content}\nKeep it under ${Math.round(maxTokens / 4)} words.` }, ...messages.slice(1)] : messages;
      return brain.chat(msgs, onText, signal);
    },
  };
}
