/**
 * speak / listen for an OrbBrain from the browser alone (Web Speech + a mic level meter).
 * Lifted from docs/10-ai-adapter.md so it can be imported as code. No vendor names: fill in the
 * placeholders. Never put a secret key in browser code; proxy it.
 */
import type { OrbBrain } from '../orb';

// ---------------------------------------------------------------- speaking (from Orbit's speech.ts)

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

// ---------------------------------------------------------------- listening (from Orbit's listen.ts, browser branch)

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
