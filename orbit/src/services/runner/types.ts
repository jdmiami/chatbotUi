/**
 * Agent runner contract for the Antigravity app.
 *
 * The product's runner is the Google Antigravity CLI (`agy`). Nothing here may claim a capability
 * the real CLI does not have. Each adapter declares its capabilities explicitly; the UI disables
 * and explains anything that is not 'supported'.
 *
 * Phase 1: `DemoRunner` (services/runner/demo) — canned, clearly labelled simulated responses.
 * Phase 2: `AgyCliRunner` — a server-side adapter that drives the installed `agy` binary.
 *
 * What we verified about `agy` 1.3.4 so far (from `agy --help` and real runs; see ARCHITECTURE.md):
 *  - `agy --print "<prompt>" --output-format json` runs one turn non-interactively and returns
 *    { conversation_id, status, response, duration_seconds, num_turns, usage }.
 *  - `--conversation <id>` continues a previous conversation (verified: a follow-up remembered context).
 *  - `--mode accept-edits|plan`, `--model <id>`, `--sandbox`, `--print-timeout` exist.
 *  - `agy models` lists model ids.
 *  - `--output-format stream-json` exists; its event schema is not yet verified.
 *  - No documented pause/resume of an in-flight turn. Stopping = terminating the process.
 *  - Tool-approval prompts in print mode: not yet verified.
 */

export type CapabilityStatus = 'supported' | 'unsupported' | 'unverified';

export interface Capability {
  status: CapabilityStatus;
  /** One sentence the UI can show, e.g. "Runs `agy --print … --conversation <id>`". */
  note: string;
}

export type CapabilityKey =
  | 'newConversation'
  | 'continueConversation'
  | 'streamOutput'
  | 'stop'
  | 'pauseResume'
  | 'approvals'
  | 'modes'
  | 'models';

export type RunnerCapabilities = Record<CapabilityKey, Capability>;

export interface Project {
  id: string;
  name: string;
  /** Path on the host (Phase 2) or a demo label. */
  path: string;
}

export type SessionStatus = 'idle' | 'running' | 'stopped' | 'error';

/** `agy --mode` values. 'default' means the flag is omitted. */
export type RunnerMode = 'default' | 'plan' | 'accept-edits';

export interface SessionSummary {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
  model?: string;
  mode: RunnerMode;
  /** The runner's own conversation id (agy `conversation_id`) once the first turn completes. */
  conversationId?: string;
  messageCount: number;
  /** True for seeded demo data. */
  simulated: boolean;
}

export type TranscriptItem =
  | { kind: 'user'; id: string; at: number; text: string }
  | { kind: 'assistant'; id: string; at: number; text: string; streaming?: boolean }
  | {
      kind: 'activity';
      id: string;
      at: number;
      title: string;
      detail?: string;
      status: 'running' | 'done' | 'failed';
    }
  | { kind: 'notice'; id: string; at: number; text: string; tone: 'info' | 'warning' | 'error' };

export interface ModelOption {
  id: string;
  label: string;
}

export interface SendHandlers {
  /** A new transcript item was appended. */
  onItem(item: TranscriptItem): void;
  /** An existing item changed (streaming text, activity finished). Same id as before. */
  onUpdate(item: TranscriptItem): void;
  /** The turn ended (normally, stopped or failed). The session summary is final. */
  onDone(session: SessionSummary): void;
  onError(error: Error): void;
}

export interface RunHandle {
  /** Stop the in-flight turn. For agy this terminates the process; it is not a pause. */
  stop(): void;
}

export interface RunnerAdapter {
  readonly kind: 'demo' | 'antigravity-cli';
  readonly label: string;
  readonly capabilities: RunnerCapabilities;

  listProjects(): Promise<Project[]>;
  listSessions(projectId: string): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<SessionSummary | undefined>;
  getTranscript(sessionId: string): Promise<TranscriptItem[]>;
  createSession(projectId: string, opts?: { title?: string; model?: string; mode?: RunnerMode }): Promise<SessionSummary>;
  updateSession(sessionId: string, patch: Partial<Pick<SessionSummary, 'title' | 'model' | 'mode'>>): Promise<SessionSummary>;
  deleteSession(sessionId: string): Promise<void>;
  listModels(): Promise<ModelOption[]>;
  /** Start one turn. Rejects synchronously-ish (via onError) if the session is already running. */
  send(sessionId: string, text: string, handlers: SendHandlers): RunHandle;
  /** Fires when sessions/projects change. */
  subscribe(listener: () => void): () => void;
}
