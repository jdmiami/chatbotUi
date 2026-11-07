import { useEffect, useRef, useState } from 'react';

/**
 * Flipbook's menu bar, along the top like a Mac app: File, Edit, View, Frame, Character, Play, Help.
 * Each opens a list under it; a tap anywhere else (or Escape) closes it. The flipbook's name and
 * whether it is saved sit at the right.
 */
export type MenuItem =
  | { label: string; onSelect: () => void; disabled?: boolean; checked?: boolean; hint?: string; danger?: boolean }
  | 'sep';
export interface Menu {
  label: string;
  items: MenuItem[];
}

export function MenuBar({ menus, title, status, onTitle }: { menus: Menu[]; title: string; status: string; onTitle: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key);
    };
  }, [open]);

  // The open list takes focus on its first item, for keyboards and VoiceOver.
  useEffect(() => {
    if (open === null) return;
    (root.current?.querySelector('[role="menu"] [role^="menuitem"]:not([disabled])') as HTMLElement | null)?.focus();
  }, [open]);

  return (
    <div className="fb-menubar" ref={root}>
      <div role="menubar" aria-label="Flipbook menu" className="fb-menus">
        {menus.map((m, k) => (
          <div key={m.label} className="fb-menu">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open === k}
              className="fb-menu-btn"
              onClick={() => setOpen(open === k ? null : k)}
              onPointerEnter={(e) => e.pointerType === 'mouse' && open !== null && open !== k && setOpen(k)}
            >
              {m.label}
            </button>
            {open === k && (
              <div role="menu" aria-label={m.label} className="fb-menu-list">
                {m.items.map((it, i) =>
                  it === 'sep' ? (
                    <hr key={`s${i}`} className="fb-menu-sep" />
                  ) : (
                    <button
                      key={it.label}
                      type="button"
                      role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                      aria-checked={it.checked}
                      className="fb-menu-item"
                      data-danger={it.danger || undefined}
                      disabled={it.disabled}
                      onClick={() => {
                        setOpen(null);
                        it.onSelect();
                      }}
                    >
                      <span className="fb-menu-check" aria-hidden>
                        {it.checked ? '✓' : ''}
                      </span>
                      <span className="fb-menu-label">{it.label}</span>
                      {it.hint && <span className="fb-menu-hint">{it.hint}</span>}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="fb-title" onClick={onTitle} aria-label={`${title}. ${status}. Rename`}>
        <span className="fb-title-name">{title}</span>
        <span className="fb-title-status" aria-live="polite">
          {status}
        </span>
      </button>
    </div>
  );
}
