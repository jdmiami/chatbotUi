import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useShell } from '../state/shell';
import { nsfwFor, setMark, useNsfwFlags } from './nsfwFlags';

/**
 * The NSFW blur. A picture or video marked `nsfw` (and the words that go with it) is blurred while
 * the setting is on, which it is unless you turn it off. Keep a finger on it to see it: a video
 * plays while you hold it, and the moment you let go it pauses and blurs again. Anything not marked
 * NSFW is shown as is.
 *
 * Give it the item's id (`markId`) and your own say comes in: a long hold on a picture that isn't
 * blurred blurs it (the check missed it), and the viewer's switch unblurs one that shouldn't be.
 */
const HOLD_MS = 160;
/** How long to hold a clear picture to blur it. */
export const MARK_MS = 650;

/** On unless you turned it off in Create. */
export function useCensor(): boolean {
  return useShell((s) => s.settings.censor !== false);
}

/**
 * `nsfw`: blur this one (its words, the check). `markId`: the gallery item it shows, so your own say
 * counts (and, on a picture, a long hold blurs it). `text`: a lighter blur for words (prompts, captions, replies).
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
  const censor = useCensor();
  const on = censor && (markId ? nsfwFor(markId, nsfw) : nsfw);
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

  // Never left playing behind the blur (the setting turned on, or the item became NSFW).
  useEffect(() => {
    if (on) for (const v of videos()) v.pause();
  }, [on]);
  useEffect(() => clear, [clear]);

  // A clear picture: hold it to blur it (only while the blur is on; a scroll or a short tap does nothing).
  const markable = censor && !on && !text && Boolean(markId);
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
