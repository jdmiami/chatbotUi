import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../ui/Icon';
import type { LocalAi } from '../../services/ai/LocalAi';
import { AiOrb } from './AiOrb';
import { useShell } from '../../state/shell';
import { canSpeak, createSpeaker } from './speech';

type Phase = 'starting' | 'listening' | 'hearing' | 'transcribing' | 'thinking' | 'speaking' | 'paused' | 'error';

const LABEL: Record<Phase, string> = {
  starting: 'Starting the microphone…',
  listening: 'Listening…',
  hearing: 'Listening…',
  transcribing: 'Got it…',
  thinking: 'Thinking…',
  speaking: 'Tap to interrupt',
  paused: 'Paused',
  error: 'Something went wrong',
};

export function recorderType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return '';
}

/**
 * Voice conversation: talk, and the AI answers out loud. Your speech is turned into text by Whisper
 * on your own AI machine; replies are read by the device's voice, a sentence at a time as they stream.
 * It listens again when it finishes speaking; tap the orb to cut in. Everything lands in the chat too.
 */
export function VoiceMode({
  ai,
  onAsk,
  onClose,
}: {
  ai: LocalAi;
  /** Send `text` as a message; `onDelta` gets the reply as it streams. Resolves when it is complete. */
  onAsk: (text: string, onDelta: (d: string) => void) => Promise<void>;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('starting');
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const phaseRef = useRef<Phase>('starting');
  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const speaker = useRef<ReturnType<typeof createSpeaker> | null>(null);
  const finishNow = useRef<() => void>(() => {});
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let rec: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let startedAt = 0;
    let lastVoice = 0;
    let floor = 0.01;
    let alive = true;
    const type = recorderType();

    const handle = async (blob: Blob, ms: number) => {
      if (!alive) return;
      if (ms < 450 || blob.size < 2000) return go('listening');
      go('transcribing');
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        const text = (await ai.transcribe(blob, ctrl.signal)).trim();
        if (!alive) return;
        if (!text || /^\W*$/.test(text)) return go('listening');
        setHeard(text);
        setReply('');
        go('thinking');
        const voice = canSpeak()
          ? createSpeaker({
              onStart: () => alive && phaseRef.current === 'thinking' && go('speaking'),
              onDone: () => alive && (phaseRef.current === 'speaking' || phaseRef.current === 'thinking') && go('listening'),
            })
          : null;
        speaker.current = voice;
        await onAsk(text, (d) => {
          setReply((r) => r + d);
          voice?.push(d);
        });
        if (!alive) return;
        if (voice) voice.end();
        else go('listening');
      } catch (err) {
        if (!alive || ctrl.signal.aborted) return;
        setError((err as Error).message);
        go('listening');
      } finally {
        abort.current = null;
      }
    };

    const startRec = () => {
      if (!stream) return;
      chunks = [];
      rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const began = performance.now();
      rec.onstop = () => void handle(new Blob(chunks, { type: (rec?.mimeType || type || 'audio/webm').split(';')[0] }), performance.now() - began);
      rec.start(250);
      startedAt = performance.now();
      lastVoice = startedAt;
      go('hearing');
    };
    finishNow.current = () => {
      if (rec && rec.state === 'recording') rec.stop();
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use the microphone here.');
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (!alive) return stream.getTracks().forEach((t) => t.stop());
        ctx = new AudioContext();
        await ctx.resume().catch(() => {});
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        src.connect(an);
        const buf = new Float32Array(an.fftSize);
        let shown = 0;
        go('listening');
        const tick = (now: number) => {
          raf = requestAnimationFrame(tick);
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          const p = phaseRef.current;
          // The quiet level of the room, so a noisy room doesn't count as talking.
          if (p === 'listening') floor = floor * 0.995 + Math.min(rms, floor * 2) * 0.005;
          const threshold = Math.max(0.018, floor * 3);
          if (now - shown > 50) {
            shown = now;
            setLevel(Math.min(1, rms / 0.12));
          }
          if (p === 'listening' && rms > threshold) startRec();
          else if (p === 'hearing') {
            if (rms > threshold * 0.8) lastVoice = now;
            if (now - lastVoice > 1100 || now - startedAt > 60_000) rec?.stop();
          }
        };
        raf = requestAnimationFrame(tick);
      } catch (err) {
        if (!alive) return;
        const e = err as Error;
        setError(e.name === 'NotAllowedError' ? 'Microphone access was not allowed. Allow it in your browser settings to talk.' : e.message);
        go('error');
      }
    })();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      abort.current?.abort();
      speaker.current?.stop();
      if (rec && rec.state === 'recording') {
        rec.onstop = null;
        rec.stop();
      }
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
    };
  }, [ai, onAsk]);

  const tapOrb = () => {
    const p = phaseRef.current;
    if (p === 'speaking' || p === 'thinking') {
      speaker.current?.stop();
      go('listening');
    } else if (p === 'hearing') finishNow.current();
    else if (p === 'paused') go('listening');
  };

  const energy = phase === 'speaking' ? 0.75 : phase === 'thinking' || phase === 'transcribing' ? 0.5 : phase === 'paused' ? 0.15 : 0.2 + level * 0.8;
  // The one orb comes to centre stage and is the voice orb: it breathes with your voice.
  const orbOn = useShell((st) => st.settings.orb !== false);
  useEffect(() => {
    if (orbOn) window.dispatchEvent(new CustomEvent('orb:energy', { detail: energy }));
  }, [orbOn, energy]);
  useEffect(() => () => void window.dispatchEvent(new CustomEvent('orb:energy', { detail: null })), []);

  return (
    <div className="ai-voice" role="dialog" aria-modal="true" aria-label="Voice chat">
      <button type="button" className="ai-voice-orb" data-orb-spot={orbOn ? 'stage' : undefined} data-orb-size="180" onClick={tapOrb} aria-label={phase === 'hearing' ? 'Done talking' : phase === 'speaking' ? 'Interrupt' : 'Voice orb'}>
        {orbOn ? <span className="ai-voice-spot" aria-hidden /> : <AiOrb typing={false} energy={energy} className="ai-orb-voice" />}
      </button>
      <p className="ai-voice-state" role="status" aria-live="polite" data-phase={phase}>
        {LABEL[phase]}
      </p>
      <div className="ai-voice-text">
        {heard && <p className="ai-voice-heard">“{heard}”</p>}
        {reply && <p className="ai-voice-reply">{reply.length > 280 ? `…${reply.slice(-280)}` : reply}</p>}
        {error && <p className="ai-error">{error}</p>}
      </div>
      <div className="ai-voice-bar">
        <button
          type="button"
          className="btn"
          onClick={() => {
            speaker.current?.stop();
            go(phaseRef.current === 'paused' ? 'listening' : 'paused');
          }}
          disabled={phase === 'starting' || phase === 'error'}
        >
          <Icon name={phase === 'paused' ? 'mic' : 'pause'} size={18} /> {phase === 'paused' ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="btn danger" onClick={onClose}>
          <Icon name="close" size={18} /> End
        </button>
      </div>
      {!canSpeak() && <p className="ai-muted">This browser can't speak replies; they appear as text in the chat.</p>}
    </div>
  );
}
