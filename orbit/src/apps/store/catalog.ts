import raw from '../../../../ai/gate/catalog.json';
import type { StudioMakerInfo } from '../../services/ai/LocalAi';

/**
 * The AI Store's catalog: every chat model and maker it offers, with the details a store page shows.
 * The same file (ai/gate/catalog.json) is what the AI machine installs from, so the shelves are full
 * even while the machine is off.
 */

export type ChatTag = 'general' | 'vision' | 'coding' | 'reasoning' | 'uncensored' | 'fast' | 'creative' | 'multilingual' | 'tools' | 'agents';

export interface ChatEntry {
  id: string;
  spec: string;
  title: string;
  publisher?: string;
  family?: string;
  params?: string;
  quant?: string;
  size: number;
  context?: number;
  license?: string;
  released?: string;
  repo?: string;
  downloads?: number;
  likes?: number;
  tags: string[];
  abilities?: { vision?: boolean; tools?: boolean; thinking?: boolean };
  /** "moe": only part of the model works on each word (fast for its size). */
  moe?: boolean;
  blurb: string;
  about?: string;
  tryIt?: string[];
  source?: 'ollama' | 'hf';
}

/** Store-page details for a maker (the machine reports the rest: size, installed, progress). */
export interface MakerDetails {
  publisher?: string;
  base?: string;
  license?: string;
  repo?: string;
  released?: string;
  about?: string;
  tryIt?: string[];
  trigger?: string;
  steps?: number;
  resolution?: string;
  output?: string;
  /** GPU memory it uses, in plain words ("About 28 GB of the 48 GB"). */
  gpu?: string;
  /** How fast it is, in plain words (and whether that was measured). */
  speed?: string;
  /** Where its code lives, when that isn't where its weights are. */
  code?: string;
  /** Only runs on the Turbo machine (80 GB). */
  turboOnly?: boolean;
  /** Its files are gated on Hugging Face: the AI machine needs a token. */
  gated?: boolean;
}

interface MakerDef {
  id: string;
  kind: StudioMakerInfo['kind'];
  name: string;
  blurb: string;
  for?: string;
  twoImages?: boolean;
  files: string[];
  needs?: StudioMakerInfo['needs'];
  accepts?: StudioMakerInfo['accepts'];
  tasks?: StudioMakerInfo['tasks'];
}
interface Catalog {
  chat: ChatEntry[];
  makers: Record<string, MakerDetails>;
  /** Makers the machine can add beyond its built-in list (same entries the machine reads). */
  makerDefs?: MakerDef[];
  files?: Record<string, { size: number; gated?: boolean }>;
}

export const CATALOG = raw as unknown as Catalog;

/** The catalog's extra makers, shaped like the machine reports them (for when it is off). */
export const CATALOG_MAKERS: Pick<StudioMakerInfo, 'id' | 'kind' | 'name' | 'blurb' | 'for' | 'twoImages' | 'size' | 'needs' | 'accepts' | 'tasks' | 'gated'>[] = (CATALOG.makerDefs ?? []).map((m) => ({
  id: m.id,
  kind: m.kind,
  name: m.name,
  blurb: m.blurb,
  for: m.for ?? null,
  twoImages: Boolean(m.twoImages),
  needs: m.needs ?? [],
  accepts: m.accepts ?? [],
  tasks: m.tasks ?? [],
  gated: m.files.some((k) => CATALOG.files?.[k]?.gated),
  // Only the files this maker adds (shared base models are counted where they first appear).
  size: m.files.reduce((n, k) => n + (CATALOG.files?.[k]?.size ?? 0), 0),
}));
export const CHAT: ChatEntry[] = CATALOG.chat;

export const CHAT_SHELVES: { tag: ChatTag; title: string; dek: string }[] = [
  { tag: 'general', title: 'Everyday', dek: 'Good at almost anything: questions, writing, plans.' },
  { tag: 'vision', title: 'Sees pictures', dek: 'Show them a photo, a screenshot or a document.' },
  { tag: 'coding', title: 'Code', dek: 'Write, read and fix code; drive the coding agent.' },
  { tag: 'reasoning', title: 'Deep thinkers', dek: 'They think step by step before answering hard problems.' },
  { tag: 'agents', title: 'Agents & tools', dek: 'Call tools, search, and carry out multi-step tasks.' },
  { tag: 'creative', title: 'Stories & role-play', dek: 'Fiction, characters, poems and play.' },
  { tag: 'multilingual', title: 'Many languages', dek: 'Fluent well beyond English.' },
  { tag: 'fast', title: 'Small & quick', dek: 'Load in seconds and answer fast.' },
  { tag: 'uncensored', title: 'Unfiltered', dek: 'Refusals removed. Adults only.' },
];

/** Normalise a tag list ("tools" counts as the agents shelf). */
export function inShelf(e: ChatEntry, tag: ChatTag) {
  return e.tags.includes(tag) || (tag === 'agents' && e.tags.includes('tools') && !e.tags.includes('uncensored'));
}

/** The model name Ollama uses for a spec ("name=hf.co/…" → "name"). */
export function nameOfSpec(spec: string) {
  const name = spec.split('|')[0].split('=')[0];
  return name.includes(':') ? name : `${name}:latest`;
}

/** The standard GPU has 48 GB (about 46 usable). */
export const GPU_BYTES = 46e9;

/** GPU memory a chat model needs: its weights plus room for a long conversation. */
export function gpuNeed(size: number) {
  return size * 1.08 + 2.5e9;
}

/** A rough reading speed on the A40/A6000 (memory bound): words appear about this fast. */
export function speedOf(e: ChatEntry): string | null {
  if (!e.size) return null;
  if (e.moe) return 'Very fast for its size';
  const tps = (0.55 * 696e9) / e.size;
  return `About ${Math.max(5, Math.round(tps))} tokens a second`;
}

export function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e11 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

export const formatCount = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

export function formatContext(n?: number) {
  if (!n) return null;
  return n >= 1024 ? `${Math.round(n / 1024)}k tokens (about ${Math.round((n * 0.75) / 1000)}k words)` : `${n} tokens`;
}

/** A tile colour for an entry with no artwork: picked from its name, always the same. */
export function hueOf(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
