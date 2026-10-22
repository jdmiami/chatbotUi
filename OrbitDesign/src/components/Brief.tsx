import type { ReactNode } from 'react';
import type { Scene } from '../walkthrough/defs';
import { OrbSpot } from './Sheets';

/**
 * The brief and the making, as presentational pieces: the brief list, the primary action, the
 * progress bar, the storyboard grid and the result figure. Orbit's Make.tsx composed these around
 * its own machine (waking it, polling jobs); that part is the app's. Nothing here talks to a network.
 * See docs/06-components.md for how Make put them together, and the orb notes it sent.
 */

/** What the phases of a film are called on screen (Orbit's Make.tsx PHASE table). */
export const PHASE: Record<string, string> = {
  draft: 'Getting ready',
  story: 'Writing the story',
  lead: 'Casting the lead',
  storyboard: 'Drawing the storyboard',
  review: 'Storyboard ready for you',
  shots: 'Filming the scenes',
  final: 'Cutting the film',
  done: 'Finished',
  stopped: 'Stopped',
  error: 'Stopped',
};

/** Every answer under its name, in order. */
export function BriefList({ items }: { items: { key: string; value: string }[] }) {
  return (
    <dl className="st-brieflist">
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
 * The one button a screen wants pressed next, with a place for the orb on it. `children` go beside
 * it (a ghost button or a line of hint). `review` adds the storyboard check's class.
 */
export function Go({ label, onClick, disabled, review = false, children }: { label: string; onClick: () => void; disabled?: boolean; review?: boolean; children?: ReactNode }) {
  return (
    <div className={review ? 'st-review-go st-script-go' : 'st-script-go'}>
      <button type="button" className="st-go" onClick={onClick} disabled={disabled}>
        {label}
        <OrbSpot size={40} className="st-choice-spot" />
      </button>
      {children}
    </div>
  );
}

/** A second, quieter action beside the primary one ("Rewrite it all with the writer"). */
export function Ghost({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="st-ghost" onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

/**
 * While it is being made: a bar (known progress in %, or a busy sweep when `progress` is null), the
 * current note and a line saying you can leave.
 */
export function Making({
  progress,
  note,
  hint = 'You can leave this page. It keeps going, and it will be in your gallery when it is done.',
  idle = 8,
}: {
  /** 0..100, or null while nothing is known yet. */
  progress: number | null;
  note: string | null;
  hint?: string | null;
  /** The bar's width while progress is unknown (Orbit: 8, or 20 once a film has started). */
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

export interface Frame {
  id: string;
  /** Null while it is still being drawn. */
  url: string | null;
}

/** "Opening", "Scene 1 ends", … */
export const frameName = (i: number) => (i === 0 ? 'Opening' : `Scene ${i} ends`);

/** The storyboard check: one picture where each scene starts and ends. Tap pictures to mark them for redrawing. */
export function Storyboard({
  frames,
  selected,
  onToggle,
  dek = 'Where each scene starts and ends. Tap a picture to draw it again.',
  nameOf = frameName,
}: {
  frames: Frame[];
  /** The ids marked to be drawn again. */
  selected: Set<string>;
  onToggle: (id: string) => void;
  dek?: string | null;
  nameOf?: (i: number) => string;
}) {
  return (
    <>
      {dek && <p className="st-dek">{dek}</p>}
      <ol className="st-frames" aria-label="Storyboard">
        {frames.map((f, i) => (
          <li key={f.id}>
            {f.url ? (
              <button type="button" aria-pressed={selected.has(f.id)} onClick={() => onToggle(f.id)}>
                <img src={f.url} alt={nameOf(i)} />
                <span className="st-num">{nameOf(i)}</span>
              </button>
            ) : (
              <>
                <span className="st-frame-wait" aria-hidden />
                <span className="st-num">{nameOf(i)} · drawing</span>
              </>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

/** What came out: the picture, or the video with controls. */
export function Result({ kind, url, alt }: { kind: 'image' | 'video'; url: string; alt: string }) {
  return <figure className="st-result">{kind === 'image' ? <img src={url} alt={alt} /> : <video src={url} controls playsInline loop />}</figure>;
}

/** The script, read-only, under the brief (as Make showed it before filming). */
export function ScriptPreview({ scenes }: { scenes: Scene[] }) {
  return (
    <ol className="st-scenes" aria-label="The script">
      {scenes.map((s, i) => (
        <li key={s.id} className="st-scene">
          <p className="o5-kicker st-scene-head">
            <span>Scene {String(i + 1).padStart(2, '0')}</span>
            <span>{s.heading}</span>
          </p>
          <p className="st-action">{s.action}</p>
          {s.says && <p className="st-says">{s.says}</p>}
        </li>
      ))}
    </ol>
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
