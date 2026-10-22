/**
 * The writer adapter: the one place a studio talks to any language model, filled in by the app
 * owner. The package itself makes no calls. With no writer set (or a writer that is not awake), the
 * ready-made choices and the rule-based script draft stand on their own.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Writer {
  /**
   * Stream a reply: call `onText` with each piece of text as it arrives, resolve when the reply is
   * complete, reject on failure (an `Error` whose `name` is 'AbortError' when `signal` aborted it).
   * `maxTokens` is a hint for the longest reply wanted.
   */
  chat(messages: ChatMessage[], onText: (d: string) => void, signal?: AbortSignal, maxTokens?: number): Promise<void>;
  /** Whether the writer can answer right now, without waking anything up (asking must be free). */
  awake(): boolean;
}

let writer: Writer | null = null;

/** Plug a writer in (or `null` to run without one). */
export function setWriter(w: Writer | null) {
  writer = w;
}

export function getWriter(): Writer | null {
  return writer;
}

/** True when a writer is set and says it is awake. */
export function writerAwake(): boolean {
  return Boolean(writer?.awake());
}
