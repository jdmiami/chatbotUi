import { useShell } from '../state/shell';

/** Transient status messages. Announced politely to screen readers. */
export function Toasts() {
  const { toasts, dismissToast } = useShell();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast glass"
          style={
            t.tone === 'error'
              ? { borderColor: 'var(--danger)', color: 'var(--danger)' }
              : t.tone === 'success'
                ? { borderColor: 'var(--success)' }
                : undefined
          }
          onClick={() => dismissToast(t.id)}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
