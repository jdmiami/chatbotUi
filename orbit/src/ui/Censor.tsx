import { useCallback, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useShell } from '../state/shell';

/**
 * The censor: with the setting on, pictures and videos are blurred. Press and hold one to see it;
 * let go and it blurs again. Wrap any picture or video in this. The setting lives in the shell, so
 * it covers the gallery, the viewer, the Lab and soReal at once.
 */
const HOLD_MS = 180;

export function useCensor(): boolean {
  return useShell((s) => Boolean(s.settings.censor));
}

export function Censor({ children, className, as: Tag = 'span' }: { children: ReactNode; className?: string; as?: 'span' | 'div' }) {
  const on = useCensor();
  const [revealed, setRevealed] = useState(false);
  const timer = useRef<number | null>(null);
  const held = useRef(false);

  const clear = useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const hide = useCallback(() => {
    clear();
    setRevealed(false);
  }, [clear]);

  const onPointerDown = (e: PointerEvent) => {
    if (!on || e.button > 0) return;
    held.current = false;
    clear();
    timer.current = window.setTimeout(() => {
      held.current = true;
      setRevealed(true);
    }, HOLD_MS);
  };
  // A hold must not also count as a tap (a tile opens the viewer on tap).
  const onClickCapture = (e: React.MouseEvent) => {
    if (!on || !held.current) return;
    e.preventDefault();
    e.stopPropagation();
    held.current = false;
  };

  if (!on) return <Tag className={className}>{children}</Tag>;
  return (
    <Tag
      className={['censor', className].filter(Boolean).join(' ')}
      data-censored=""
      data-revealed={revealed ? '' : undefined}
      onPointerDown={onPointerDown}
      onPointerUp={hide}
      onPointerCancel={hide}
      onPointerLeave={hide}
      onClickCapture={onClickCapture}
      onContextMenu={(e) => e.preventDefault()}
      title={revealed ? undefined : 'Press and hold to see it'}
    >
      {children}
      {!revealed && (
        <span className="censor-hint" aria-hidden>
          Hold to see
        </span>
      )}
    </Tag>
  );
}
