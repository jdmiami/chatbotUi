import { AiError, type LocalAi } from './LocalAi';

/**
 * Results held for the owner to look at. The AI machine sets some results aside instead of showing them
 * (the safety check could not look, or flagged adult content where it is not allowed). They are kept, not
 * deleted, and shown only here: through the machine when it is on, and straight from cloud storage through
 * the site (/api/held) when it is off. Both answer the same way, and both only ever answer the owner.
 * There is no delete in this list: that is a separate decision of the owner's.
 */
export interface HeldNote {
  at: string;
  by: string;
  text: string;
}

export interface HeldItem {
  id: string;
  kind: 'image' | 'video';
  prompt: string;
  width?: number;
  height?: number;
  seconds?: number;
  nsfw: boolean;
  /** Why it was set aside, in plain words. */
  reason: string;
  category: 'checker-unavailable' | 'flagged' | string;
  heldAt: string;
  /** "You" or "A studio member". */
  madeBy: string;
  owner?: string;
  /** The saved character that was swapped in. */
  character?: { id: string; name: string };
  request?: { target?: string; prompt?: string; adult?: boolean; [k: string]: unknown };
  notes: HeldNote[];
  /** False when it shows a real person's photo or a video not made here: it can only stay held. */
  canApprove: boolean;
  url: string;
  /** Its small preview for the review grid (kept with it under held/), when the machine made one. */
  thumbUrl?: string;
}

const ENDPOINT = '/api/held';

async function site<T>(init?: RequestInit): Promise<T> {
  const res = await fetch(ENDPOINT, { cache: 'no-store', credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new AiError('Held results are only there when Orbit is opened from your workspace site.', res.status);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new AiError(body.error ?? `Storage answered ${res.status}.`, res.status);
  return body;
}

const isList = (x: unknown): x is HeldItem[] => Array.isArray(x);

/**
 * What is held for review: from the machine when it is on (falling back to storage), else from storage.
 * Never throws: anyone who is not the owner, a machine that is off and a site without storage all mean "nothing to show".
 */
export async function loadHeld(ai: LocalAi, machineOn: boolean): Promise<HeldItem[]> {
  if (machineOn) {
    const fromMachine = await ai.heldItems().catch(() => null);
    if (isList(fromMachine)) return fromMachine;
  }
  const r = await site<{ items?: HeldItem[] }>().catch(() => null);
  return isList(r?.items) ? r!.items : [];
}

/** Approve: back into that person's gallery with its NSFW mark kept. The machine when it is on, else storage. */
export async function approveHeld(ai: LocalAi, machineOn: boolean, id: string): Promise<void> {
  if (machineOn) {
    try {
      await ai.approveHeld(id);
      return;
    } catch (err) {
      // A real answer (it can't be approved, it is gone) stands; only "can't reach the machine" tries storage.
      const status = (err as { status?: number }).status;
      if (status && status !== 503) throw err;
    }
  }
  await site({ method: 'POST', body: JSON.stringify({ action: 'approve', id }) });
}

/** Keep it held, with a note on why. */
export async function noteHeld(ai: LocalAi, machineOn: boolean, id: string, text: string): Promise<void> {
  if (machineOn) {
    try {
      await ai.noteHeld(id, text);
      return;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status && status !== 503) throw err;
    }
  }
  await site({ method: 'POST', body: JSON.stringify({ action: 'note', id, text }) });
}
