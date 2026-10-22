import { useEffect, type ReactNode } from 'react';
import { SqIcon, type IconName } from './icons';

/**
 * Drawers slide in from the right over a blur: the gallery (with its shelves as tabs) and the
 * options. Extracted from Orbit's StudioApp (Gallery, Options) as one generic Drawer plus the shelf
 * pieces it was filled with. Escape and the scrim close it.
 */

export interface DrawerTab<T extends string = string> {
  id: T;
  label: string;
  icon: IconName;
}

export function Drawer<T extends string = string>({
  label,
  title,
  onClose,
  closeLabel = 'Close',
  scrimLabel = 'Close',
  tabs,
  tab,
  onTab,
  tabsLabel = 'Shelves',
  children,
}: {
  /** The dialog's accessible name ("After Dark: your gallery"). */
  label: string;
  /** The heading; put the italic half in <em> (e.g. <>Your <em>gallery</em></>). */
  title: ReactNode;
  onClose: () => void;
  closeLabel?: string;
  scrimLabel?: string;
  /** Shelves across the top; omit for a plain drawer. */
  tabs?: DrawerTab<T>[];
  tab?: T;
  onTab?: (id: T) => void;
  tabsLabel?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="st-drawer-wrap" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" className="st-scrim" aria-label={scrimLabel} onClick={onClose} />
      <aside className="st-drawer">
        <div className="st-drawer-head">
          <h3>{title}</h3>
          <button type="button" className="st-sq st-sq-ink" aria-label={closeLabel} onClick={onClose}>
            <SqIcon name="close" />
          </button>
        </div>
        {tabs && (
          <nav className="st-tabs" aria-label={tabsLabel}>
            {tabs.map((s) => (
              <button key={s.id} type="button" aria-pressed={tab === s.id} onClick={() => onTab?.(s.id)}>
                <SqIcon name={s.icon} framed />
                <span>{s.label}</span>
              </button>
            ))}
          </nav>
        )}
        {tabs ? <div className="st-shelf">{children}</div> : children}
      </aside>
    </div>
  );
}

/** The gallery's five shelves, as Orbit had them. */
export type Shelf = 'projects' | 'pictures' | 'videos' | 'movies' | 'characters';
export const SHELVES: DrawerTab<Shelf>[] = [
  { id: 'projects', label: 'Projects', icon: 'project' },
  { id: 'pictures', label: 'Pictures', icon: 'picture' },
  { id: 'videos', label: 'Videos', icon: 'video' },
  { id: 'movies', label: 'Movies', icon: 'movie' },
  { id: 'characters', label: 'Characters', icon: 'character' },
];

/** "Nothing here yet." */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="st-empty">{children}</p>;
}

/** A numbered contents list inside a shelf (the gallery's Projects shelf). Rows arrive without motion here. */
export function ContentsList({ rows, label }: { rows: { id: string; title: string; meta: string; onClick: () => void }[]; label?: string }) {
  return (
    <ol className="st-contents" aria-label={label}>
      {rows.map((r, i) => (
        <li key={r.id}>
          <button type="button" className="st-row" onClick={r.onClick}>
            <span className="st-row-n" aria-hidden>
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="st-row-t">{r.title}</span>
            <span className="st-row-m">{r.meta}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Pictures and videos, two across, 3:4. */
export function MediaGrid({ items }: { items: { id: string; kind: 'image' | 'video'; url: string; alt?: string }[] }) {
  return (
    <ul className="st-grid">
      {items.map((i) => (
        <li key={i.id}>{i.kind === 'image' ? <img src={i.url} alt={i.alt ?? ''} loading="lazy" /> : <video src={i.url} muted playsInline loop controls preload="metadata" />}</li>
      ))}
    </ul>
  );
}

/** The options drawer as Orbit had it: the house rules and one line about the orb. */
export function OptionsDrawer({ rules, note = 'Tap the orb any time to ask it something, or hold it to talk.', onClose }: { rules: string[]; note?: string; onClose: () => void }) {
  return (
    <Drawer
      label="Options"
      title={
        <>
          House <em>rules</em>
        </>
      }
      onClose={onClose}
      scrimLabel="Close options"
    >
      <ul className="st-rules">
        {rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="st-dek">{note}</p>
    </Drawer>
  );
}
