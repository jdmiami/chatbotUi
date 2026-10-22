/**
 * The assistant adapter: the one place a guide talks to any language model, filled in by the app
 * owner. The package itself makes no calls. With no assistant set (or one that is not awake), the
 * ready answers stand on their own and every screen still works.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Assistant {
  /**
   * Stream a reply: call `onText` with each piece of text as it arrives, resolve when the reply is
   * complete, reject on failure (an `Error` whose `name` is 'AbortError' when `signal` aborted it).
   * `maxTokens` is a hint for the longest reply wanted.
   */
  chat(messages: ChatMessage[], onText: (d: string) => void, signal?: AbortSignal, maxTokens?: number): Promise<void>;
  /** Whether the assistant can answer right now, without waking anything up (asking must be free). */
  awake(): boolean;
}

let assistant: Assistant | null = null;

/** Plug an assistant in (or `null` to run without one). */
export function setAssistant(a: Assistant | null) {
  assistant = a;
}

export function getAssistant(): Assistant | null {
  return assistant;
}

/** True when an assistant is set and says it is awake. */
export function assistantAwake(): boolean {
  return Boolean(assistant?.awake());
}
