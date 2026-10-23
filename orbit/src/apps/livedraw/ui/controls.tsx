import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * A tall slider for the side of the canvas (size and opacity, the way painting apps keep them under
 * the thumb): drag anywhere on it, arrow keys step it. 44 px wide.
 */
export function VSlider({ label, value, min = 0, max = 1, onChange, text, height = 132, preview }: { label: string; value: number; min?: number; max?: number; onChange: (v: number) => void; text: string; height?: number; preview?: 'size' | 'opacity' }) {
  const ref = useRef<HTMLDivElement>(null);
  const k = (value - min) / (max - min || 1);
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const t = 1 - Math.min(1, Math.max(0, (e.clientY - r.top - 10) / Math.max(1, r.height - 20)));
    onChange(min + t * (max - min));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = (max - min) / 20;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(Math.min(max, value + step));
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(Math.max(min, value - step));
    else if (e.key === 'Home') onChange(min);
    else if (e.key === 'End') onChange(max);
    else return;
    e.preventDefault();
  };
  return (
    <div className="ldx-vslider-wrap">
      <div
        ref={ref}
        className="ldx-vslider"
        style={{ height }}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value * 100) / 100}
        aria-valuetext={text}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          at(e);
        }}
        onPointerMove={(e) => e.buttons && at(e)}
        onKeyDown={key}
        data-kind={preview}
      >
        <span className="ldx-vslider-track" />
        <span className="ldx-vslider-fill" style={{ height: `calc(${k * 100}% - ${k * 20}px + 10px)` }} />
        <span className="ldx-vslider-thumb" style={{ bottom: `calc(${k * 100}% - ${k * 20}px)` }} />
      </div>
      <span className="ldx-vslider-label">{text}</span>
    </div>
  );
}

/** A slim slider with no label beside it (the phone's quick bar): the label is for screen readers. */
export function MiniSlider({ label, value, min = 0, max = 1, step = 0.01, onChange, text }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; text: string }) {
  return (
    <label className="ldx-mini" title={label}>
      <span className="ldx-mini-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} aria-valuetext={text} />
    </label>
  );
}

/** On / off, as a labelled switch row (44 px). */
export function Toggle({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="ldx-switch" onClick={() => onChange(!on)} title={hint}>
      <span className="ldx-switch-label">{label}</span>
      <span className="ldx-switch-track" aria-hidden>
        <span className="ldx-switch-knob" />
      </span>
    </button>
  );
}
