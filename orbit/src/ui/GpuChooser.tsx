import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Sheet } from './components';

/**
 * Pick the GPU before a machine turns on (GPU.ai): every GPU it offers right now, cheapest first, with
 * its memory, price per hour, what it can do and how many are free. Shown at every Turn on, for the
 * AI machine and for Live Draw's drawing machine. The last pick for each machine is preselected.
 * Where the site has no list (Runpod), nothing is shown and the machine turns on as before.
 */
export type MachineKind = 'ai' | 'canvas';

export interface GpuOption {
  gpu: string;
  name: string;
  memoryGb: number | null;
  pricePerHour: number;
  region: string | null;
  free: number;
  fits: 'yes' | 'some' | 'no';
  note: string;
  videoMinutes: number | null;
}

interface Ask {
  kind: MachineKind;
  options: GpuOption[];
  recommended: string | null;
  resolve: (gpu: string | null) => void;
}

const useAsk = create<{ ask: Ask | null }>(() => ({ ask: null }));
const KEY = (kind: MachineKind) => `orbit.gpu.${kind}`;

function remembered(kind: MachineKind): string | null {
  try {
    return localStorage.getItem(KEY(kind));
  } catch {
    return null;
  }
}

/** The site's list for this machine, or null where there is none (not on GPU.ai, or it can't be read). */
export async function gpuOptions(kind: MachineKind): Promise<{ options: GpuOption[]; recommended: string | null } | null> {
  try {
    const res = await fetch(`/api/ai/gpus?machine=${kind}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { options?: GpuOption[]; recommended?: string | null };
    return Array.isArray(body.options) && body.options.length ? { options: body.options, recommended: body.recommended ?? null } : null;
  } catch {
    return null;
  }
}

/**
 * Ask which GPU to turn on with. Resolves with the GPU picked, null when you cancel, or undefined
 * when there is nothing to choose from (the machine turns on as it always has).
 */
export async function chooseGpu(kind: MachineKind): Promise<string | null | undefined> {
  const list = await gpuOptions(kind);
  if (!list) return undefined;
  return new Promise((resolve) => {
    useAsk.setState({ ask: { kind, ...list, resolve } });
  });
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** Mounted once in the shell: the sheet, while a Turn on waits for a pick. */
export function GpuChooserHost() {
  const ask = useAsk((s) => s.ask);
  if (!ask) return null;
  return <GpuSheet key={`${ask.kind}-${ask.options.length}`} ask={ask} />;
}

function GpuSheet({ ask }: { ask: Ask }) {
  const first = remembered(ask.kind);
  const start = ask.options.some((o) => o.gpu === first) ? first : ask.recommended ?? ask.options[0]?.gpu ?? null;
  const [picked, setPicked] = useState<string | null>(start);
  const chosen = ask.options.find((o) => o.gpu === picked) ?? null;
  const done = (gpu: string | null) => {
    useAsk.setState({ ask: null });
    if (gpu) {
      try {
        localStorage.setItem(KEY(ask.kind), gpu);
      } catch {
        /* private mode */
      }
    }
    ask.resolve(gpu);
  };
  // Leaving the page (or another sheet replacing this one) counts as cancel.
  useEffect(
    () => () => {
      if (useAsk.getState().ask === ask) ask.resolve(null);
    },
    [ask],
  );
  const what = ask.kind === 'canvas' ? 'the drawing machine' : 'your AI machine';
  return (
    <Sheet
      title={`Pick a GPU for ${what}`}
      onClose={() => done(null)}
      footer={
        <div className="gpu-foot">
          <button type="button" className="btn ghost" onClick={() => done(null)}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!chosen} onClick={() => done(picked)}>
            {chosen ? `Turn on · ${chosen.name} · ${money(chosen.pricePerHour)}/h` : 'Turn on'}
          </button>
        </div>
      }
    >
      <p className="gpu-lead">
        What GPU.ai has free right now, cheapest first. You pay by the hour while it is on; it turns itself off when you stop using it.
      </p>
      <div className="gpu-list" role="radiogroup" aria-label="GPU">
        {ask.options.map((o) => (
          <button
            key={o.gpu}
            type="button"
            role="radio"
            aria-checked={o.gpu === picked}
            className={`gpu-row gpu-${o.fits}`}
            onClick={() => setPicked(o.gpu)}
          >
            <span className="gpu-name">
              {o.name}
              {o.memoryGb ? <span className="gpu-mem"> · {o.memoryGb} GB</span> : null}
              {o.gpu === ask.recommended ? <span className="gpu-tag">Suggested</span> : null}
            </span>
            <span className="gpu-price">{money(o.pricePerHour)}/h</span>
            <span className="gpu-note">
              {o.fits === 'no' ? '⚠ ' : ''}
              {o.note}
              {ask.kind === 'ai' && o.videoMinutes && o.fits !== 'no' ? ` · 5 s video about ${o.videoMinutes} min` : ''}
            </span>
            <span className="gpu-free">{o.free > 9 ? 'Plenty free' : `${o.free} free`}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
