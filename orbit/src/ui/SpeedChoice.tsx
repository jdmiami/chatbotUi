import { useState } from 'react';
import { Segmented } from './components';
import type { AiMachineStatus, AiTier } from '../services/ai/LocalAi';

/**
 * Standard or Turbo: which GPU the AI machine turns on with, with its price per hour. Shown next to
 * "Turn it on" in Make and Lab (Talk has its own). The last pick is remembered on this device.
 */
const KEY = 'orbit.speed';

function remembered(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The tiers the site offers and the one picked (remembered, else the machine's own, else the first). */
export function useSpeed(status: AiMachineStatus | null): { tiers: AiTier[]; chosen: AiTier | undefined; pick: (id: string) => void } {
  const [picked, setPicked] = useState<string | null>(remembered);
  const tiers = status?.tiers ?? [];
  const chosen = tiers.find((t) => t.id === picked) ?? tiers.find((t) => t.id === status?.tier) ?? tiers[0];
  const pick = (id: string) => {
    setPicked(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* private mode: remembered for this visit only */
    }
  };
  return { tiers, chosen, pick };
}

export function SpeedChoice({ tiers, chosen, pick }: ReturnType<typeof useSpeed>) {
  if (tiers.length < 2) return null;
  return (
    <Segmented
      label="Speed"
      value={chosen?.id ?? tiers[0].id}
      onChange={pick}
      options={tiers.map((t) => ({ value: t.id, label: `${t.label} · $${t.pricePerHour.toFixed(2)}/h` }))}
    />
  );
}
