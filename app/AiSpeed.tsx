'use client';

export interface AiTier {
  id: string;
  label: string;
  gpuName: string;
  pricePerHour: number;
  idleMinutes: number;
  speed: string;
}

/** Choose the AI machine's speed (which GPU it runs on). */
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
          <span className="ai-speed-gpu">
            {t.gpuName} · off after {t.idleMinutes} min unused
          </span>
        </button>
      ))}
    </div>
  );
}
