/** Orbit 0.5: one step of an app's walk-through (in the classic look it adds nothing). */
export function Step({ on, n, id, title, children }: { on: boolean; n: string; id: string; title: string; children: React.ReactNode }) {
  if (!on) return <>{children}</>;
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

/** The next step glides into view once this one is answered (nothing in the classic look). */
export function nextStep(on: boolean, id: string) {
  if (!on) return;
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
