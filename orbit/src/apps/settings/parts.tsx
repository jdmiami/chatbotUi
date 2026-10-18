import { useId, type ReactNode } from 'react';

/** The id a chapter's section gets (the 0.5 contents page scrolls to it). */
export const chapterId = (title: string) => `st-${title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '')}`;

export function Section({ title, children, caption }: { title: string; children: ReactNode; caption?: ReactNode }) {
  const id = useId();
  return (
    <section className="st-section" id={chapterId(title)} aria-labelledby={id}>
      <h2 className="list-title st-heading" id={id}>
        {title}
      </h2>
      {children}
      {caption && <p className="list-caption st-caption">{caption}</p>}
    </section>
  );
}
