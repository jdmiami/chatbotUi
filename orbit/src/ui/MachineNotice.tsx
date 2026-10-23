import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * A "your machine is off — turn it on" message that can be put away. Hide folds it into a small
 * pill ("AI machine off · Show") that brings it back; the choice is remembered per message on this
 * device, so a hidden one stays hidden next time too.
 */
const key = (id: string) => `orbit.notice.${id}`;

function wasHidden(id: string) {
  try {
    return localStorage.getItem(key(id)) === 'hidden';
  } catch {
    return false;
  }
}

export function MachineNotice({ id, label, children }: { id: string; label: string; children?: ReactNode }) {
  const [hidden, setHidden] = useState(() => wasHidden(id));
  const set = (h: boolean) => {
    setHidden(h);
    try {
      if (h) localStorage.setItem(key(id), 'hidden');
      else localStorage.removeItem(key(id));
    } catch {
      /* private mode: remembered for this visit only */
    }
  };
  if (hidden) {
    return (
      <button type="button" className="notice-pill" onClick={() => set(false)} aria-expanded="false">
        <span className="notice-dot" aria-hidden />
        {label}
        <span className="notice-pill-act">Show</span>
      </button>
    );
  }
  return (
    <div className="notice-wrap">
      {children}
      <button type="button" className="notice-hide" onClick={() => set(true)} aria-label="Hide this message" aria-expanded="true">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
