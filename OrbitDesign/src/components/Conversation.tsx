import { forwardRef, useEffect, useRef, useState } from 'react';
import { useMotionLevel } from '../motion';
import { getAssistant, type ChatMessage } from '../flow/adapter';
import type { Choice } from '../flow/defs';
import { orbHome, orbThink } from '../flow/orbGuide';
import { Headline } from './Sheets';
import { Choices } from './Choices';
import { SqIcon, type IconName } from './icons';

/** A microphone, if the app has one: the "mic slot". Without it there is no mic button. */
export interface Mic {
  /** Whether this device can listen at all. */
  canListen(): boolean;
  /**
   * Start listening. `onLevel` gets the mic level (0…1) for the orb's glow; `onPartial` the words so
   * far; `onDone(text)` once you stop talking (or `finish()`); `onError` with a plain message.
   */
  listen(h: { onLevel: (v: number) => void; onPartial: (text: string) => void; onDone: (text: string) => void; onError: (message: string) => void }): {
    /** Stop listening and use what was heard so far. */
    finish(): void;
    /** Stop and throw it away. */
    cancel(): void;
  };
}

/** A button under the thread once something has been said ("Plan it", "Save this"). */
export interface ConversationAction {
  label: string;
  icon?: IconName;
  /** Called with the last thing you said (up to 120 characters), so the app can start from it. */
  onClick: (seed: string) => void;
}

/**
 * How the conversation reaches an assistant. Either give `onSend` (the whole reply at once), or set
 * an Assistant through the adapter (streamed). With neither, sending shows an error and keeps your
 * words in the box.
 */
export interface ConversationProps {
  /** The headline; *words between asterisks* are italic. */
  title: string;
  /** The running head over the headline. */
  kicker: string;
  /** The right-hand part of the running head. */
  num?: string;
  /** Ready openers, shown while nothing has been said. */
  starters: Choice[];
  /** Ready ways to carry on, shown after each reply. */
  followUps: Choice[];
  /** The assistant's instructions for this conversation (the first, system message). */
  system?: string;
  /** Answer one turn: the text just sent, the whole history before it, and an abort signal. Resolve with the reply. */
  onSend?: (text: string, history: ChatMessage[], signal?: AbortSignal) => Promise<string>;
  /** The mic slot (see Mic). */
  mic?: Mic;
  /** Called when the adapter's assistant is not awake; the app may start waking it. */
  onWake?: () => void;
  /** Buttons under the thread once something has been said. */
  actions?: ConversationAction[];
  placeholder?: string;
}

/**
 * A conversation, typed or spoken: a thread, ready openers and follow-ups as answers on springs,
 * and the actions an app wants to offer from what was said.
 */
export const Conversation = forwardRef<HTMLElement, ConversationProps>(function Conversation(
  { title, kicker, num, starters, followUps, system = 'Talk like a helpful companion: short replies, one idea at a time, and offer two or three directions to take it.', onSend, mic, onWake, actions = [], placeholder = 'Say what you have in mind…' },
  ref,
) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [hearing, setHearing] = useState<ReturnType<Mic['listen']> | null>(null);
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
    const first: ChatMessage = { role: 'system', content: system };
    let reply = '';
    const onText = (d: string) => {
      reply += d;
      setMsgs([...history, { role: 'assistant', content: reply }]);
    };
    try {
      if (onSend) {
        onText(await onSend(v, [first, ...msgs], ctrl.current.signal));
      } else {
        const a = getAssistant();
        if (!a) throw new Error('No assistant is plugged in yet.');
        if (!a.awake()) {
          onWake?.();
          throw Object.assign(new Error('The assistant is waking up. Try again in a couple of minutes.'), { status: 503 });
        }
        await a.chat([first, ...history], onText, ctrl.current.signal);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      // Nothing came back: take the empty reply away and keep your words, ready to send again.
      if (!reply) {
        setMsgs(msgs);
        setText(v);
      }
      setError((err as Error).message);
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
    const hint = starters.find((c) => c.label === label)?.hint;
    void send(starter ? `Let's start with: ${label.toLowerCase()}${hint ? ` (${hint.toLowerCase()})` : ''}.` : label);
  };

  const micTap = () => {
    if (!mic) return;
    if (hearing) {
      hearing.finish();
      return;
    }
    setHearing(
      mic.listen({
        onLevel: (v) => orbThink(v),
        onPartial: (t) => setText(t),
        onDone: (t) => {
          setHearing(null);
          orbThink(null);
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
        <span>{kicker}</span>
        {num && <span className="st-num">{num}</span>}
      </p>
      <Headline text={title} id="st-talk-t" />
      <div className="st-thread" aria-live="polite">
        {msgs.map((m, i) => (
          <p key={i} className={m.role === 'user' ? 'st-said' : 'st-reply'}>
            {typeof m.content === 'string' ? m.content || '…' : ''}
          </p>
        ))}
        <div ref={end} />
      </div>
      {error && (
        <p className="st-error" role="alert">
          {error}
        </p>
      )}
      {!busy && (
        <Choices
          key={msgs.length}
          items={msgs.length ? followUps : starters}
          picked={picked}
          onPick={(label) => void choose(label, msgs.length === 0)}
          label={msgs.length ? 'Where to take it' : 'Ways to start'}
          delay={msgs.length ? 0.1 : 0.2}
        />
      )}
      {seed && !busy && actions.length > 0 && (
        <p className="st-shortcuts" aria-label="Next">
          {actions.map((a) => (
            <button key={a.label} type="button" onClick={() => a.onClick(seed)}>
              {a.icon && <SqIcon name={a.icon} />} {a.label}
            </button>
          ))}
        </p>
      )}
      <form
        className="st-own"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label className="o5-kicker" htmlFor="st-talk-in">
          {hearing ? 'Listening…' : 'Say it or type it'}
        </label>
        <input id="st-talk-in" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} autoComplete="off" enterKeyHint="send" />
        {mic?.canListen() && (
          <button type="button" className="st-mic" aria-pressed={!!hearing} aria-label={hearing ? 'Stop listening' : 'Speak'} onClick={micTap}>
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
