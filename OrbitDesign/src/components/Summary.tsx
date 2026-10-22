import type { ReactNode } from 'react';
import { OrbSpot } from './Sheets';

/**
 * The summary and what comes after it, as presentational pieces: the summary list, the primary
 * action, a quieter one beside it, the progress bar and the result figure. The app composes them
 * around whatever it does with the finished answers; nothing here talks to a network.
 */

/** Every answer under its name, in order (from `summaryOf`). */
export function SummaryList({ items }: { items: { key: string; value: string }[] }) {
  return (
    <dl className="st-summary">
      {items.map((b) => (
        <div key={b.key}>
          <dt>{b.key}</dt>
          <dd>{b.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The one button a screen wants pressed next, in a band that stays in reach at the foot of the
 * page, with a place for the orb on it. `children` go beside it (a Ghost button or a line of hint).
 */
export function Go({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children?: ReactNode }) {
  return (
    <div className="st-dock">
      <button type="button" className="st-go" onClick={onClick} disabled={disabled}>
        {label}
        <OrbSpot size={40} className="st-choice-spot" />
      </button>
      {children}
    </div>
  );
}

/** A second, quieter action beside the primary one ("Start again"). */
export function Ghost({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="st-ghost" onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

/**
 * While the app works: a bar (known progress in %, or a busy sweep when `progress` is null), the
 * current note and a line saying you can leave.
 */
export function Progress({
  progress,
  note,
  hint = 'You can leave this page. It keeps going, and it will be in your drafts when it is done.',
  idle = 8,
}: {
  /** 0..100, or null while nothing is known yet. */
  progress: number | null;
  note: string | null;
  hint?: string | null;
  /** The bar's width while progress is unknown. */
  idle?: number;
}) {
  return (
    <div className="st-making" role="status">
      <div className="st-bar" aria-hidden>
        <span style={{ width: `${progress ?? idle}%` }} className={progress == null ? 'st-bar-busy' : undefined} />
      </div>
      <p className="st-dek">{note ?? 'Starting…'}</p>
      {hint && <p className="st-ht">{hint}</p>}
    </div>
  );
}

/**
 * What came out: a picture (`kind: 'image'`), a video with controls (`kind: 'video'`), or anything
 * else the app renders as `children` (a list, a map, a document).
 */
export function Result({ kind, url, alt = '', children }: { kind?: 'image' | 'video'; url?: string; alt?: string; children?: ReactNode }) {
  return (
    <figure className="st-result">
      {kind === 'image' && url ? <img src={url} alt={alt} /> : kind === 'video' && url ? <video src={url} controls playsInline loop /> : children}
    </figure>
  );
}

/** One line of error, announced. */
export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p className="st-error" role="alert">
      {children}
    </p>
  );
}
