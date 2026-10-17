/** AI app chats, kept in this browser (localStorage). Capped so storage can't fill up. */

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
}

export interface AiChat {
  id: string;
  title: string;
  model: string;
  system?: string;
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
