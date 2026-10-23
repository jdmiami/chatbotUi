/** Orbit 0.5: one step of an app's walk-through. */
export function Step({ n, id, title, children }: { n: string; id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="o5-step" id={id} aria-labelledby={`${id}-t`}>
      <p className="o5-kicker">{n}</p>
      <h3 className="o5-step-title" id={`${id}-t`}>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The next step glides into view once this one is answered. */
export function nextStep(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
