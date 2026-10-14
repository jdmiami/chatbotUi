/**
 * Pure helpers for the Antigravity app (no React, no services) so they can be unit tested.
 */
import type {
  Capability,
  CapabilityKey,
  CapabilityStatus,
  RunnerCapabilities,
  RunnerMode,
  SessionSummary,
  TranscriptItem,
} from '../../services/runner/types';

/* ------------------------------------------------------------------ message formatting */

export type Segment = { kind: 'text'; text: string } | { kind: 'code'; lang: string; code: string };
export type InlinePart = { kind: 'text' | 'code'; text: string };

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;

/**
 * Split a reply into prose and fenced code blocks (``` or ~~~). An unclosed fence (e.g. while a
 * reply is still arriving) runs to the end. No markdown library: prose keeps its line breaks.
 */
export function parseMessage(text: string): Segment[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: Segment[] = [];
  let prose: string[] = [];
  const flush = () => {
    const t = prose.join('\n').replace(/^\n+|\s+$/g, '');
    if (t) out.push({ kind: 'text', text: t });
    prose = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_OPEN.exec(lines[i]);
    if (!m) {
      prose.push(lines[i]);
      continue;
    }
    flush();
    const marker = m[1];
    const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
    const code: string[] = [];
    i++;
    while (i < lines.length && !close.test(lines[i])) code.push(lines[i++]);
    out.push({ kind: 'code', lang: m[2] ?? '', code: code.join('\n') });
  }
  flush();
  return out;
}

/** Paragraphs of a prose segment (blank lines separate them). */
export function paragraphs(text: string): string[] {
  return text.split(/\n[ \t]*\n+/).map((p) => p.replace(/^\n+|\n+$/g, '')).filter((p) => p.trim() !== '');
}

/** `inline code` spans within a paragraph. */
export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const re = /`([^`\n]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) });
    parts.push({ kind: 'code', text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

/* ------------------------------------------------------------------ transcript */

/** Insert or replace an item (by id), keeping order. */
export function mergeItem(items: TranscriptItem[], item: TranscriptItem): TranscriptItem[] {
  const i = items.findIndex((x) => x.id === item.id);
  if (i < 0) return [...items, item];
  const copy = items.slice();
  copy[i] = item;
  return copy;
}

/* ------------------------------------------------------------------ sessions */

export const MODE_LABELS: Record<RunnerMode, string> = {
  default: 'Default',
  plan: 'Plan',
  'accept-edits': 'Accept edits',
};
export const MODES: RunnerMode[] = ['default', 'plan', 'accept-edits'];

export type StatusTone = 'new' | 'idle' | 'running' | 'stopped' | 'error';

export function statusTone(s: SessionSummary): StatusTone {
  if (s.status === 'idle' && s.messageCount === 0 && !s.conversationId) return 'new';
  return s.status;
}

export function statusLabel(s: SessionSummary): string {
  switch (statusTone(s)) {
    case 'new':
      return 'New';
    case 'running':
      return 'Running';
    case 'stopped':
      return 'Stopped';
    case 'error':
      return 'Error';
    default:
      return 'Ready';
  }
}

/** One line for the App Switcher. Mentions "unsaved" whenever a draft exists (drafts live in memory only). */
export function agentSummary(args: {
  sessionCount: number | null;
  selected: SessionSummary | null;
  running: SessionSummary[];
  drafts: Record<string, string>;
}): string {
  const { sessionCount, selected, running, drafts } = args;
  const draftIds = Object.keys(drafts).filter((id) => drafts[id]?.trim());
  const busy = (selected && running.find((s) => s.id === selected.id)) ?? running[0];
  let text: string;
  if (busy) text = `${busy.title} — running`;
  else if (selected && drafts[selected.id]?.trim()) text = `${selected.title} — draft not sent (unsaved)`;
  else if (sessionCount === null) text = 'Antigravity';
  else text = `${sessionCount} session${sessionCount === 1 ? '' : 's'}`;
  if (draftIds.length && !text.includes('unsaved')) {
    text += draftIds.length === 1 ? ' · 1 unsaved draft' : ` · ${draftIds.length} unsaved drafts`;
  }
  return text;
}

/** Errors that mean agy has no saved sign-in on the machine. */
export function isSignInError(text: string): boolean {
  return /\bsign(?:ed)?[\s-]?in\b|\bauthenticat\w*|\bnot (?:logged|signed) in\b|\blog[\s-]?in required\b|\bauth\b/i.test(
    text,
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Something went wrong.';
}

/* ------------------------------------------------------------------ keyboard */

export interface EnterKeyInfo {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  isComposing?: boolean;
}

/**
 * What Enter does in the composer. Fine pointer (hardware keyboard + mouse/trackpad): Enter sends,
 * Shift+Enter is a newline. Coarse pointer (touch): Enter is a newline. Cmd/Ctrl+Enter always sends.
 */
export function enterAction(e: EnterKeyInfo, finePointer: boolean): 'send' | 'newline' | 'none' {
  if (e.key !== 'Enter' || e.isComposing) return 'none';
  if (e.metaKey || e.ctrlKey) return 'send';
  if (e.shiftKey || e.altKey) return 'newline';
  return finePointer ? 'send' : 'newline';
}

/* ------------------------------------------------------------------ capabilities */

export const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  newConversation: 'Start a new conversation',
  continueConversation: 'Continue a conversation (follow-ups)',
  streamOutput: 'Live streaming of replies',
  stop: 'Stop a running turn',
  pauseResume: 'Pause and resume a turn',
  approvals: 'Approve tool actions from Orbit',
  modes: 'Modes: Default, Plan, Accept edits',
  models: 'Choose a model',
};

export const CAPABILITY_ORDER: CapabilityKey[] = [
  'newConversation',
  'continueConversation',
  'stop',
  'modes',
  'models',
  'pauseResume',
  'streamOutput',
  'approvals',
];

export const STATUS_HEADINGS: Record<CapabilityStatus, { title: string; caption: string }> = {
  supported: { title: 'Supported', caption: 'Available in this app.' },
  unsupported: { title: 'Not supported', caption: 'Shown disabled, with the reason.' },
  unverified: { title: 'Not verified yet', caption: 'Not offered until it has been checked against the real CLI.' },
};

export function groupCapabilities(
  caps: RunnerCapabilities,
): { status: CapabilityStatus; items: { key: CapabilityKey; label: string; cap: Capability }[] }[] {
  const order: CapabilityStatus[] = ['supported', 'unsupported', 'unverified'];
  return order
    .map((status) => ({
      status,
      items: CAPABILITY_ORDER.filter((k) => caps[k]?.status === status).map((key) => ({
        key,
        label: CAPABILITY_LABELS[key],
        cap: caps[key],
      })),
    }))
    .filter((g) => g.items.length > 0);
}

/** Absolute timestamp for session info ("14 Oct, 09:41"). */
export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A title for a session started from a "compose" request: the first words of the text. */
export function titleFromText(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (!one) return 'New session';
  return one.length > 48 ? `${one.slice(0, 45).trimEnd()}…` : one;
}
