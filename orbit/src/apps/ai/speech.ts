/**
 * Reading replies aloud with the device's own voices (on iPhone these are Apple's on-device voices).
 * Text arrives as it streams; it is spoken a sentence at a time so speaking starts right away.
 * Code, links and formatting are tidied so they are not read out symbol by symbol.
 */

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
  const rank = (v: SpeechSynthesisVoice) =>
    (/premium|enhanced|natural|neural/i.test(v.name) ? 4 : 0) + (/samantha|ava|zoe|siri|aria|jenny|google us english/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0);
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
