import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Sheet } from './components';

/**
 * Choose where and how a machine turns on, shown at every Turn on.
 *
 * - With only GPU.ai set up: every GPU it offers right now, cheapest first, with its memory, price per
 *   hour, what it can do and how many are free (for the AI machine and Live Draw's drawing machine).
 * - With both Runpod and GPU.ai set up (the AI machine): first where to run it, then GPU.ai's list or
 *   Runpod's Standard and Turbo. One machine at a time: the site refuses a second at the other place.
 * - Where the site has no list (only Runpod), nothing is shown and the machine turns on as before.
 *
 * The last pick for each machine is preselected (remembered on this device).
 */
export type MachineKind = 'ai' | 'canvas';
export type ProviderId = 'runpod' | 'gpuai';

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

/** A place the AI machine can run, as the site describes it. */
export interface ProviderOption {
  id: ProviderId;
  label: string;
  blurb: string;
  fromPrice: number | null;
  /** Runpod: Standard and Turbo. */
  tiers?: { id: string; label: string; gpuName: string; pricePerHour: number; speed: string }[];
}

/** What was picked. `provider` is only set when the site offered both. */
export interface MachineChoice {
  provider?: ProviderId;
  gpu?: string;
  tier?: string;
}

interface Ask {
  kind: MachineKind;
  options: GpuOption[];
  recommended: string | null;
  /** Two or more when Orbit has to ask where to run it; empty otherwise. */
  providers: ProviderOption[];
  fallback: ProviderId | null;
  resolve: (choice: MachineChoice | null) => void;
}

const useAsk = create<{ ask: Ask | null }>(() => ({ ask: null }));
const KEY = (kind: MachineKind) => `orbit.gpu.${kind}`;
const PROVIDER_KEY = (kind: MachineKind) => `orbit.provider.${kind}`;
/** The same key the Standard/Turbo switch next to Turn on uses (ui/SpeedChoice). */
const SPEED_KEY = 'orbit.speed';

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}
function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

interface List {
  options: GpuOption[];
  recommended: string | null;
  providers: ProviderOption[];
  fallback: ProviderId | null;
}

/** The site's list for this machine, or null where there is nothing to choose (not on GPU.ai alone, or it can't be read). */
export async function gpuOptions(kind: MachineKind): Promise<List | null> {
  try {
    const res = await fetch(`/api/ai/gpus?machine=${kind}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { options?: GpuOption[]; recommended?: string | null; providers?: ProviderOption[]; default?: ProviderId };
    const options = Array.isArray(body.options) ? body.options : [];
    const providers = Array.isArray(body.providers) && body.providers.length > 1 ? body.providers : [];
    if (!options.length && !providers.length) return null;
    return { options, recommended: body.recommended ?? null, providers, fallback: body.default ?? null };
  } catch {
    return null;
  }
}

async function choose(kind: MachineKind): Promise<MachineChoice | null | undefined> {
  const list = await gpuOptions(kind);
  if (!list) return undefined;
  return new Promise((resolve) => {
    useAsk.setState({ ask: { kind, ...list, resolve } });
  });
}

/**
 * Ask which GPU to turn on with. Resolves with the GPU picked, null when you cancel, or undefined
 * when there is nothing to choose from (the machine turns on as it always has).
 */
export async function chooseGpu(kind: MachineKind): Promise<string | null | undefined> {
  const pick = await choose(kind);
  return pick ? pick.gpu : pick;
}

/**
 * Ask where and how to turn the AI machine on: the choice (provider only when there are two), null
 * when you cancel, or undefined when there is nothing to choose from.
 */
export const chooseMachine = (): Promise<MachineChoice | null | undefined> => choose('ai');

const money = (n: number) => `$${n.toFixed(2)}`;

/** Mounted once in the shell: the sheet, while a Turn on waits for a pick. */
export function GpuChooserHost() {
  const ask = useAsk((s) => s.ask);
  if (!ask) return null;
  return <GpuSheet key={`${ask.kind}-${ask.options.length}-${ask.providers.length}`} ask={ask} />;
}

type Step = 'provider' | 'gpu' | 'speed';

function GpuSheet({ ask }: { ask: Ask }) {
  const many = ask.providers.length > 1;
  const firstProvider = remembered(PROVIDER_KEY(ask.kind));
  const startProvider: ProviderId = ask.providers.find((p) => p.id === firstProvider)?.id ?? ask.fallback ?? ask.providers[0]?.id ?? 'gpuai';
  const [provider, setProvider] = useState<ProviderId>(startProvider);
  const [step, setStep] = useState<Step>(many ? 'provider' : 'gpu');

  const first = remembered(KEY(ask.kind));
  const [picked, setPicked] = useState<string | null>(ask.options.some((o) => o.gpu === first) ? first : (ask.recommended ?? ask.options[0]?.gpu ?? null));
  const chosen = ask.options.find((o) => o.gpu === picked) ?? null;

  const tiers = ask.providers.find((p) => p.id === 'runpod')?.tiers ?? [];
  const lastSpeed = remembered(SPEED_KEY);
  const [tierId, setTierId] = useState<string | null>(tiers.find((t) => t.id === lastSpeed)?.id ?? tiers[0]?.id ?? null);
  const tier = tiers.find((t) => t.id === tierId) ?? null;
  const info = ask.providers.find((p) => p.id === provider) ?? null;

  const done = (choice: MachineChoice | null) => {
    useAsk.setState({ ask: null });
    if (choice?.gpu) remember(KEY(ask.kind), choice.gpu);
    if (choice?.tier) remember(SPEED_KEY, choice.tier);
    if (choice?.provider) remember(PROVIDER_KEY(ask.kind), choice.provider);
    ask.resolve(choice);
  };
  // Leaving the page (or another sheet replacing this one) counts as cancel.
  useEffect(
    () => () => {
      if (useAsk.getState().ask === ask) ask.resolve(null);
    },
    [ask],
  );

  const what = ask.kind === 'canvas' ? 'the drawing machine' : 'your AI machine';
  const cancel = (
    <button type="button" className="btn ghost" onClick={() => done(null)}>
      Cancel
    </button>
  );
  const back = (
    <button type="button" className="btn ghost" onClick={() => setStep('provider')}>
      Back
    </button>
  );

  if (step === 'provider') {
    return (
      <Sheet
        title={`Where should ${what} run?`}
        onClose={() => done(null)}
        footer={
          <div className="gpu-foot">
            {cancel}
            <button type="button" className="btn primary" disabled={!info} onClick={() => setStep(provider === 'runpod' ? 'speed' : 'gpu')}>
              {info ? `Continue · ${info.label}` : 'Continue'}
            </button>
          </div>
        }
      >
        <p className="gpu-lead">You pay by the hour, only while it is on. One machine at a time: to move it, turn it off first.</p>
        <div className="gpu-list" role="radiogroup" aria-label="Where to run it">
          {ask.providers.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={p.id === provider} className="gpu-row gpu-yes" onClick={() => setProvider(p.id)}>
              <span className="gpu-name">
                {p.label}
                {p.id === ask.fallback ? <span className="gpu-tag">Usual</span> : null}
              </span>
              <span className="gpu-price">{p.fromPrice != null ? `from ${money(p.fromPrice)}/h` : ''}</span>
              <span className="gpu-note">{p.blurb}</span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  if (step === 'speed') {
    return (
      <Sheet
        title={`Pick a speed for ${what}`}
        onClose={() => done(null)}
        footer={
          <div className="gpu-foot">
            {many ? back : cancel}
            <button type="button" className="btn primary" disabled={!tier} onClick={() => tier && done({ provider: 'runpod', tier: tier.id })}>
              {tier ? `Turn on at Runpod · ${tier.label} · ${money(tier.pricePerHour)}/h` : 'Turn on'}
            </button>
          </div>
        }
      >
        <p className="gpu-lead">Runpod gives the machine one of its GPUs, by the hour. It turns itself off when you stop using it.</p>
        <div className="gpu-list" role="radiogroup" aria-label="Speed">
          {tiers.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={t.id === tierId} className="gpu-row gpu-yes" onClick={() => setTierId(t.id)}>
              <span className="gpu-name">
                {t.label}
                <span className="gpu-mem"> · {t.gpuName}</span>
              </span>
              <span className="gpu-price">{money(t.pricePerHour)}/h</span>
              <span className="gpu-note">{t.speed}</span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={`Pick a GPU for ${what}`}
      onClose={() => done(null)}
      footer={
        <div className="gpu-foot">
          {many ? back : cancel}
          <button type="button" className="btn primary" disabled={!chosen} onClick={() => chosen && done({ ...(many ? { provider: 'gpuai' as const } : {}), gpu: chosen.gpu })}>
            {chosen ? `Turn on · ${chosen.name} · ${money(chosen.pricePerHour)}/h` : 'Turn on'}
          </button>
        </div>
      }
    >
      <p className="gpu-lead">
        What GPU.ai has free right now, cheapest first. You pay by the hour while it is on; it turns itself off when you stop using it.
      </p>
      {ask.options.length === 0 ? <p className="gpu-lead">No GPU is free on GPU.ai right now. Go back and try Runpod, or try again in a few minutes.</p> : null}
      <div className="gpu-list" role="radiogroup" aria-label="GPU">
        {ask.options.map((o) => (
          <button key={o.gpu} type="button" role="radio" aria-checked={o.gpu === picked} className={`gpu-row gpu-${o.fits}`} onClick={() => setPicked(o.gpu)}>
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
