import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useShell } from '../state/shell';

/**
 * The NSFW blur. A picture or video marked `nsfw` (and the words that go with it) is blurred while
 * the setting is on, which it is unless you turn it off. Keep a finger on it to see it: a video
 * plays while you hold it, and the moment you let go it pauses and blurs again. Anything not marked
 * NSFW is shown as is.
 */
const HOLD_MS = 160;

/** On unless you turned it off in Create. */
export function useCensor(): boolean {
  return useShell((s) => s.settings.censor !== false);
}

/** `nsfw`: blur this one. `text`: a lighter blur for words (prompts, captions, replies). */
export function Censor({
  children,
  className,
  as: Tag = 'span',
  text = false,
  nsfw,
}: {
  children: ReactNode;
  className?: string;
  as?: 'span' | 'div';
  text?: boolean;
  nsfw: boolean;
}) {
  const on = useCensor() && nsfw;
  const [revealed, setRevealed] = useState(false);
  const timer = useRef<number | null>(null);
  const held = useRef(false);
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
    if (!on || !held.current) return;
    e.preventDefault();
    e.stopPropagation();
    held.current = false;
  };

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
