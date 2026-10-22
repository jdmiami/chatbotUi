import { forwardRef, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../services/ai/LocalAi';
import { studioAi } from './memberApi';
import { canListen, listen, type Listening } from '../shell/orb/listen';
import type { MakeKind, StudioDef } from './defs';
import { Headline } from './Sheets';
import { Choices } from './Choices';
import { orbHome } from './orbGuide';
import { useMotionLevel } from '../motion/MotionProvider';
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
  const [picked, setPicked] = useState<string | null>(null);
  const level = useMotionLevel();
  const end = useRef<HTMLDivElement>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), [msgs]);
  // A new turn brings the orb back to its place, wherever it was thrown.
  useEffect(() => orbHome(), [msgs.length]);

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
      await studioAi.chat(all, onText, ctrl.current.signal);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      // Nothing came back: take the empty reply away and keep your words, ready to send again.
      if (!reply) {
        setMsgs(msgs);
        setText(v);
      }
      // Resting: wake the studio for the writer, and say so.
      if ((err as { status?: number }).status === 503) {
        void studioAi.power('start').catch(() => {});
        setError('The writer is waking up with the studio. Try again in a couple of minutes.');
      } else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** A ready answer: it lifts, the others leave, and it is said for you. */
  const choose = async (label: string, starter: boolean) => {
    if (picked !== null || busy) return;
    orbHome();
    setPicked(label);
    await new Promise((r) => setTimeout(r, level === 'full' ? 520 : level === 'lite' ? 200 : 0));
    setPicked(null);
    const hint = studio.talk.starters.find((c) => c.label === label)?.hint;
    void send(starter ? `I'm in the mood for: ${label.toLowerCase()}${hint ? ` (${hint.toLowerCase()})` : ''}.` : label);
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
      <p className="o5-kicker st-kick">
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
      {!busy && (
        <Choices
          key={msgs.length}
          items={msgs.length ? studio.talk.followUps : studio.talk.starters}
          picked={picked}
          onPick={(label) => void choose(label, msgs.length === 0)}
          label={msgs.length ? 'Where to take it' : 'Moods'}
          delay={msgs.length ? 0.1 : 0.2}
        />
      )}
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
        <label className="o5-kicker" htmlFor="st-talk-in">{hearing ? 'Listening…' : 'Say it or type it'}</label>
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
