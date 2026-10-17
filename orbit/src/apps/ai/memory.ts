/**
 * Personas (how the AI behaves in a chat) and memory (things it should always know about you).
 * Both stay in this browser and are added to the start of each chat as instructions.
 */
export interface Persona {
  id: string;
  name: string;
  prompt: string;
  builtIn?: boolean;
}

export const BUILT_IN_PERSONAS: Persona[] = [
  { id: 'default', name: 'Helpful', prompt: '', builtIn: true },
  { id: 'coder', name: 'Coder', prompt: 'You are a senior software engineer. Give working code first, then a short explanation. Prefer simple, tested solutions and mention edge cases.', builtIn: true },
  { id: 'writer', name: 'Writer', prompt: 'You are a skilled writer and editor. Write vividly and clearly, match the requested tone, and keep it tight.', builtIn: true },
  { id: 'tutor', name: 'Tutor', prompt: 'You are a patient tutor. Explain step by step in plain words, use small examples, and check understanding with one short question at the end.', builtIn: true },
  { id: 'brief', name: 'Straight to the point', prompt: 'Answer as briefly as possible. No preamble, no summary at the end.', builtIn: true },
];

export interface MemoryStore {
  version: 1;
  facts: { id: string; text: string; at: number }[];
  personas: Persona[];
  /** Persona for new chats. */
  defaultPersona: string;
  /** Turn memory off without deleting it. */
  enabled: boolean;
}

const KEY = 'orbit:ai:memory:v1';
const MAX_FACTS = 100;

const empty = (): MemoryStore => ({ version: 1, facts: [], personas: [], defaultPersona: 'default', enabled: true });

export function loadMemory(storage: Storage | null = safeStorage()): MemoryStore {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return empty();
    const s = JSON.parse(raw) as MemoryStore;
    return s?.version === 1 && Array.isArray(s.facts) ? { ...empty(), ...s } : empty();
  } catch {
    return empty();
  }
}

export function saveMemory(s: MemoryStore, storage: Storage | null = safeStorage()) {
  try {
    storage?.setItem(KEY, JSON.stringify({ ...s, facts: s.facts.slice(-MAX_FACTS) }));
  } catch {
    /* storage full or blocked */
  }
}

export function allPersonas(m: MemoryStore): Persona[] {
  return [...BUILT_IN_PERSONAS, ...m.personas];
}

export function personaById(m: MemoryStore, id: string | undefined): Persona {
  return allPersonas(m).find((p) => p.id === id) ?? BUILT_IN_PERSONAS[0];
}

export function addFact(m: MemoryStore, text: string): MemoryStore {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!t || m.facts.some((f) => f.text.toLowerCase() === t.toLowerCase())) return m;
  return { ...m, facts: [...m.facts, { id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text: t, at: Date.now() }] };
}

/** The instructions that open a chat: the persona, then what to remember, then the chat's own. */
export function systemPrompt(m: MemoryStore, personaId: string | undefined, chatSystem?: string): string {
  const parts: string[] = [];
  const p = personaById(m, personaId);
  if (p.prompt) parts.push(p.prompt);
  if (m.enabled && m.facts.length) parts.push(`Things the user asked you to remember:\n${m.facts.map((f) => `- ${f.text}`).join('\n')}`);
  if (chatSystem) parts.push(chatSystem);
  return parts.join('\n\n');
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
