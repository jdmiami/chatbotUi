# 10 · The AI adapter (`OrbBrain`)

The orb contains no AI. Everything it thinks with comes through one object the app owner plugs in:
the `brain` prop of `<OrbCursor>`. Pass `null` and the orb still does everything physical (follow,
caret, drag, throw, pinch, captions, notes, panel); it only cannot answer, and its face is sleepy
in the panel.

```ts
import type { OrbBrain } from 'orbit-design/orb';

export interface OrbBrain {
  /** Stream a reply. messages[0] may be a system prompt the orb builds from data-orb-context. */
  chat(messages: { role: 'system' | 'user' | 'assistant'; content: string }[], onText: (delta: string) => void, signal?: AbortSignal): Promise<void>;
  /** Is there something to think with right now (else the orb shows as sleepy). */
  ready(): Promise<boolean>;
  /** Why it is asleep, for the panel. */
  why?: string;
  /** Optional: speak a line (text to speech). */
  speak?(text: string): void;
  /** Optional: listen (speech to text) returning a handle with finish()/cancel() and onPartial/onDone callbacks. */
  listen?(h: { onLevel?: (v: number) => void; onPartial?: (t: string) => void; onDone: (t: string) => void; onError?: (m: string) => void }): { finish(): void; cancel(): void };
}
```

---

## 1. Field by field

### `chat(messages, onText, signal)` — required

| | |
|---|---|
| `messages` | A plain list. `role` is `system`, `user` or `assistant`; `content` is text. The orb always puts one `system` message first, then (for a free question) up to 8 lines of the recent exchange as `user`/`assistant`, then the `user` question. For "explain this screen" there is just system + user. |
| `onText(delta)` | Call it with each piece of the reply as it streams. The orb joins the pieces and shows the whole reply when the promise resolves (it also strips any `<think>…</think>` block). If your backend does not stream, call `onText` once with the full text. |
| `signal` | An `AbortSignal`. The orb aborts when the person taps **Stop**, asks something else, or shakes the device. Pass it to `fetch` and stop early. An abort should reject (a `fetch` abort rejects with `AbortError`); the orb ignores errors after an abort. |
| returns | A promise that resolves when the reply is complete. Reject with an `Error` whose `message` is a short plain sentence: the orb says it, flashes a sad face and plays the error cue. |

What the system message contains: your `explainPrompt`/`askPrompt` (or the defaults, see
`docs/09-orb.md` §15), then two newlines, then whatever is in `<html data-orb-context>` if the
page set it.

### `ready()` — required

Called when the panel opens (to pick the sleepy face) and before every question. Return `true`
when a reply is possible now (the server is up, a key is set, a model is loaded). Return `false`
and the orb says `why` instead of calling `chat`. Keep it quick: cache the result for a few seconds
if it needs a network round trip. Throwing counts as `false`.

### `why` — optional string

What the orb says when `ready()` is false. An app whose model sleeps between uses might say: *"I think with the server,
and it’s resting right now. It wakes up when you ask for something."* Without it the orb says
*"There is nothing for me to think with here yet."*

### `speak(text)` — optional

Text to speech. The orb calls it only for answers to **spoken** questions (ones that came in
through `listen`). Typed questions are never read aloud. If the adapter has no `speak`, nothing
is read.

### `listen(handlers)` — optional

Speech to text. When present, a **tap** on the orb starts listening (and the panel shows a mic
button); when absent, a tap opens the panel. The orb calls it with:

| Handler | What the orb does |
|---|---|
| `onLevel(v)` | `v` is the microphone level 0…1. The orb's face energy becomes `0.25 + v·0.75` (at most every 70 ms) and it swells a little (`depth = −v·0.25`). Call it at animation-frame rate; call it with `0` when you stop. |
| `onPartial(text)` | the words so far; shown as the caption (empty text shows "Listening…") |
| `onDone(text)` | listening ended with words: the orb runs them as a spoken question |
| `onError(message)` | listening ended with nothing or failed: the orb says `message` |

Return `{ finish(), cancel() }`: `finish()` stops and uses what was heard (a second tap on the orb
calls it); `cancel()` stops and throws it away (the orb calls it on unmount). Call exactly one of
`onDone`/`onError`, once.

---

## 2. Telling the orb about the page

Set `data-orb-context` on `<html>`. It is appended to the system prompt of every call, so the
model knows where the person is and what the page is for. Keep it short and current.

```ts
// In a page component
useEffect(() => {
  document.documentElement.dataset.orbContext =
    `You are the guide inside ${site.name}. The visitor is on the "${step.title}" step. ` +
    `To move on they pick one of the listed answers or type their own.`;
  return () => { delete document.documentElement.dataset.orbContext; };
}, [site.name, step.title]);
```

The example app does the same (`example/src/App.tsx`, keyed on the view and the step). The source app's
text also told the model which of its agent verbs not to use, which does not apply here.

## 3. Handing the orb a question from the page

Any part of the page can put a line into the orb's panel as if it were typed there:

```ts
import { orbRun } from 'orbit-design/orb';

orbRun(`Explain “${selection}”`);   // the panel opens, the question runs through brain.chat
```

(In the source app this was the `orbit:orb-run` event, used by its Rewrite menu to ask for a picture of
the selected text. The event is now `orb:run`.)

To leave the orb something to say without a model at all, use a note:

```ts
import { orbNote, onOrbAct } from 'orbit-design/orb';
orbNote('Pick a mood, or say your own.', { label: 'Pick for me', id: 'pick' });
const stop = onOrbAct((id) => id === 'pick' && pickForMe());
```

---

## 4. Worked adapter: an HTTP chat endpoint that streams server-sent events

The widely shared "chat completions" HTTP shape: any server (cloud or self-hosted) that accepts
`POST /v1/chat/completions` with `{ model, messages, stream: true }` and streams `data: {json}`
lines (server-sent events). Replace `YOUR_ENDPOINT`, `YOUR_MODEL` and
`YOUR_KEY`. Never ship a secret key to the browser; put a small proxy in front and send the
request there.

```ts
import type { OrbBrain } from 'orbit-design/orb';

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
```

Abort: `fetch` rejects with an `AbortError` when the orb aborts the signal; the reader stops with
it. That is the behaviour the orb expects.

---

## 5. Worked adapter: a local server with `/api/chat` (NDJSON streaming)

A local model server that takes `POST /api/chat` with `{ model, messages, stream: true }` and
streams one JSON object per line, each with `message.content` and a final `done: true`. Replace
`YOUR_MODEL`. The default port below is the one such servers commonly use; change it to yours.

```ts
import type { OrbBrain } from 'orbit-design/orb';

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
```

---

## 6. Worked adapter: the browser's own voice (`speak` / `listen`)

These two functions are DOM-only ports of the source app's speaking module and the
browser-recognition branch of its listening module; the package ships them as `src/ai/webSpeech.ts`. The source app's listening had a second
branch that recorded audio and sent it to a speech-to-text server when the browser had no
recognition of its own; that branch is not included here (it needed the source app's own server). You can
add one by returning the same `{ finish, cancel }` handle around a `MediaRecorder` and your own
speech-to-text call.

Combine them with one of the chat adapters above:

```ts
const brain: OrbBrain = { ...httpChatBrain({ key }), ...webSpeech() };
```

The same object can serve the guided flow's suggestions and the conversation: `setAssistant(assistantFromBrain(brain))` (`src/ai/bridge.ts`; `Assistant` and `setAssistant` are in `src/flow/adapter.ts`).

```ts
import type { OrbBrain } from 'orbit-design/orb';

// ---------------------------------------------------------------- speaking (from the source app's speaking module)

export function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** Turn markdown into something worth hearing. */
export function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?(```|$)/g, ' (I put the code in the chat.) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[(\d+)\]/g, '')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~>|#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

let chosen: SpeechSynthesisVoice | null | undefined;
function bestVoice(): SpeechSynthesisVoice | null {
  if (chosen !== undefined) return chosen;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  const lang = (navigator.language || 'en-US').slice(0, 2);
  const mine = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  const pool = mine.length ? mine : voices;
  // Prefer the device's higher-quality voices, then a local one.
  const rank = (v: SpeechSynthesisVoice) =>
    (/premium|enhanced|natural|neural/i.test(v.name) ? 4 : 0) + (v.localService ? 1 : 0);
  chosen = [...pool].sort((a, b) => rank(b) - rank(a))[0] ?? null;
  return chosen;
}

/** A speaker that takes streamed text and reads it out sentence by sentence. */
export function createSpeaker({ onStart, onDone }: { onStart?: () => void; onDone?: () => void } = {}) {
  let buffer = '';
  let queued = 0;
  let finished = false;
  let stopped = false;

  const say = (text: string) => {
    const clean = speakable(text);
    if (!clean || stopped) return;
    const u = new SpeechSynthesisUtterance(clean);
    const v = bestVoice();
    if (v) u.voice = v;
    u.rate = 1.03;
    queued++;
    u.onstart = () => onStart?.();
    u.onend = u.onerror = () => {
      queued--;
      if (finished && queued <= 0 && !stopped) onDone?.();
    };
    speechSynthesis.speak(u);
  };

  return {
    /** Add streamed text; whole sentences are spoken as soon as they are complete. */
    push(delta: string) {
      buffer += delta;
      // Don't split inside a code block; wait for it to close.
      if ((buffer.match(/```/g) ?? []).length % 2 === 1) return;
      const m = /^([\s\S]*[.!?…:;\n])(\s+|$)/.exec(buffer);
      if (m && m[1].trim().length > 12) {
        say(m[1]);
        buffer = buffer.slice(m[0].length);
      }
    },
    /** The reply is complete: say what's left, then call onDone when the voice stops. */
    end() {
      finished = true;
      say(buffer);
      buffer = '';
      if (queued <= 0 && !stopped) onDone?.();
    },
    stop() {
      stopped = true;
      buffer = '';
      queued = 0;
      speechSynthesis.cancel();
    },
  };
}

/** iPhone only lets a page speak after a tap: call this from the tap that starts a conversation. */
export function unlockSpeech() {
  if (!canSpeak()) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

// ---------------------------------------------------------------- listening (from the source app's listening module, browser branch)

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const SR = (): (new () => Rec) | null =>
  (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition ??
  null;

export function canListen(): boolean {
  return Boolean(SR());
}

type ListenHandlers = Parameters<NonNullable<OrbBrain['listen']>>[0];

/**
 * Start listening with the browser's recognition. `onLevel` gets the mic level (0…1) for the orb;
 * `onPartial` the words so far. `onDone(text)` once you stop talking (or `finish()`); `onError`
 * with a plain message.
 */
export function listen({ onLevel, onPartial, onDone, onError }: ListenHandlers): { finish(): void; cancel(): void } {
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let raf = 0;
  let ended = false;
  const stopMeter = () => {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => {});
    stream = null;
    ctx = null;
    onLevel?.(0);
  };
  // The level meter: RMS of the time-domain signal, ×5, capped at 1.
  const meter = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return null;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return stream;
    ctx = new AC();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const b of buf) sum += ((b - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / buf.length);
      onLevel?.(Math.min(1, rms * 5));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return stream;
  };

  const Recognition = SR();
  if (!Recognition) {
    onError?.('Listening isn’t available in this browser.');
    return { finish() {}, cancel() {} };
  }
  const rec = new Recognition();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  let text = '';
  rec.onresult = (e) => {
    text = Array.from(e.results)
      .map((r) => r[0]?.transcript ?? '')
      .join(' ')
      .trim();
    onPartial?.(text);
  };
  rec.onerror = (e) => {
    if (ended) return;
    ended = true;
    stopMeter();
    onError?.(e.error === 'not-allowed' ? 'Allow the microphone for this site to talk to the orb.' : e.error === 'no-speech' ? 'I didn’t hear anything.' : 'Listening stopped.');
  };
  rec.onend = () => {
    if (ended) return;
    ended = true;
    stopMeter();
    if (text) onDone(text);
    else onError?.('I didn’t hear anything.');
  };
  try {
    rec.start();
  } catch {
    onError?.('Listening isn’t available right now.');
  }
  void meter();
  return {
    finish: () => rec.stop(),
    cancel: () => {
      ended = true;
      rec.abort();
      stopMeter();
    },
  };
}

// ---------------------------------------------------------------- the two adapter fields

/** `speak` and `listen` for an OrbBrain, from the browser alone. Spread it over a chat adapter. */
export function webSpeech(): Pick<OrbBrain, 'speak' | 'listen'> {
  const out: Pick<OrbBrain, 'speak' | 'listen'> = {};
  if (canSpeak()) {
    out.speak = (text) => {
      const sp = createSpeaker();
      sp.push(text);
      sp.end();
    };
  }
  if (canListen()) out.listen = listen;
  return out;
}
```

Notes on the port:

- `speak` is exactly what the source app's orb did in `say()`: `createSpeaker().push(text); end()`, so a
  whole reply is spoken sentence by sentence at rate 1.03 in the best local voice for the page's
  language. One difference: the source app's `bestVoice` also preferred a short list of named voices; that
  list is left out here so no product names appear. Add your own `name` matches to `rank` if you want.
- The source app's `listen` also detected 1300 ms of silence after speech (level > 0.12) to stop its
  recording branch; the browser-recognition branch ends on its own (`continuous = false`), so the
  silence rule is not needed here.
- Only attach `listen` when `canListen()` is true: the orb shows the mic and makes a tap start
  listening **only if `brain.listen` exists**.

---

## 7. Checklist for any adapter

- `chat` streams through `onText`, resolves when done, rejects with a short plain-language `Error` on failure, and stops on `signal`.
- `ready` is fast (cache it), never throws for long, and `why` says what to do.
- Keys stay on a server you control.
- Set `data-orb-context` on `<html>` from each page, and clear it when the page leaves.
- Use `orbRun(text)` to send a line into the panel, `orbNote` for lines that need no model.
- No vendor or model names in the UI strings; the orb's own copy never names one.
