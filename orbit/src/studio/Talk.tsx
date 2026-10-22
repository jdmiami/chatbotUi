import { forwardRef, useEffect, useRef, useState } from 'react';
import { cloudChat } from '../services/ai/CloudAi';
import { getLocalAi, type ChatMessage } from '../services/ai/LocalAi';
import { canListen, listen, type Listening } from '../shell/orb/listen';
import type { MakeKind, StudioDef } from './defs';
import { Headline } from './Sheets';
import { SqIcon } from './icons';

/**
 * Talk: a conversation with the studio's writer, typed or spoken. At any point it can become a
 * walkthrough, already started from what you talked about.
 */
export const Talk = forwardRef<HTMLElement, { studio: StudioDef; onMake: (kind: Exclude<MakeKind, 'talk'>, seed: string) => void }>(function Talk({ studio, onMake }, ref) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [hearing, setHearing] = useState<Listening | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), [msgs]);

  const send = async (said: string) => {
    const v = said.trim();
    if (!v || busy) return;
    setText('');
    setError(null);
    const history: ChatMessage[] = [...msgs, { role: 'user', content: v }];
    setMsgs([...history, { role: 'assistant', content: '' }]);
    setBusy(true);
    ctrl.current = new AbortController();
    const all: ChatMessage[] = [{ role: 'system', content: `${studio.writer}\nTalk like a creative partner: short replies, one idea at a time, and offer two or three directions to take it.` }, ...history];
    let reply = '';
    const onText = (d: string) => {
      reply += d;
      setMsgs([...history, { role: 'assistant', content: reply }]);
    };
    try {
      const ai = getLocalAi();
      const on = (await ai.status().catch(() => null))?.state === 'on';
      const model = on ? (await ai.listModels().catch(() => [] as string[]))[0] : undefined;
      if (model) await ai.chat(model, all, { onText }, ctrl.current.signal);
      else await cloudChat({ task: 'chat', messages: all, signal: ctrl.current.signal }, { onText });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mic = () => {
    if (hearing) {
      hearing.finish();
      return;
    }
    setHearing(
      listen({
        onLevel: (v) => window.dispatchEvent(new CustomEvent('orb:energy', { detail: v })),
        onPartial: (t) => setText(t),
        onDone: (t) => {
          setHearing(null);
          window.dispatchEvent(new CustomEvent('orb:energy', { detail: null }));
          void send(t);
        },
        onError: (m) => {
          setHearing(null);
          setError(m);
        },
      }),
    );
  };

  const lastUser = [...msgs].reverse().find((m) => m.role === 'user')?.content;
  const seed = typeof lastUser === 'string' ? lastUser.slice(0, 120) : '';

  return (
    <article className="st-sheet st-talk" ref={ref} aria-labelledby="st-talk-t">
      <p className="st-kick">
        <span>Talk</span>
        <span className="st-num">The writer</span>
      </p>
      {msgs.length === 0 ? <Headline text="What are you *in the mood for?*" id="st-talk-t" /> : <Headline text="Talking with the *writer*" id="st-talk-t" />}
      <div className="st-thread" aria-live="polite">
        {msgs.map((m, i) => (
          <p key={i} className={m.role === 'user' ? 'st-said' : 'st-reply'}>
            {typeof m.content === 'string' ? m.content || '…' : ''}
          </p>
        ))}
        <div ref={end} />
      </div>
      {error && <p className="st-error" role="alert">{error}</p>}
      {seed && !busy && (
        <p className="st-shortcuts" aria-label="Make it">
          <button type="button" onClick={() => onMake('image', seed)}>
            <SqIcon name="picture" /> Make it a picture
          </button>
          <button type="button" onClick={() => onMake('video', seed)}>
            <SqIcon name="video" /> A video
          </button>
          <button type="button" onClick={() => onMake('movie', seed)}>
            <SqIcon name="movie" /> A movie
          </button>
        </p>
      )}
      <form
        className="st-own"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label htmlFor="st-talk-in">{hearing ? 'Listening…' : 'Say it or type it'}</label>
        <input id="st-talk-in" value={text} onChange={(e) => setText(e.target.value)} placeholder="A slow-burn story about…" autoComplete="off" enterKeyHint="send" />
        {canListen() && (
          <button type="button" className="st-mic" aria-pressed={!!hearing} aria-label={hearing ? 'Stop listening' : 'Speak'} onClick={mic}>
            <SqIcon name="mic" />
          </button>
        )}
        <button type="submit" disabled={!text.trim() || busy}>
          Send
        </button>
      </form>
    </article>
  );
});
