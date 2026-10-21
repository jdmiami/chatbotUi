'use client';

export interface AiTier {
  id: string;
  label: string;
  gpuName: string;
  pricePerHour: number;
  /** The one auto-off rule's minutes: the same for every speed (lib/autoOff.ts). */
  idleMinutes: number;
  speed: string;
}

/** Choose the AI machine's speed (which GPU it runs on). Every speed turns off by the same rule, shown once beside it. */
export default function AiSpeed({
  tiers,
  value,
  onChange,
  disabled,
}: {
  tiers: AiTier[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  if (tiers.length < 2) return null;
  return (
    <div className="ai-speed" role="radiogroup" aria-label="Speed">
      {tiers.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={value === t.id}
          className={value === t.id ? 'on' : ''}
          onClick={() => onChange(t.id)}
          disabled={disabled}
        >
          <strong>{t.label}</strong>
          <span>
            ${t.pricePerHour.toFixed(2)}/hr · {t.speed}
          </span>
          <span className="ai-speed-gpu">{t.gpuName}</span>
        </button>
      ))}
    </div>
  );
}
