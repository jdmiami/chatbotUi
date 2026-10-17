/** AI app chats, kept in this browser (localStorage). Capped so storage can't fill up. */
import type { ChatMessage, ContentPart } from '../../services/ai/LocalAi';
import { withFiles } from './attach';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  streaming?: boolean;
  stopped?: boolean;
  error?: string;
  /** Which model wrote this reply. */
  model?: string;
  /** How long the model thought before answering, in ms. */
  thinkMs?: number;
  /** Reply length and speed. */
  stats?: { tokens: number; perSecond: number };
  /** Photos sent with this message (shrunk JPEG data URLs). */
  images?: string[];
  /** Text files sent with this message. */
  files?: { name: string; text: string }[];
  /** A picture made from the chat (Create from chat). */
  picture?: { url: string; prompt: string; jobId?: string; progress?: number };
  /** Other models' answers to the same question (Compare). */
  alts?: AiMessage[];
  /** Which answer is shown and used from here on: 0 = this one, n = alts[n - 1]. */
  pick?: number;
}

export interface AiChat {
  id: string;
  title: string;
  model: string;
  system?: string;
  /** How the AI behaves in this chat (see memory.ts). */
  persona?: string;
  /** The chat this one was branched from. */
  branchOf?: string;
  messages: AiMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AiChatStore {
  version: 1;
  chats: AiChat[];
  activeId: string | null;
  /** Last model used, for new chats. */
  model: string;
}

const KEY = 'orbit:ai:v1';
const MAX_CHATS = 60;
const MAX_BYTES = 2_000_000;

const empty = (): AiChatStore => ({ version: 1, chats: [], activeId: null, model: '' });

export function loadChats(storage: Storage | null = safeStorage()): AiChatStore {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return empty();
    const s = JSON.parse(raw) as AiChatStore;
    if (s?.version !== 1 || !Array.isArray(s.chats)) return empty();
    // A reply that was streaming when the page closed is finished as it was.
    for (const c of s.chats) for (const m of c.messages) if (m.streaming) m.streaming = false;
    return s;
  } catch {
    return empty();
  }
}

export function saveChats(s: AiChatStore, storage: Storage | null = safeStorage()) {
  if (!storage) return;
  const chats = [...s.chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS);
  let out: AiChatStore = { ...s, chats };
  let json = JSON.stringify(out);
  while (json.length > MAX_BYTES && out.chats.length > 1) {
    out = { ...out, chats: out.chats.slice(0, -1) };
    json = JSON.stringify(out);
  }
  try {
    storage.setItem(KEY, json);
  } catch {
    /* storage full or blocked: chats stay for this visit */
  }
}

export function newChat(model: string): AiChat {
  const now = Date.now();
  return { id: `c${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`, title: 'New chat', model, messages: [], createdAt: now, updatedAt: now };
}

export function titleFrom(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 48 ? `${one.slice(0, 47)}…` : one || 'New chat';
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The answer currently chosen for a message (Compare lets you pick between models). */
export function shown(m: AiMessage): AiMessage {
  return m.pick && m.alts?.[m.pick - 1] ? m.alts[m.pick - 1] : m;
}

/** A copy of a chat up to and including message `upTo`, to explore another direction. */
export function branchChat(c: AiChat, upTo: number): AiChat {
  const now = Date.now();
  const base = newChat(c.model);
  return {
    ...base,
    title: `↳ ${c.title.replace(/^↳ /, '')}`.slice(0, 48),
    system: c.system,
    persona: c.persona,
    branchOf: c.id,
    messages: c.messages.slice(0, upTo + 1).map((m) => ({ ...shown(m), alts: undefined, pick: undefined, streaming: false })),
    createdAt: now,
    updatedAt: now,
  };
}

/** What the model is sent: the opening instructions, then each message as chosen (with its files and photos). */
export function toHistory(messages: AiMessage[], system: string): ChatMessage[] {
  const out: ChatMessage[] = system ? [{ role: 'system', content: system }] : [];
  for (const raw of messages) {
    const m = shown(raw);
    if (m.error) continue;
    if (m.role === 'assistant') {
      const text = m.picture ? `[I made a picture: ${m.picture.prompt}]` : m.content;
      if (text) out.push({ role: 'assistant', content: text });
      continue;
    }
    const text = withFiles(m.content, m.files);
    if (m.images?.length) {
      const parts: ContentPart[] = [{ type: 'text', text }, ...m.images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))];
      out.push({ role: 'user', content: parts });
    } else if (text) out.push({ role: 'user', content: text });
  }
  return out;
}
