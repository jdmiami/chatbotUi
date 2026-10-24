import { AiError, type LocalAi } from './LocalAi';

/**
 * Characters: made-up adults (25 or older) created from words, each with a reference sheet the AI
 * machine makes (front, three-quarter, side, back, face close-up, then expressions and outfits).
 * A character can be added to any prompt in Make and used as the new person in "Swap a person".
 *
 * The library lists from the AI machine when it is on and from cloud storage (the site's
 * /api/characters) when it is off. Making and changing them needs the machine.
 */
export type CharacterStyle = 'photoreal' | 'anime' | 'illustration';
export type CharacterGender = 'woman' | 'man' | 'androgynous';

export interface CharacterTraits {
  style: CharacterStyle;
  gender: CharacterGender;
  build: string;
  height: string;
  skin: string;
  face: string;
  eyes: string;
  hair: string;
  marks: string;
  outfits: string[];
  personality: string;
}

export interface CharacterView {
  view: string;
  label: string;
  core: boolean;
  /** Link to the picture (absolute). */
  url: string;
  /** The machine's check that this view is the same person as the front, when it could make one. */
  identity?: { score: number; checked: boolean };
}

export interface Character {
  id: string;
  name: string;
  age: number;
  adult: true;
  fictional: true;
  /** draft: the sheet is not finished or must be made again; ready: it can be used. */
  status: 'draft' | 'ready';
  sheetStale?: boolean;
  idea?: string;
  createdAt: string;
  updatedAt: string;
  descriptor: string;
  traits: CharacterTraits;
  sheet: CharacterView[];
}

/** What a person types. */
export interface CharacterInput {
  name: string;
  age: number | string;
  idea?: string;
  traits: Partial<CharacterTraits>;
}

export interface SheetEntry {
  view: string;
  label: string;
  core: boolean;
  status: 'todo' | 'making' | 'done' | 'error' | 'stopped';
  progress: number;
  attempt: number;
  error: string | null;
  /** 0 while it is being made, else its place in the machine's line. */
  position: number;
  etaSeconds: number | null;
  identity: { score: number; checked: boolean } | null;
  note?: string;
}

export interface SheetRun {
  id: string | null;
  characterId: string;
  status: 'idle' | 'running' | 'done' | 'error' | 'stopped';
  message: string | null;
  /** The vision check of the finished views is running. */
  checking?: boolean;
  entries: SheetEntry[];
  etaSeconds: number;
  done: number;
}

/** The five views every sheet needs before it can be saved. */
export const CORE_VIEWS = ['front', 'three-quarter', 'side', 'back', 'face'] as const;
export const MIN_AGE = 25;

/** A character's best small picture: the face close-up, else the front. */
export function thumbOf(c: Pick<Character, 'sheet'>): string | null {
  return c.sheet.find((v) => v.view === 'face')?.url ?? c.sheet.find((v) => v.view === 'front')?.url ?? c.sheet[0]?.url ?? null;
}
export const sheetComplete = (c: Pick<Character, 'sheet'>) => CORE_VIEWS.every((v) => c.sheet.some((s) => s.view === v));

/** Where the library came from: the AI machine, or cloud storage (the machine is off). */
export interface CharacterLibrary {
  characters: Character[];
  source: 'machine' | 'storage';
  /** Storage is not set up on the site yet (so nothing can show with the machine off). */
  unconfigured?: boolean;
}

/** What is kept in cloud storage; null when there is no site behind Orbit (a preview). */
export async function storedCharacters(): Promise<CharacterLibrary | null> {
  let res: Response;
  try {
    res = await fetch('/api/characters', { cache: 'no-store', credentials: 'same-origin' });
  } catch {
    throw new AiError('Could not reach your stored characters. Check the connection and try again.');
  }
  if (!(res.headers.get('content-type') ?? '').includes('json')) return null;
  const body = (await res.json().catch(() => ({}))) as { configured?: boolean; characters?: Character[]; error?: string };
  if (res.status === 401) throw new AiError('Your sign-in expired. Reload to sign in again.', 401);
  if (!res.ok) throw new AiError(body.error ?? `Storage answered ${res.status}.`, res.status);
  return { characters: Array.isArray(body.characters) ? body.characters : [], source: 'storage', unconfigured: body.configured === false };
}

export class CharactersApi {
  constructor(private readonly ai: LocalAi) {}

  private fix(c: Character): Character {
    return { ...c, sheet: (c.sheet ?? []).map((v) => ({ ...v, url: /^https?:/.test(v.url) ? v.url : this.ai.characterLink(v.url) })) };
  }

  async list(): Promise<Character[]> {
    const r = await this.ai.characterCall<{ characters: Character[] }>('');
    return r.characters.map((c) => this.fix(c));
  }

  async create(input: CharacterInput): Promise<Character> {
    return this.fix((await this.ai.characterCall<{ character: Character }>('', { method: 'POST', body: JSON.stringify(input) })).character);
  }

  async update(id: string, input: CharacterInput): Promise<Character> {
    return this.fix((await this.ai.characterCall<{ character: Character }>(`/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) })).character);
  }

  async rename(id: string, name: string): Promise<Character> {
    return this.fix((await this.ai.characterCall<{ character: Character }>(`/${encodeURIComponent(id)}/rename`, { method: 'POST', body: JSON.stringify({ name }) })).character);
  }

  async duplicate(id: string): Promise<Character> {
    return this.fix((await this.ai.characterCall<{ character: Character }>(`/${encodeURIComponent(id)}/duplicate`, { method: 'POST', body: '{}' })).character);
  }

  async remove(id: string): Promise<void> {
    await this.ai.characterCall(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** Why these words cannot make a character (plain words), or null. */
  async check(input: Partial<CharacterInput>): Promise<string | null> {
    return (await this.ai.characterCall<{ problem: string | null }>('/check', { method: 'POST', body: JSON.stringify(input) })).problem;
  }

  async sheet(id: string): Promise<{ run: SheetRun; character: Character }> {
    const r = await this.ai.characterCall<{ run: SheetRun; character: Character }>(`/${encodeURIComponent(id)}/sheet`);
    return { run: r.run, character: this.fix(r.character) };
  }

  async startSheet(id: string, opts: { extras?: boolean; redo?: boolean; views?: string[] } = {}): Promise<SheetRun> {
    return (await this.ai.characterCall<{ run: SheetRun }>(`/${encodeURIComponent(id)}/sheet`, { method: 'POST', body: JSON.stringify(opts) })).run;
  }

  async stopSheet(id: string): Promise<SheetRun> {
    return (await this.ai.characterCall<{ run: SheetRun }>(`/${encodeURIComponent(id)}/sheet/stop`, { method: 'POST', body: '{}' })).run;
  }

  async redoView(id: string, view: string): Promise<SheetRun> {
    return (await this.ai.characterCall<{ run: SheetRun }>(`/${encodeURIComponent(id)}/sheet/${encodeURIComponent(view)}`, { method: 'POST', body: '{}' })).run;
  }

  async accept(id: string): Promise<Character> {
    return this.fix((await this.ai.characterCall<{ character: Character }>(`/${encodeURIComponent(id)}/accept`, { method: 'POST', body: '{}' })).character);
  }
}
