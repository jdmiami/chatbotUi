/**
 * A page can lend the orb its own AI (a studio lends its writer, so members, who can't use the
 * owner's AI, can still tap the orb and ask). While one is set, the orb thinks with it instead of
 * Cloud AI or the AI machine.
 */
import type { ChatMessage, StreamHandlers } from '../../services/ai/LocalAi';

export interface PageChat {
  chat: (messages: ChatMessage[], h: StreamHandlers, signal?: AbortSignal) => Promise<unknown>;
  /** Whether it can answer now; `why` is what the orb says when it can't. */
  ready: () => Promise<boolean>;
  why: string;
}

let current: PageChat | null = null;

export function setPageChat(chat: PageChat | null) {
  current = chat;
}

export function pageChat(): PageChat | null {
  return current;
}
