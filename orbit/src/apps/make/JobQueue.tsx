import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/components';
import type { StudioJob } from '../../services/ai/LocalAi';
import { cue } from '../../motion/feedback';

/**
 * What is being made and what waits its turn. Waiting jobs have a grip: hold it and drag up or
 * down to change the order (the others slide out of the way), or use the arrow keys on it. The
 * new order goes to the AI machine as soon as you let go.
 */

const ordinal = (n: number) => (n === 1 ? 'Next' : `${n}${n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`);
const isActive = (j: StudioJob) => j.status === 'queued' || j.status === 'running';
const waits = (j: StudioJob) => j.status === 'queued' && (j.position ?? 0) > 0;

interface Drag {
  id: string;
  from: number;
  over: number;
  dy: number;
  /** One row's height plus the gap, the distance the others slide. */
  step: number;
  startY: number;
  pointer: number;
}

export function JobQueue({
  jobs,
  line,
  onStop,
  onDismiss,
  onReorder,
}: {
  jobs: StudioJob[];
  /** One line on where a job stands (its place in line, time left). */
  line: (j: StudioJob) => string | null;
  onStop: (id: string) => void;
  onDismiss: (id: string) => void;
  /** The waiting jobs' ids in their new order; resolves when the machine has them. */
  onReorder: (ids: string[]) => Promise<void>;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  // The order you just set, shown until the machine answers.
  const [pending, setPending] = useState<string[] | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());

  const making = jobs.filter((j) => isActive(j) && !waits(j));
  let waiting = jobs.filter(waits).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  if (pending) waiting = [...waiting].sort((a, b) => idx(pending, a.id) - idx(pending, b.id));
  const done = jobs.filter((j) => !isActive(j));

  const commit = (ids: string[]) => {
    setPending(ids);
    cue('pop');
    onReorder(ids).finally(() => setPending(null));
  };
  const moveBy = (id: string, by: number) => {
    const ids = waiting.map((j) => j.id);
    const from = ids.indexOf(id);
    const to = Math.max(0, Math.min(ids.length - 1, from + by));
    if (from < 0 || to === from) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    commit(ids);
  };

  const down = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (waiting.length < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const row = rows.current.get(id);
    if (!row) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const next = rows.current.get(waiting[1]?.id ?? '') ?? rows.current.get(waiting[0]?.id ?? '');
    const first = rows.current.get(waiting[0].id)!;
    const gap = next && next !== first ? next.getBoundingClientRect().top - first.getBoundingClientRect().bottom : 8;
    const from = waiting.findIndex((j) => j.id === id);
    setDrag({ id, from, over: from, dy: 0, step: row.getBoundingClientRect().height + Math.max(0, gap), startY: e.clientY, pointer: e.pointerId });
    cue('tap');
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const dy = e.clientY - drag.startY;
    const over = Math.max(0, Math.min(waiting.length - 1, drag.from + Math.round(dy / drag.step)));
    if (over !== drag.over) cue('tap');
    setDrag({ ...drag, dy, over });
  };
  const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const { from, over } = drag;
    setDrag(null);
    if (over === from) return;
    const ids = waiting.map((j) => j.id);
    ids.splice(over, 0, ...ids.splice(from, 1));
    commit(ids);
  };
  const keys = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      moveBy(id, e.key === 'ArrowUp' ? -1 : 1);
    }
  };

  /** Where a waiting row sits while one is dragged: the dragged one follows the finger, the rest make room. */
  const shift = (i: number): CSSProperties | undefined => {
    if (!drag) return undefined;
    if (i === drag.from) return { transform: `translateY(${drag.dy}px) scale(1.02)`, transition: 'none', zIndex: 2 };
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return { transform: `translateY(${-drag.step}px)` };
    if (drag.from > drag.over && i >= drag.over && i < drag.from) return { transform: `translateY(${drag.step}px)` };
    return undefined;
  };

  const row = (j: StudioJob, opts: { i?: number } = {}) => {
    const waitingRow = opts.i !== undefined;
    // Until the machine answers, the place in line is the one you just gave it.
    const text = waitingRow && pending ? `${ordinal(opts.i! + 1)} in line` : line(j);
    return (
      <li
        key={j.id}
        ref={(el) => {
          if (el) rows.current.set(j.id, el);
          else rows.current.delete(j.id);
        }}
        className={`ai-job ai-job-${j.status}`}
        data-dragging={drag?.id === j.id || undefined}
        style={waitingRow ? shift(opts.i!) : undefined}
      >
        <span className="ai-job-art" data-live={isActive(j)} aria-hidden>
          <Icon name={j.kind === 'image' ? 'image' : 'film'} size={18} />
        </span>
        <div className="ai-job-text">
          <span className="ai-list-title">{j.prompt}</span>
          {j.status === 'error' ? (
            <span className="ai-error">{j.error}</span>
          ) : (
            !waitingRow && (
              <div className="ai-bar" aria-label={`${j.progress}%`}>
                <span style={{ width: `${Math.max(3, j.progress)}%` }} />
              </div>
            )
          )}
          {text && (
            <span className="ai-job-line" data-slow={j.slow || undefined}>
              {text}
            </span>
          )}
          {(j.notes?.length ?? 0) > 0 && <span className="ai-job-notes">{j.notes!.slice(-2).join(' ')}</span>}
        </div>
        {waitingRow && waiting.length > 1 && (
          <button
            type="button"
            className="ai-job-grip"
            aria-label={`Move “${j.prompt.slice(0, 40)}”: drag up or down, or use the arrow keys`}
            onPointerDown={(e) => down(e, j.id)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onKeyDown={(e) => keys(e, j.id)}
          >
            <Icon name="grip" size={20} strokeWidth={3.2} />
          </button>
        )}
        {isActive(j) ? <IconButton icon="stop" label="Stop" onClick={() => onStop(j.id)} /> : <IconButton icon="close" label="Dismiss" onClick={() => onDismiss(j.id)} />}
      </li>
    );
  };

  if (!jobs.length) return null;
  return (
    <div className="ai-queue">
      {making.length + done.length > 0 && (
        <ul className="ai-jobs" aria-label="In progress">
          {making.map((j) => row(j))}
          {done.map((j) => row(j))}
        </ul>
      )}
      {waiting.length > 0 && (
        <>
          <p className="o5-kicker ai-queue-head">
            Next in line{waiting.length > 1 && <span className="ai-queue-hint"> · hold ⠿ and drag to change the order</span>}
          </p>
          <ul className="ai-jobs ai-queue-list" aria-label="Next in line" data-dragging={drag ? '' : undefined}>
            {waiting.map((j, i) => row(j, { i }))}
          </ul>
        </>
      )}
    </div>
  );
}

function idx(list: string[], id: string) {
  const i = list.indexOf(id);
  return i < 0 ? list.length : i;
}
