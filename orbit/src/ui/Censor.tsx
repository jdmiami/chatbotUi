import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useShell } from '../state/shell';
import { Toggle } from './components';
import { nsfwFor, setMark, useNsfwFlags } from './nsfwFlags';

/**
 * NSFW pictures and videos, two layers:
 *  1. hidden (galleries, the Lab, soReal, the chat) until you turn on "Show NSFW";
 *  2. even then, blurred: keep a finger on one to see it (a video plays while you hold it, and
 *     pauses and blurs again the moment you let go). NSFW words get a lighter blur the same way.
 *
 * Give a picture its item id (`markId`) and your own say comes in: a long hold on a clear one marks
 * it NSFW (it hides, or blurs while "Show NSFW" is on); the viewer's "NSFW" switch marks or unmarks one.
 */
const HOLD_MS = 160;
/** How long to hold a clear picture to mark it NSFW. */
export const MARK_MS = 650;

export type NsfwView = 'hide' | 'show';

/** 'hide' (the usual: NSFW stays hidden) until you turn on "Show NSFW". */
export function useNsfwView(): NsfwView {
  return useShell((s) => (s.settings.nsfwView === 'show' ? 'show' : 'hide'));
}

/** Whether something NSFW (or not) shows in this view. */
export const shows = (nsfw: boolean, view: NsfwView) => view === 'show' || !nsfw;

/** The one switch, wherever results are listed. */
export function UncensoredSwitch() {
  const view = useNsfwView();
  const updateSettings = useShell((s) => s.updateSettings);
  return (
    <div className="uncensored-switch">
      <span className="ai-muted">{view === 'show' ? 'Show NSFW: on, blurred until held (off again next time you open Orbit)' : 'NSFW is hidden'}</span>
      <Toggle checked={view === 'show'} label="Show NSFW" onChange={(on) => updateSettings({ nsfwView: on ? 'show' : 'hide' })} />
    </div>
  );
}

/**
 * `nsfw`: blur this one (its words, the check). `markId`: the gallery item it shows, so your own say
 * counts (and, on a picture, a long hold marks it). `text`: a lighter blur for words (prompts, captions, replies).
 */
export function Censor({
  children,
  className,
  as: Tag = 'span',
  text = false,
  nsfw,
  markId,
}: {
  children: ReactNode;
  className?: string;
  as?: 'span' | 'div';
  text?: boolean;
  nsfw: boolean;
  markId?: string | null;
}) {
  useNsfwFlags();
  const view = useNsfwView();
  const toast = useShell((s) => s.toast);
  const on = markId ? nsfwFor(markId, nsfw) : nsfw;
  const [revealed, setRevealed] = useState(false);
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLElement | null>(null);

  const videos = () => Array.from(box.current?.querySelectorAll('video') ?? []);

  const clear = useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const hide = useCallback(() => {
    clear();
    setRevealed(false);
    // Lifting the finger pauses the video as it blurs.
    for (const v of videos()) v.pause();
  }, [clear]);

  // Never left playing behind the blur (the item just became NSFW).
  useEffect(() => {
    if (on) for (const v of videos()) v.pause();
  }, [on]);
  useEffect(() => clear, [clear]);

  // A clear picture: hold it to mark it NSFW (a scroll or a short tap does nothing).
  const markable = !on && !text && Boolean(markId);
  const onMarkDown = (e: PointerEvent) => {
    if (e.button > 0) return;
    held.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    clear();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      held.current = true;
      navigator.vibrate?.(15);
      setMark(markId!, true);
      toast(view === 'show' ? 'Marked NSFW: blurred, and hidden when "Show NSFW" is off.' : 'Marked NSFW and hidden. Turn on "Show NSFW" to see it.', 'info');
    }, MARK_MS);
  };
  const onMarkMove = (e: PointerEvent) => {
    const s0 = start.current;
    if (s0 && Math.hypot(e.clientX - s0.x, e.clientY - s0.y) > 10) clear();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!on || e.button > 0) return;
    held.current = false;
    clear();
    timer.current = window.setTimeout(() => {
      held.current = true;
      setRevealed(true);
      // Holding plays the video (muted autoplay rules don't apply: this is a touch).
      for (const v of videos()) void v.play().catch(() => {});
    }, HOLD_MS);
  };
  // A hold never counts as a tap (a tile opens the viewer on tap).
  const onClickCapture = (e: React.MouseEvent) => {
    if (!held.current) return;
    e.preventDefault();
    e.stopPropagation();
    held.current = false;
  };

  if (markable)
    return (
      <Tag
        ref={(el: HTMLElement | null) => void (box.current = el)}
        className={['censor-markable', className].filter(Boolean).join(' ')}
        onPointerDown={onMarkDown}
        onPointerMove={onMarkMove}
        onPointerUp={clear}
        onPointerCancel={clear}
        onPointerLeave={clear}
        onClickCapture={onClickCapture}
        onContextMenu={(e) => e.preventDefault()}
      >
        {children}
      </Tag>
    );
  if (!on) return <Tag className={className}>{children}</Tag>;
  return (
    <Tag
      ref={(el: HTMLElement | null) => void (box.current = el)}
      className={['censor', text && 'censor-text', className].filter(Boolean).join(' ')}
      data-censored=""
      data-revealed={revealed ? '' : undefined}
      onPointerDown={onPointerDown}
      onPointerUp={hide}
      onPointerCancel={hide}
      onPointerLeave={hide}
      onClickCapture={onClickCapture}
      onContextMenu={(e) => e.preventDefault()}
      title={revealed ? undefined : 'NSFW: keep your finger on it to see it'}
    >
      {children}
      {!revealed && (
        <span className="censor-hint" aria-hidden>
          {text ? 'NSFW · hold to read' : 'NSFW · hold to see'}
        </span>
      )}
    </Tag>
  );
}
