import { privateField, labelOf } from './agent';

/**
 * Writing help in any text box: ghost text (the next few words, Tab or tap to take them) and
 * rewrites of what you select (fix, shorter, friendlier…). Cloud AI does the work; nothing here
 * runs on password, code or card boxes, the code editor or the terminal.
 */

export type Field = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

const PLAIN_INPUTS = new Set(['text', 'search', '']);

/** A box writing help may work in. */
export function writable(el: Element | null): Field | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el.closest('[data-no-write-help], .cm-editor, .xterm, [data-own-caret]')) return null;
  if (privateField(el)) return null;
  if (el instanceof HTMLTextAreaElement) return el.readOnly || el.disabled ? null : el;
  if (el instanceof HTMLInputElement) {
    if (!PLAIN_INPUTS.has(el.type) || el.readOnly || el.disabled) return null;
    // Names, addresses, codes: the browser's own autofill knows better than a guess.
    const ac = (el.autocomplete || '').toLowerCase();
    if (ac && ac !== 'off' && ac !== 'on') return null;
    return el;
  }
  return el.isContentEditable ? el : null;
}

export function textOf(el: Field): string {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el.innerText ?? '');
}

/** The caret is at the very end (where ghost text makes sense), with nothing selected. */
export function caretAtEnd(el: Field): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.selectionStart === el.selectionEnd && el.selectionEnd === el.value.length;
  }
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.rangeCount || !el.contains(sel.focusNode)) return false;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setStart(sel.focusNode!, sel.focusOffset);
  return r.toString().trim() === '';
}

/** The selected text inside `el`, or ''. */
export function selectionIn(el: Field): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const a = el.selectionStart ?? 0, b = el.selectionEnd ?? 0;
    return el.value.slice(Math.min(a, b), Math.max(a, b));
  }
  const sel = window.getSelection();
  return sel && sel.rangeCount && el.contains(sel.anchorNode) && el.contains(sel.focusNode) ? sel.toString() : '';
}

/** Worth asking for ghost text: enough written, mid-thought, not just after a full stop + newline. */
export function wantsGhost(text: string): boolean {
  const t = text.slice(-400);
  if (t.trim().length < 8) return false;
  if (/\n\s*$/.test(t)) return false;
  if (/[`{};<>]/.test(t.slice(-40))) return false; // code-ish
  return true;
}

export function where(el: Field, app: string | null): string {
  const label = labelOf(el) || (el.getAttribute('placeholder') ?? '');
  return `${app ? `In ${app}` : 'In Orbit'}${label ? `, the "${label}" box` : ''}`;
}

export const GHOST_PROMPT =
  'You suggest how the owner\'s text continues, like a phone keyboard but smarter. Reply with ONLY the next few words (at most 12), ' +
  'no quotes, no explanation. Start with a space if a new word begins. If nothing natural follows, reply with nothing.';

export type RewriteKind = 'fix' | 'shorter' | 'friendlier' | 'formal' | 'longer' | 'translate';

export const REWRITES: { kind: RewriteKind; label: string; how: string }[] = [
  { kind: 'fix', label: 'Fix', how: 'Fix spelling, grammar and punctuation. Keep the wording and tone.' },
  { kind: 'shorter', label: 'Shorter', how: 'Make it shorter and clearer. Keep the meaning.' },
  { kind: 'friendlier', label: 'Friendlier', how: 'Make it warmer and friendlier.' },
  { kind: 'formal', label: 'Formal', how: 'Make it more formal and professional.' },
  { kind: 'longer', label: 'Expand', how: 'Expand it a little with helpful detail. Do not invent facts.' },
  { kind: 'translate', label: 'Translate', how: '' },
];

export function rewritePrompt(kind: RewriteKind, language = 'English'): string {
  const how = kind === 'translate' ? `Translate it into ${language}. If it is already in ${language}, translate it into English.` : REWRITES.find((r) => r.kind === kind)!.how;
  return `You rewrite the owner's text. ${how} Reply with ONLY the new text: no quotes, no preamble, no notes.`;
}

/** What a model sends back, tidied: thinking, wrapping quotes and "Here is…" lines removed. */
export function cleanReply(raw: string, ghost = false): string {
  let t = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/g, '');
  if (!ghost) t = t.trim();
  t = t.replace(/^(here(?:'s| is)[^:\n]*:|sure[,!.][^\n]*\n)\s*/i, '');
  const q = t.trim().match(/^(["“'])([\s\S]*)(["”'])$/);
  if (q) t = (ghost && t.startsWith(' ') ? ' ' : '') + q[2];
  if (ghost) {
    t = t.split('\n')[0];
    const words = t.trim().split(/\s+/);
    if (words.length > 14) t = (t.startsWith(' ') ? ' ' : '') + words.slice(0, 14).join(' ');
  }
  return t;
}

/** The ghost glued onto what is written: no double spaces, and a space when a word starts. */
export function joinGhost(text: string, ghost: string): string {
  if (!ghost.trim()) return '';
  if (/\s$/.test(text)) return ghost.replace(/^\s+/, '');
  // After punctuation a new word always needs a space; after a letter, the model's leading space
  // (or its absence: finishing the current word) is trusted.
  if (/[,.;:!?)]$/.test(text) && /^\w/.test(ghost)) return ` ${ghost}`;
  return ghost;
}

/** Put text in at the caret (or over the selection) the way typing would: undoable, and frameworks see it. */
export function insertText(el: Field, text: string) {
  el.focus();
  if (document.queryCommandSupported?.('insertText') && document.execCommand('insertText', false, text)) return;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const next = el.value.slice(0, a) + text + el.value.slice(b);
    setter ? setter.call(el, next) : (el.value = next);
    el.setSelectionRange(a + text.length, a + text.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const r = sel.getRangeAt(0);
    r.deleteContents();
    r.insertNode(document.createTextNode(text));
    r.collapse(false);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
