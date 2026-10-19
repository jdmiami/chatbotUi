import type { ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Pieces for pages that read like the home screen (Orbit 0.5's magazine): a cover, numbered
 * chapters that sink back as they scroll away (inside a Sheet with `page`), and a contents line
 * that jumps between them. In the classic look they are plain headed sections.
 */
export function MagCover({ kicker, title, dek, children }: { kicker: ReactNode; title: ReactNode; dek?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mag-cover" data-depth>
      <p className="o5-kicker">{kicker}</p>
      <h2 className="mag-title">{title}</h2>
      {dek && <p className="mag-dek">{dek}</p>}
      {children}
    </header>
  );
}

export function MagContents({ chapters }: { chapters: { id: string; title: string }[] }) {
  return (
    <nav className="mag-contents" aria-label="Contents">
      {chapters.map((c, i) => (
        <button key={c.id} type="button" onClick={() => document.getElementById(c.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <span className="mag-contents-n">{String(i + 1).padStart(2, '0')}</span> {c.title}
          <Icon name="down" size={14} />
        </button>
      ))}
    </nav>
  );
}

export function MagChapter({ n, id, title, dek, children }: { n: number; id: string; title: string; dek?: ReactNode; children: ReactNode }) {
  const num = String(n).padStart(2, '0');
  return (
    <section className="mag-chapter" id={id} data-depth aria-labelledby={`${id}-t`}>
      <span className="mag-numeral" aria-hidden>
        {num}
      </span>
      <p className="o5-kicker">
        {num} <span aria-hidden>—</span> {title}
      </p>
      <h3 className="mag-head" id={`${id}-t`}>
        {title}
      </h3>
      {dek && <p className="mag-dek">{dek}</p>}
      {children}
    </section>
  );
}
