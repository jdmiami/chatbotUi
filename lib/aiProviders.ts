/**
 * Where the AI machine can run (Runpod or GPU.ai), and which of them it is on right now.
 *
 * Pure on purpose (no network, no secrets, no server-only import): lib/ai.ts hands it the settings and
 * what it found on each provider, and tests/site/aiProviders.test.mjs covers the rules.
 */

export type AiProvider = 'runpod' | 'gpuai';

/** The speeds and prices Orbit shows for a provider before Turn on. */
export interface AiProviderInfo {
  id: AiProvider;
  label: string;
  /** One plain line about what it is. */
  blurb: string;
  /** The cheapest price per hour, to show beside the name. */
  fromPrice: number | null;
  /** Runpod: Standard and Turbo (GPU.ai lists every GPU instead). */
  tiers?: { id: string; label: string; gpuName: string; pricePerHour: number; speed: string }[];
}

type Env = Record<string, string | undefined>;

export const providerLabel = (p: AiProvider) => (p === 'gpuai' ? 'GPU.ai' : 'Runpod');

/**
 * The provider named by AI_PROVIDER, or GPU.ai when it is the only key set up. This is where the
 * machine goes when nobody picks (and where the drawing machine runs); it comes first in the picker.
 */
export const defaultProviderOf = (env: Env): AiProvider => (env.AI_PROVIDER === 'gpuai' || (!env.RUNPOD_API_KEY && Boolean(env.GPUAI_API_KEY)) ? 'gpuai' : 'runpod');

/** What the site needs to turn the machine on at each provider. */
export interface StartContext {
  /** The R2 keys are set (GPU.ai machines keep their files there). */
  r2: boolean;
  storage: 'r2' | 'volume';
  volumeId: string;
}
export const startableOf = (env: Env, ctx: StartContext): Record<AiProvider, boolean> => ({
  gpuai: Boolean(env.GPUAI_API_KEY && ctx.r2),
  runpod: Boolean(env.RUNPOD_API_KEY && (ctx.storage === 'r2' || ctx.volumeId)),
});

/** Every provider the machine can be turned on at, the default one first. Two means Orbit asks which. */
export function providersOf(env: Env, ctx: StartContext): AiProvider[] {
  const first = defaultProviderOf(env);
  const ok = startableOf(env, ctx);
  return ([first, first === 'gpuai' ? 'runpod' : 'gpuai'] as AiProvider[]).filter((p) => ok[p]);
}

/**
 * Which provider the machine is on at, given where one is on. With both on (it should never be) the
 * default one counts; with neither on, the default one.
 */
export function activeOf(on: Record<AiProvider, boolean>, providers: AiProvider[], fallback: AiProvider): AiProvider {
  if (providers.length < 2) return providers[0] ?? fallback;
  return providers.find((p) => on[p]) ?? providers[0];
}

/** The other provider, when a machine is on there: turning one on at `chosen` is then refused (it would cost twice). */
export const otherOn = (chosen: AiProvider, on: Record<AiProvider, boolean>): AiProvider | null => {
  const other: AiProvider = chosen === 'gpuai' ? 'runpod' : 'gpuai';
  return on[other] ? other : null;
};

export const alreadyOnMessage = (other: AiProvider, chosen: AiProvider) =>
  `Your AI machine is on at ${providerLabel(other)} right now. Turn it off first, then turn it on at ${providerLabel(chosen)}.`;

/** A provider id from a request body, or null. */
export const cleanProvider = (v: unknown): AiProvider | null => (v === 'gpuai' || v === 'runpod' ? v : null);
