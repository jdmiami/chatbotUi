/**
 * Listening for the orb. Uses the device's own speech recognition when the browser has it (Safari
 * on iPhone and iPad does), which works even with the AI machine off. Otherwise it records and
 * asks Whisper on your AI machine. The microphone level drives the orb while you speak.
 */
import { getLocalAi } from '../../services/ai/LocalAi';

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
  return Boolean(SR()) || (typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
}

export interface Listening {
  /** Stop listening and use what was heard so far. */
  finish(): void;
  /** Stop and throw it away. */
  cancel(): void;
}

/**
 * Start listening. `onLevel` gets the mic level (0…1) for the orb; `onPartial` the words so far.
 * Resolves `onDone(text)` once you stop talking (or `finish()`); `onError` with a plain message.
 */
export function listen({
  onLevel,
  onPartial,
  onDone,
  onError,
}: {
  onLevel: (v: number) => void;
  onPartial: (text: string) => void;
  onDone: (text: string) => void;
  onError: (message: string) => void;
}): Listening {
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
    onLevel(0);
  };
  // The level meter (also the silence detector for the recording path).
  let quietSince = 0;
  let heardVoice = false;
  const meter = async (onSilence?: () => void) => {
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
      const level = Math.min(1, rms * 5);
      onLevel(level);
      const now = performance.now();
      if (level > 0.12) {
        heardVoice = true;
        quietSince = 0;
      } else if (heardVoice) {
        quietSince ||= now;
        if (now - quietSince > 1300) onSilence?.();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return stream;
  };

  const Recognition = SR();
  if (Recognition) {
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
      onPartial(text);
    };
    rec.onerror = (e) => {
      if (ended) return;
      ended = true;
      stopMeter();
      onError(e.error === 'not-allowed' ? 'Allow the microphone for this site to talk to the orb.' : e.error === 'no-speech' ? 'I didn’t hear anything.' : 'Listening stopped.');
    };
    rec.onend = () => {
      if (ended) return;
      ended = true;
      stopMeter();
      if (text) onDone(text);
      else onError('I didn’t hear anything.');
    };
    try {
      rec.start();
    } catch {
      onError('Listening isn’t available right now.');
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

  // Fallback: record, then Whisper on the AI machine.
  let recorder: MediaRecorder | null = null;
  const chunks: Blob[] = [];
  const finish = () => {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };
  void meter(finish).then((s) => {
    if (!s) return onError('Allow the microphone for this site to talk to the orb.');
    if (ended) return stopMeter();
    recorder = new MediaRecorder(s);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stopMeter();
      if (ended) return;
      ended = true;
      onPartial('…');
      try {
        const text = await getLocalAi().transcribe(new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }));
        if (text.trim()) onDone(text.trim());
        else onError('I didn’t hear anything.');
      } catch {
        onError('Your AI machine is needed to understand speech on this device. Hold the orb to type instead.');
      }
    };
    recorder.start();
    setTimeout(finish, 15_000);
  });
  return {
    finish,
    cancel: () => {
      ended = true;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      stopMeter();
    },
  };
}
