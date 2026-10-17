import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { animate } from 'motion/mini';
import { SPRING } from '../motion/springs';
import { useMotionLevel } from '../motion/MotionProvider';
import { Icon, type IconName } from './Icon';

/** Icon-only button. `label` is required: it becomes the accessible name and the tooltip. */
export function IconButton({
  icon,
  label,
  pressed,
  className = '',
  iconSize,
  ...rest
}: { icon: IconName; label: string; pressed?: boolean; iconSize?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}

/** "Simulated" / "Demo" disclosure chip. Use in every app header while on demo services. */
export function DemoChip({ text = 'Simulated', title }: { text?: string; title?: string }) {
  return (
    <span className="chip demo" title={title ?? 'This is demo behaviour, not your Linux machine.'}>
      <span className="dot" aria-hidden />
      {text}
    </span>
  );
}

/**
 * Standard app header bar. Pads for the notch/status bar via safe-area insets.
 * Put primary actions in `actions`; `leading` is for a back button or sidebar toggle.
 */
export function AppHeader({
  title,
  subtitle,
  leading,
  actions,
  chip,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  chip?: ReactNode;
}) {
  return (
    <header className="app-header">
      {leading}
      <div className="title-block">
        <div className="row-inline" style={{ flexWrap: 'nowrap', minWidth: 0 }}>
          <h1>{title}</h1>
          {chip}
        </div>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

/**
 * Modal sheet: bottom sheet on phones, centred card on tablets.
 * Traps focus loosely (focuses the sheet on open, restores focus on close), closes on Escape and scrim tap.
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  labelledBy,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const titleId = labelledBy ?? `sheet-title-${autoId}`;
  const level = useMotionLevel();
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /** Close with a short exit animation (sliding down from `fromY`), then tell the parent. */
  const close = useCallback(
    (fromY = 0, travel = 48) => {
      if (closing.current) return;
      closing.current = true;
      const sheet = ref.current;
      if (!sheet || level === 'off') return onCloseRef.current();
      const done = () => onCloseRef.current();
      if (scrim.current) animate(scrim.current, { opacity: [1, 0] }, { duration: 0.2 });
      animate(
        sheet,
        { transform: [`translateY(${fromY}px)`, `translateY(${fromY + travel}px)`], opacity: [1, 0] },
        { duration: level === 'full' ? 0.22 : 0.15, ease: 'easeIn' },
      ).then(done, done);
    },
    [level],
  );

  /** Drag the handle or title down to dismiss. Past a short distance (or a quick flick) it closes; otherwise it springs back. */
  const grab = useRef<{ id: number; y0: number; last: number; t: number; v: number; dy: number } | null>(null);
  const onGripDown = (e: React.PointerEvent) => {
    if (level === 'off' || e.button > 0 || (e.target as HTMLElement).closest('button')) return;
    grab.current = { id: e.pointerId, y0: e.clientY, last: e.clientY, t: e.timeStamp, v: 0, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    ref.current?.getAnimations().forEach((a) => a.cancel());
  };
  const onGripMove = (e: React.PointerEvent) => {
    const g = grab.current;
    if (!g || g.id !== e.pointerId || !ref.current) return;
    const raw = e.clientY - g.y0;
    // Rubber band: a little give upwards, normal travel downwards.
    g.dy = raw < 0 ? raw * 0.06 : raw;
    const dt = Math.max(1, e.timeStamp - g.t);
    g.v = (e.clientY - g.last) / dt;
    g.last = e.clientY;
    g.t = e.timeStamp;
    ref.current.style.transform = `translateY(${g.dy}px)`;
  };
  const onGripUp = (e: React.PointerEvent) => {
    const g = grab.current;
    grab.current = null;
    const sheet = ref.current;
    if (!g || !sheet) return;
    if (g.dy > 110 || g.v > 0.7) return close(g.dy, 600);
    animate(sheet, { transform: [`translateY(${g.dy}px)`, 'translateY(0px)'] }, SPRING.bouncy as never).then(
      () => sheet.style.removeProperty('transform'),
      () => sheet.style.removeProperty('transform'),
    );
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>(
      'input, textarea, select, button:not([data-sheet-close]), [href], [tabindex]:not([tabindex="-1"])',
    );
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
      if (e.key === 'Tab' && el) {
        const focusables = Array.from(
          el.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'),
        ).filter((n) => !n.hasAttribute('disabled'));
        if (focusables.length === 0) return;
        const firstEl = focusables[0];
        const lastEl = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="sheet-scrim"
      ref={scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div
          className="sheet-grip"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
        >
          <div className="sheet-grabber" aria-hidden />
          <div className="sheet-header">
            <h2 id={titleId}>{title}</h2>
            <IconButton icon="close" label="Close" onClick={() => close()} data-sheet-close />
          </div>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div style={{ padding: '0 16px 16px' }}>{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation dialog for destructive or lossy actions. */
export function ConfirmSheet({
  title,
  message,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet title={title} onClose={onCancel}>
      <div className="stack">
        <div style={{ color: 'var(--text-2)' }}>{message}</div>
        <div className="row-inline" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`btn ${destructive ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** Prompt for a single line of text (new file name, rename session…). */
export function PromptSheet({
  title,
  label,
  initial = '',
  confirmLabel,
  placeholder,
  validate,
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  initial?: string;
  confirmLabel: string;
  placeholder?: string;
  /** Return an error message to block submission. */
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const inputId = useId();
  const errId = useId();
  const ref = useRef<HTMLInputElement>(null);
  const errRef = useRef<HTMLParagraphElement>(null);
  return (
    <Sheet title={title} onClose={onCancel}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const value = ref.current?.value ?? '';
          const err = validate?.(value) ?? null;
          if (errRef.current) errRef.current.textContent = err ?? '';
          if (err) return;
          try {
            await onSubmit(value);
          } catch (ex) {
            if (errRef.current) errRef.current.textContent = (ex as Error).message;
          }
        }}
      >
        <label htmlFor={inputId} style={{ fontWeight: 600 }}>
          {label}
        </label>
        <input
          id={inputId}
          ref={ref}
          defaultValue={initial}
          placeholder={placeholder}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={errId}
          style={{
            minHeight: 'var(--tap)',
            padding: '0 12px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-strong)',
            background: 'var(--surface)',
          }}
        />
        <p id={errId} ref={errRef} role="alert" style={{ margin: 0, color: 'var(--danger)', minHeight: '1.2em' }} />
        <div className="row-inline" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="switch"
      checked={checked}
      aria-label={label}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <div className="state-icon">
        <Icon name={icon} size={28} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
