import { useCallback, useEffect, useRef, useState } from 'react';
import { useShell } from '../../state/shell';
import { NOT_POSSIBLE, cloudReady, cloudText } from '../../services/ai/CloudAi';
import { caretOf } from './caret';
import { currentAssist } from './assist';
import {
  GHOST_PROMPT,
  REWRITES,
  caretAtEnd,
  cleanReply,
  insertText,
  joinGhost,
  rewritePrompt,
  selectionIn,
  textOf,
  wantsGhost,
  where,
  writable,
  type Field,
  type RewriteKind,
} from './write';

interface Ghost {
  text: string;
  x: number;
  y: number;
  h: number;
  maxW: number;
  font: string;
}

const GHOST_WAIT = 850;

function language() {
  try {
    const code = (navigator.language || 'en').split('-')[0];
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? 'English';
  } catch {
    return 'English';
  }
}

/** What the step this box belongs to is about (a walkthrough told the orb), so the words fit it. */
function stepOf(field: Field): string {
  const a = currentAssist();
  return a?.target && (a.target === field || a.target.contains(field)) ? `. ${a.context}` : '';
}

/** Ghost text and rewrites in whichever text box you are typing in (see write.ts). */
export function WriteHelp() {
  const enabled = useShell((s) => s.settings.cloudAi !== false && s.settings.writeHelp !== false);
  const [field, setField] = useState<Field | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [chip, setChip] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ready = useRef<boolean | null>(null);
  const ask = useRef<AbortController | null>(null);
  const timer = useRef(0);

  const clearGhost = useCallback(() => {
    ask.current?.abort();
    window.clearTimeout(timer.current);
    setGhost(null);
  }, []);

  // Which box are we in?
  useEffect(() => {
    if (!enabled) return;
    const onFocus = (e: FocusEvent) => {
      const el = writable(e.target as Element);
      setField(el);
      if (el && ready.current === null) void cloudReady().then((ok) => (ready.current = ok));
    };
    const onBlur = (e: FocusEvent) => {
      // Tapping the chip or menu keeps the selection (pointerdown is prevented there).
      if ((e.relatedTarget as Element | null)?.closest?.('.wh-ui')) return;
      setField((f) => (f === e.target ? null : f));
    };
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    const active = writable(document.activeElement);
    if (active) {
      setField(active);
      void cloudReady().then((ok) => (ready.current = ok));
    }
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
    };
  }, [enabled]);

  // The orb is offering words for this box (a walkthrough step): the ghost steps aside for it.
  useEffect(() => {
    window.addEventListener('orb:offer', clearGhost);
    return () => window.removeEventListener('orb:offer', clearGhost);
  }, [clearGhost]);

  useEffect(() => {
    if (!field) {
      clearGhost();
      setChip(null);
      setMenu(false);
    }
  }, [field, clearGhost]);

  // Ghost text: a pause after typing at the end of the text asks for the next few words.
  useEffect(() => {
    if (!field || !enabled) return;
    const place = (text: string): Ghost | null => {
      const c = caretOf(field as HTMLElement);
      if (!c) return null;
      const box = field.getBoundingClientRect();
      const s = getComputedStyle(field);
      return { text, x: c.x + 1, y: c.y, h: c.h, maxW: Math.max(0, box.right - parseFloat(s.paddingRight || '0') - c.x - 2), font: `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}` };
    };
    const onInput = () => {
      clearGhost();
      if (!ready.current) return;
      timer.current = window.setTimeout(async () => {
        const before = textOf(field);
        if (!caretAtEnd(field) || !wantsGhost(before)) return;
        const ctrl = new AbortController();
        ask.current = ctrl;
        try {
          const raw = await cloudText({
            task: 'fast',
            maxTokens: 40,
            temperature: 0.3,
            signal: ctrl.signal,
            messages: [
              { role: 'system', content: GHOST_PROMPT },
              { role: 'user', content: `${where(field, useShell.getState().activeApp)}${stepOf(field)}. Text so far:\n${before.slice(-1500)}` },
            ],
          });
          if (ctrl.signal.aborted || textOf(field) !== before || document.activeElement !== field) return;
          const add = joinGhost(before, cleanReply(raw, true));
          const g = add ? place(add) : null;
          if (g && g.maxW > 24) setGhost(g);
        } catch {
          /* quiet: ghost text is a nicety */
        }
      }, GHOST_WAIT);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && !e.shiftKey && ghostRef.current) {
        e.preventDefault();
        const add = ghostRef.current.text;
        clearGhost();
        insertText(field, add);
      } else if (e.key === 'Escape' && ghostRef.current) {
        e.preventDefault();
        clearGhost();
      }
    };
    const onScroll = () => clearGhost();
    (field as HTMLElement).addEventListener('input', onInput);
    (field as HTMLElement).addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      (field as HTMLElement).removeEventListener('input', onInput);
      (field as HTMLElement).removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      clearGhost();
    };
  }, [field, enabled, clearGhost]);

  const ghostRef = useRef<Ghost | null>(null);
  ghostRef.current = ghost;

  // Rewrite chip: appears over a selection of a few words or more.
  useEffect(() => {
    if (!field || !enabled) return;
    const onSel = () => {
      if (busy) return;
      const picked = selectionIn(field).trim();
      if (picked.length < 3 || !ready.current) {
        setChip(null);
        setMenu(false);
        return;
      }
      const c = caretOf(field as HTMLElement);
      const box = field.getBoundingClientRect();
      const x = Math.min(Math.max((c?.x ?? box.left) - 60, 8), window.innerWidth - 180);
      const above = (c?.y ?? box.top) - 52;
      setChip({ x, y: above > 8 ? above : (c ? c.y + c.h + 8 : box.bottom + 8) });
    };
    document.addEventListener('selectionchange', onSel);
    field.addEventListener('select', onSel);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      field.removeEventListener('select', onSel);
    };
  }, [field, enabled, busy]);

  const rewrite = async (kind: RewriteKind, label: string) => {
    if (!field) return;
    const picked = selectionIn(field);
    if (!picked.trim()) return;
    setBusy(label);
    try {
      const raw = await cloudText({
        // Unfiltered: your words are rewritten as asked, adult ones too.
        task: 'free',
        maxTokens: Math.min(2000, Math.ceil(picked.length / 2) + 200),
        temperature: 0.3,
        messages: [
          { role: 'system', content: rewritePrompt(kind, language()) },
          { role: 'user', content: picked },
        ],
      });
      const out = cleanReply(raw);
      if (out === NOT_POSSIBLE) {
        useShell.getState().toast('Rewrite never writes anything sexual involving anyone under 18.', 'error');
        return;
      }
      // Only replace if the same words are still selected.
      if (out && selectionIn(field) === picked) insertText(field, out);
    } catch (err) {
      useShell.getState().toast(`Writing help: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(null);
      setMenu(false);
      setChip(null);
    }
  };

  // Make a picture or video of the selected words (the orb does it, from wherever you are).
  const make = (kind: 'picture' | 'video') => {
    const picked = field ? selectionIn(field).trim() : '';
    setMenu(false);
    setChip(null);
    if (picked) window.dispatchEvent(new CustomEvent('orbit:orb-run', { detail: `make a ${kind} of ${picked.slice(0, 600)}` }));
  };

  if (!enabled || !field) return null;
  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();
  return (
    <>
      {ghost && (
        <button
          type="button"
          className="wh-ui wh-ghost"
          aria-label={`Suggestion: ${ghost.text.trim()}. Tap to add it.`}
          style={{ left: ghost.x, top: ghost.y, height: ghost.h, lineHeight: `${ghost.h}px`, maxWidth: ghost.maxW, font: ghost.font }}
          onPointerDown={keep}
          onMouseDown={keep}
          onClick={() => {
            const add = ghost.text;
            clearGhost();
            insertText(field, add);
          }}
        >
          {ghost.text}
          <span className="wh-ghost-key" aria-hidden>
            tab
          </span>
        </button>
      )}
      {chip && (
        <div className="wh-ui wh-chip" style={{ left: chip.x, top: chip.y }} onPointerDown={keep} onMouseDown={keep} role={menu ? 'menu' : undefined} aria-label="Rewrite">
          {!menu ? (
            <button type="button" className="wh-chip-main" onClick={() => setMenu(true)}>
              <span aria-hidden>✦</span> Rewrite
            </button>
          ) : (
            <>
              {REWRITES.map((r) => (
                <button key={r.kind} type="button" role="menuitem" disabled={busy !== null} onClick={() => void rewrite(r.kind, r.label)}>
                  {busy === r.label ? '…' : r.label}
                </button>
              ))}
              {(['picture', 'video'] as const).map((kind) => (
                <button key={kind} type="button" role="menuitem" disabled={busy !== null} onClick={() => make(kind)}>
                  {kind === 'picture' ? 'Picture' : 'Video'}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}
