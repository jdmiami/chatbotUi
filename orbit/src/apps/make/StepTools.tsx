import { useEffect, useRef, useState } from 'react';
import { useShell } from '../../state/shell';
import { useMotionLevel } from '../../motion/MotionProvider';
import { cue } from '../../motion/feedback';
import { Icon } from '../../ui/Icon';
import { canListen, listen, type Listening } from '../../shell/orb/listen';
import { pickFor, type AssistOption } from '../../shell/orb/assist';
import { fillIdea, type IdeaBox } from './ideas';

/**
 * The helpers beside each text box in Make: hold to talk (the words go into the box as you speak),
 * and "Fill for me" (an idea; tap again for another). Choice steps get "Choose for me".
 */

/** Hold to talk; a quick tap keeps listening until the next tap. */
export function TalkButton({ value, onChange, what }: { value: string; onChange: (text: string) => void; what: string }) {
  const toast = useShell((s) => s.toast);
  const [on, setOn] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const live = useRef<Listening | null>(null);
  const pressedAt = useRef(0);
  const latched = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => () => live.current?.cancel(), []);
  if (!canListen()) return null;

  const start = () => {
    if (live.current) return;
    const before = valueRef.current.trim();
    const put = (t: string) => onChange(before ? `${before} ${t}` : t);
    setOn(true);
    cue('tap');
    live.current = listen({
      onLevel: (v) => ref.current?.style.setProperty('--lvl', v.toFixed(3)),
      onPartial: (t) => t && t !== '…' && put(t),
      onDone: (t) => {
        put(t);
        live.current = null;
        setOn(false);
        cue('pop');
      },
      onError: (msg) => {
        live.current = null;
        setOn(false);
        toast(msg, 'info');
      },
    });
  };
  const stop = () => {
    live.current?.finish();
  };

  return (
    <button
      ref={ref}
      type="button"
      className="mk-tool mk-talk"
      data-noswipe
      data-on={on || undefined}
      aria-pressed={on}
      aria-label={on ? `Listening: let go to stop` : `Hold to talk: ${what}`}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        pressedAt.current = performance.now();
        if (live.current && latched.current) {
          latched.current = false;
          return stop();
        }
        latched.current = false;
        start();
      }}
      onPointerUp={() => {
        if (!live.current) return;
        // A quick tap: keep listening until the next tap. A hold: done when let go.
        if (performance.now() - pressedAt.current < 350) latched.current = true;
        else stop();
      }}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        e.preventDefault();
        if (e.repeat) return;
        if (live.current) stop();
        else {
          latched.current = true;
          start();
        }
      }}
    >
      <span className="mk-talk-rings" aria-hidden />
      <Icon name="mic" size={18} />
      <span className="mk-tool-word">{on ? 'Listening…' : 'Hold to talk'}</span>
    </button>
  );
}

/** Counts per box, so coming back to a step still gives a new idea. */
const tries = new Map<string, { n: number; seen: string[] }>();

export function FillButton({ box, id, context, value, onChange }: { box: IdeaBox; id: string; context: string; value: string; onChange: (text: string) => void }) {
  const level = useMotionLevel();
  const [busy, setBusy] = useState(false);
  const typing = useRef(0);
  useEffect(() => () => cancelAnimationFrame(typing.current), []);

  const fill = async () => {
    if (busy) return;
    setBusy(true);
    cue('tap');
    const t = tries.get(id) ?? { n: 0, seen: [] };
    tries.set(id, t);
    try {
      const idea = await fillIdea(box, context, value, t.n, t.seen);
      t.n++;
      t.seen.push(idea);
      cancelAnimationFrame(typing.current);
      if (level === 'off') onChange(idea);
      else {
        // The idea types itself in.
        const start = performance.now();
        const dur = Math.min(900, 240 + idea.length * 9);
        const step = (now: number) => {
          const k = Math.min(1, (now - start) / dur);
          onChange(idea.slice(0, Math.max(1, Math.round(idea.length * (1 - Math.pow(1 - k, 2))))));
          if (k < 1) typing.current = requestAnimationFrame(step);
        };
        typing.current = requestAnimationFrame(step);
      }
      cue('pop');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="mk-tool mk-fill" data-busy={busy || undefined} aria-busy={busy} aria-label="Fill for me" onClick={() => void fill()}>
      <Icon name="sparkle" size={18} />
      <span className="mk-tool-word">{busy ? 'Thinking…' : 'Fill for me'}</span>
    </button>
  );
}

/** "Choose for me" on a choice step: the orb's pick, as if tapped. */
export function ChooseButton({ context, options, onChoose }: { context: string; options: AssistOption[]; onChoose: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (!options.length) return null;
  return (
    <button
      type="button"
      className="mk-tool mk-choose"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const id = await pickFor(context, options);
          if (id && options.some((o) => o.id === id)) onChoose(id);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon name="shuffle" size={18} />
      <span className="mk-tool-word">{busy ? 'Choosing…' : 'Choose for me'}</span>
    </button>
  );
}
