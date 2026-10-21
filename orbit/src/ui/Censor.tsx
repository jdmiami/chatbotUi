import { useCallback, useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import { useShell } from '../state/shell';
import { Toggle } from './components';
import { nsfwFor, setMark, useNsfwFlags } from './nsfwFlags';

/**
 * NSFW pictures and videos: no blur anywhere. They are hidden (galleries, the Lab, soReal, the chat)
 * until you turn on "Show NSFW", which shows them with everything else, as they are. Words are never blurred.
 *
 * Give a picture its item id (`markId`) and your own say comes in: a long hold on one that is showing
 * marks it NSFW (so it hides); the viewer's "NSFW" switch marks or unmarks one.
 */
/** How long to hold a picture to mark it NSFW. */
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
      <span className="ai-muted">{view === 'show' ? 'Show NSFW: on' : 'NSFW is hidden'}</span>
      <Toggle checked={view === 'show'} label="Show NSFW" onChange={(on) => updateSettings({ nsfwView: on ? 'show' : 'hide' })} />
    </div>
  );
}

/**
 * What used to blur. Now it only shows what it wraps; on a picture with `markId` in the usual view,
 * a long hold marks it NSFW (and so hides it). `nsfw`/`text` are kept so callers stay as they are.
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
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const markable = view === 'hide' && !text && Boolean(markId) && !nsfwFor(markId, nsfw);
  if (!markable) return <Tag className={className}>{children}</Tag>;

  const onDown = (e: PointerEvent) => {
    if (e.button > 0) return;
    held.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    clear();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      held.current = true;
      navigator.vibrate?.(15);
      setMark(markId!, true);
      toast('Marked NSFW and hidden. Turn on "Show NSFW" to see it.', 'info');
    }, MARK_MS);
  };
  const onMove = (e: PointerEvent) => {
    const s0 = start.current;
    if (s0 && Math.hypot(e.clientX - s0.x, e.clientY - s0.y) > 10) clear();
  };
  // A hold never counts as a tap (a tile opens the viewer on tap).
  const onClickCapture = (e: React.MouseEvent) => {
    if (!held.current) return;
    e.preventDefault();
    e.stopPropagation();
    held.current = false;
  };
  return (
    <Tag
      className={['censor-markable', className].filter(Boolean).join(' ')}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={clear}
      onPointerCancel={clear}
      onPointerLeave={clear}
      onClickCapture={onClickCapture}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </Tag>
  );
}
