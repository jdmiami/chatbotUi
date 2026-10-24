import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useMotionLevel } from '../../motion/MotionProvider';
import { springValue } from '../../motion/physics';
import { ios } from '../../motion/springs';
import type { MotionLevel } from '../../motion/level';

/**
 * A walk-through one screen at a time. Swipe left for the next step (it comes in from the right and
 * settles in the middle while this one sinks back), swipe right to go back, or use the buttons
 * named after the step they go to. The step dots at the top jump anywhere.
 *
 * The motion is a real spring that starts at the finger's speed (Motion Full), a short slide on
 * Lite, and a quick cross-fade on Off.
 */
export interface DeckStep {
  id: string;
  /** Short name for the dots and the buttons ("Describe it"). */
  name: string;
  /** The big heading on the step (defaults to the name). */
  title?: ReactNode;
  dek?: ReactNode;
  body: ReactNode;
}

/** The step change spring: settles in about half a second with a whisker of overshoot. */
const GO = ios(0.52, 0.82);
const BACK = ios(0.4, 0.9);

type Anim = { other: string; dir: 1 | -1; mode: 'drag' | 'go' };

/** Where both pages sit at progress p (0 = only the old one, 1 = only the new one). */
function poses(p: number, dir: 1 | -1, w: number, level: MotionLevel) {
  const q = Math.max(0, Math.min(1.2, p));
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  if (level === 'off') return { out: { transform: 'none', opacity: clamp01(1 - q * 2), filter: '' }, in: { transform: 'none', opacity: clamp01(q * 2 - 0.2), filter: '' } };
  if (level === 'lite') {
    return {
      out: { transform: `translate3d(${-dir * q * w * 0.25}px,0,0)`, opacity: clamp01(1 - q * 1.6), filter: '' },
      in: { transform: `translate3d(${dir * (1 - q) * w * 0.4}px,0,0)`, opacity: clamp01(q * 1.4), filter: '' },
    };
  }
  if (dir === 1) {
    // Next: the new page slides over from the right, turning slightly like a page; the old one sinks back.
    return {
      out: { transform: `translate3d(${-q * w * 0.3}px,0,0) scale(${1 - 0.08 * q})`, opacity: clamp01(1 - q * 1.5), filter: `blur(${(Math.min(1, q) * 6).toFixed(2)}px)` },
      in: {
        transform: `translate3d(${(1 - p) * w}px,0,0) perspective(1200px) rotateY(${(-(1 - q) * 14).toFixed(2)}deg) scale(${0.94 + 0.06 * Math.min(1, q)})`,
        opacity: clamp01(0.15 + q * 1.3),
        filter: `blur(${(Math.max(0, 1 - q) * 8).toFixed(2)}px)`,
      },
    };
  }
  // Back: the old page slides off to the right; the earlier one rises from behind.
  return {
    out: { transform: `translate3d(${q * w}px,0,0) perspective(1200px) rotateY(${(q * 14).toFixed(2)}deg)`, opacity: clamp01(1 - q * 0.9), filter: '' },
    in: {
      transform: `translate3d(${-(1 - p) * w * 0.3}px,0,0) scale(${0.92 + 0.08 * Math.min(1, q)})`,
      opacity: clamp01(q * 1.5),
      filter: `blur(${(Math.max(0, 1 - q) * 6).toFixed(2)}px)`,
    },
  };
}

function setPose(el: HTMLElement | null | undefined, pose: { transform: string; opacity: number; filter: string } | null) {
  if (!el) return;
  if (!pose) {
    el.style.removeProperty('transform');
    el.style.removeProperty('opacity');
    el.style.removeProperty('filter');
    return;
  }
  el.style.transform = pose.transform;
  el.style.opacity = String(pose.opacity);
  el.style.filter = pose.filter;
}

/** Can this element (or one it sits in, inside the stage) scroll sideways in the direction of the drag? */
function scrollerTakes(target: EventTarget | null, stage: HTMLElement, dx: number) {
  for (let el = target as HTMLElement | null; el && el !== stage; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === 'auto' || ox === 'scroll') {
        if (dx < 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
        if (dx > 0 && el.scrollLeft > 0) return true;
      }
    }
  }
  return false;
}

/** Gestures that start here belong to the element: typing, selecting text, sliders, players, talk buttons. */
function ownsGesture(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  if (el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], audio, video, [data-noswipe]')) return true;
  const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
  return Boolean(sel && !sel.isCollapsed && sel.toString().trim());
}

/** iOS keeps the screen edges for its own back and forward swipes. */
const EDGE = 22;

export function StepDeck({
  steps,
  current,
  onGo,
  onActivePane,
  label = 'Steps',
  footer,
}: {
  steps: DeckStep[];
  current: string;
  onGo: (id: string) => void;
  /** The page now in charge (after each change settles), for the orb to find its targets. */
  onActivePane?: (el: HTMLElement | null) => void;
  label?: string;
  /** Extra controls under the steps (beside the buttons). */
  footer?: ReactNode;
}) {
  const level = useMotionLevel();
  const levelRef = useRef(level);
  levelRef.current = level;
  const stage = useRef<HTMLDivElement>(null);
  const panes = useRef(new Map<string, HTMLElement>());
  const [base, setBase] = useState(current);
  const [anim, setAnim] = useState<Anim | null>(null);
  const animRef = useRef<Anim | null>(null);
  animRef.current = anim;
  const progress = useRef(0);
  const velocity = useRef(0);
  const running = useRef<{ stop(): void } | null>(null);

  const ids = steps.map((s) => s.id);
  const at = Math.max(0, ids.indexOf(current));
  const baseStep = steps.find((s) => s.id === base) ?? steps[at];
  const prev = at > 0 ? steps[at - 1] : null;
  const next = at < steps.length - 1 ? steps[at + 1] : null;

  const paint = useCallback((p: number) => {
    const a = animRef.current;
    const w = stage.current?.clientWidth || window.innerWidth;
    if (!a) return;
    const { out, in: inn } = poses(p, a.dir, w, levelRef.current);
    setPose(panes.current.get(base), out);
    setPose(panes.current.get(a.other), inn);
  }, [base]);

  /** Run progress to `to` (1 = finish the change, 0 = undo it), carrying the finger's speed. */
  const run = useCallback(
    (to: 0 | 1, done: () => void) => {
      running.current?.stop();
      const lv = levelRef.current;
      const from = progress.current;
      if (lv !== 'full') {
        const dur = lv === 'lite' ? 240 : 150;
        const start = performance.now();
        let raf = 0;
        const tick = (t: number) => {
          const k = Math.min(1, (t - start) / dur);
          const e = 1 - Math.pow(1 - k, 3);
          progress.current = from + (to - from) * e;
          paint(progress.current);
          if (k < 1) raf = requestAnimationFrame(tick);
          else done();
        };
        raf = requestAnimationFrame(tick);
        running.current = { stop: () => cancelAnimationFrame(raf) };
        return;
      }
      const s = springValue({
        from,
        to,
        velocity: velocity.current,
        spring: to === 1 ? GO : BACK,
        onUpdate: (v) => {
          progress.current = v;
          paint(v);
        },
      });
      running.current = s;
      void s.finished.then((finished) => finished && done());
    },
    [paint],
  );

  // The step changed (a button, a dot, a pick, or a committed swipe): play the change.
  useLayoutEffect(() => {
    if (current === base && !anim) return;
    if (current === base && anim) {
      // Back where we were (a swipe let go short, then the same step was asked for): undo.
      return;
    }
    const oldAt = ids.indexOf(base);
    const dir: 1 | -1 = oldAt === -1 || ids.indexOf(current) > oldAt ? 1 : -1;
    if (anim && anim.other === current) {
      setAnim({ ...anim, mode: 'go' });
    } else {
      progress.current = 0;
      velocity.current = 0;
      setAnim({ other: current, dir, mode: 'go' });
    }
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once the incoming page is on the page, move it.
  useLayoutEffect(() => {
    if (!anim || anim.mode !== 'go') return;
    paint(progress.current);
    run(1, () => {
      const target = anim.other;
      running.current = null;
      progress.current = 0;
      velocity.current = 0;
      setPose(panes.current.get(base), null);
      setPose(panes.current.get(target), null);
      setBase(target);
      setAnim(null);
    });
  }, [anim?.mode, anim?.other]); // eslint-disable-line react-hooks/exhaustive-deps

  // A swipe has brought the neighbour in: place it before it is seen.
  useLayoutEffect(() => {
    if (anim?.mode === 'drag') paint(levelRef.current === 'off' ? 0 : progress.current);
  }, [anim?.mode, anim?.other]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => running.current?.stop(), []);

  // The page in charge, for the orb (and for focus).
  useEffect(() => {
    if (anim) return;
    onActivePane?.(panes.current.get(base) ?? null);
  }, [base, anim, onActivePane]);

  /* ---------------------------------------------------------------- swipes */
  const drag = useRef<{ x: number; y: number; t: number; target: EventTarget | null; locked: 'x' | 'y' | null; dir: 1 | -1 | 0; lastX: number; lastT: number; v: number } | null>(null);
  const suppressClick = useRef(0);

  const begin = (x: number, y: number, target: EventTarget | null) => {
    if (animRef.current?.mode === 'go') return;
    if (x < EDGE || x > window.innerWidth - EDGE) return;
    if (ownsGesture(target)) return;
    drag.current = { x, y, t: performance.now(), target, locked: null, dir: 0, lastX: x, lastT: performance.now(), v: 0 };
  };

  /** Returns true when the move is ours (so the browser should not also act on it). */
  const move = (x: number, y: number) => {
    const d = drag.current;
    const el = stage.current;
    if (!d || !el) return false;
    const dx = x - d.x;
    const dy = y - d.y;
    const now = performance.now();
    if (!d.locked) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return false;
      if (Math.abs(dx) < Math.abs(dy) * 1.2 || scrollerTakes(d.target, el, dx)) {
        drag.current = null;
        return false;
      }
      d.locked = 'x';
      d.dir = dx < 0 ? 1 : -1;
      const neighbour = d.dir === 1 ? next : prev;
      el.dataset.swiping = 'true';
      if (neighbour) {
        progress.current = 0;
        velocity.current = 0;
        setAnim({ other: neighbour.id, dir: d.dir, mode: 'drag' });
      }
    }
    const dt = Math.max(1, now - d.lastT);
    d.v = 0.8 * ((x - d.lastX) / dt) + 0.2 * d.v;
    d.lastX = x;
    d.lastT = now;
    const w = el.clientWidth || window.innerWidth;
    const a = animRef.current;
    if (a && a.mode === 'drag') {
      progress.current = Math.max(0, Math.min(1, (-dx * a.dir) / w));
      paint(levelRef.current === 'off' ? 0 : progress.current);
    } else if (levelRef.current !== 'off') {
      // Nothing that way: the page gives a little, with resistance.
      const page = panes.current.get(base);
      if (page) page.style.transform = `translate3d(${(dx / (1 + Math.abs(dx) / 80)).toFixed(1)}px,0,0)`;
    }
    return true;
  };

  const end = () => {
    const d = drag.current;
    drag.current = null;
    const el = stage.current;
    if (!d || !d.locked || !el) return;
    delete el.dataset.swiping;
    suppressClick.current = performance.now();
    const a = animRef.current;
    const w = el.clientWidth || window.innerWidth;
    if (!a || a.mode !== 'drag') {
      const page = panes.current.get(base);
      if (page) {
        page.style.transition = 'transform 0.45s var(--spring-bouncy)';
        page.style.transform = '';
        setTimeout(() => page.style.removeProperty('transition'), 480);
      }
      return;
    }
    // Speed in "pages per second", in the direction of the change.
    const v = ((-d.v * a.dir) / w) * 1000;
    const commit = progress.current > 0.33 || v > 0.9;
    velocity.current = levelRef.current === 'full' ? Math.max(-6, Math.min(8, v)) : 0;
    if (commit) {
      onGo(a.other);
      return;
    }
    run(0, () => {
      running.current = null;
      setPose(panes.current.get(base), null);
      setPose(panes.current.get(a.other), null);
      progress.current = 0;
      velocity.current = 0;
      setAnim(null);
    });
  };
  const endRef = useRef(end);
  endRef.current = end;
  const moveRef = useRef(move);
  moveRef.current = move;
  const beginRef = useRef(begin);
  beginRef.current = begin;

  // Touch: listened to directly so a sideways swipe can stop the browser acting on it.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ts = (e: TouchEvent) => {
      if (e.touches.length !== 1) return void (drag.current = null);
      beginRef.current(e.touches[0].clientX, e.touches[0].clientY, e.target);
    };
    const tm = (e: TouchEvent) => {
      if (!drag.current) return;
      if (moveRef.current(e.touches[0].clientX, e.touches[0].clientY) && e.cancelable) e.preventDefault();
    };
    const te = () => endRef.current();
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('touchcancel', te);
    // A swipe that ends over a button is not a tap on it.
    const click = (e: MouseEvent) => {
      if (performance.now() - suppressClick.current < 350) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    el.addEventListener('click', click, true);
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('touchcancel', te);
      el.removeEventListener('click', click, true);
    };
  }, []);

  // Mouse and pen.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    beginRef.current(e.clientX, e.clientY, e.target);
    if (!drag.current) return;
    const mv = (ev: PointerEvent) => {
      if (moveRef.current(ev.clientX, ev.clientY)) ev.preventDefault();
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      endRef.current();
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // Arrow keys (an iPad keyboard), when not typing.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (ownsGesture(e.target) || e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.key === 'ArrowRight' && next) {
      e.preventDefault();
      onGo(next.id);
    } else if (e.key === 'ArrowLeft' && prev) {
      e.preventDefault();
      onGo(prev.id);
    }
  };

  const shownIds = [base, ...(anim ? [anim.other] : [])].filter((id, i, a) => a.indexOf(id) === i);
  // Which page owns the screen for reading and tapping: the one being moved to, once it is decided.
  const live = anim?.mode === 'go' ? anim.other : base;
  const total = steps.length;

  return (
    <div className="mk-deck" onKeyDown={onKeyDown}>
      <nav className="mk-dots" aria-label={label}>
        <ol>
          {steps.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className="mk-dot"
                aria-current={s.id === current ? 'step' : undefined}
                data-done={i < at || undefined}
                aria-label={`Step ${i + 1} of ${total}: ${s.name}`}
                onClick={() => s.id !== current && onGo(s.id)}
              >
                <span className="mk-dot-n" aria-hidden>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="mk-dot-name" aria-hidden>
                  {s.name}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="mk-stage" ref={stage} onPointerDown={onPointerDown} data-dir={anim?.dir === -1 ? 'back' : 'next'}>
        {shownIds.map((id) => {
          const s = steps.find((x) => x.id === id) ?? baseStep;
          if (!s) return null;
          const i = ids.indexOf(id);
          const isLive = id === live;
          const front = anim ? (anim.dir === 1 ? id === anim.other : id === base) : true;
          return (
            <section
              key={id}
              ref={(el) => {
                if (el) panes.current.set(id, el);
                else panes.current.delete(id);
              }}
              className="mk-pane"
              data-step={id}
              data-live={isLive || undefined}
              data-front={front || undefined}
              aria-labelledby={`mk-${id}-t`}
              aria-hidden={isLive ? undefined : true}
              inert={!isLive}
            >
              <header className="mk-pane-head">
                <p className="o5-kicker">
                  Step {i + 1} of {total}
                </p>
                <h3 className="o5-step-title mk-title" id={`mk-${id}-t`}>
                  {s.title ?? s.name}
                </h3>
                {s.dek && <p className="mk-dek">{s.dek}</p>}
              </header>
              <div className="mk-pane-body">{s.body}</div>
            </section>
          );
        })}
      </div>
      <div className="mk-nav">
        {prev ? (
          <button type="button" className="mk-nav-btn mk-nav-back" aria-label={`Back: ${prev.name}`} onClick={() => onGo(prev.id)}>
            <span className="mk-nav-arrow" aria-hidden>
              ←
            </span>
            <span className="mk-nav-name">{prev.name}</span>
          </button>
        ) : (
          <span className="mk-nav-gap" />
        )}
        {footer}
        {next ? (
          <button type="button" className="mk-nav-btn mk-nav-next" aria-label={`Next: ${next.name}`} onClick={() => onGo(next.id)}>
            <span className="mk-nav-name">{next.name}</span>
            <span className="mk-nav-arrow" aria-hidden>
              →
            </span>
          </button>
        ) : (
          <span className="mk-nav-gap" />
        )}
      </div>
    </div>
  );
}
