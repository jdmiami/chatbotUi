import { useSyncExternalStore, type MouseEvent } from 'react';
import type { EditorState } from '@codemirror/state';
import { redoDepth, undoDepth } from '@codemirror/commands';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/components';

export interface CursorInfo {
  line: number;
  col: number;
  canUndo: boolean;
  canRedo: boolean;
}

/** Tiny external store so cursor moves re-render only the toolbar, not the whole app. */
export function createCursorStore() {
  let snap: CursorInfo = { line: 1, col: 1, canUndo: false, canRedo: false };
  const listeners = new Set<() => void>();
  return {
    get: () => snap,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(state: EditorState) {
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      const next: CursorInfo = {
        line: line.number,
        col: head - line.from + 1,
        canUndo: undoDepth(state) > 0,
        canRedo: redoDepth(state) > 0,
      };
      if (
        next.line === snap.line &&
        next.col === snap.col &&
        next.canUndo === snap.canUndo &&
        next.canRedo === snap.canRedo
      )
        return;
      snap = next;
      listeners.forEach((l) => l());
    },
  };
}
export type CursorStore = ReturnType<typeof createCursorStore>;

export type ToolbarCommand = 'undo' | 'redo' | 'indent' | 'outdent' | 'find';

/** Indent / outdent glyphs (not in the shared icon set). Decorative: the button carries the label. */
function IndentGlyph({ outdent }: { outdent?: boolean }) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <path d={outdent ? 'M4 5h16M11 10h9M11 14h9M4 19h16M8 9l-4 3 4 3' : 'M4 5h16M11 10h9M11 14h9M4 19h16M4 9l4 3-4 3'} />
    </svg>
  );
}

/** Keep focus (and the iOS keyboard) in the editor when tapping a toolbar button. */
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * Touch helpers: visible alternatives to keyboard shortcuts the iOS soft keyboard lacks
 * (Tab, Shift-Tab, ⌘Z, ⌘F, ⌘S). Sits at the bottom of the editor so it stays above the keyboard.
 */
export function EditorToolbar({
  cursor,
  compact,
  language,
  dirty,
  onCommand,
  onSave,
  onAsk,
}: {
  cursor: CursorStore;
  compact: boolean;
  language: string;
  dirty: boolean;
  onCommand: (cmd: ToolbarCommand) => void;
  onSave: () => void;
  onAsk: () => void;
}) {
  const info = useSyncExternalStore(cursor.subscribe, cursor.get, cursor.get);
  return (
    <div className="ed-toolbar" role="toolbar" aria-label="Editing tools">
      <IconButton icon="undo" label="Undo" disabled={!info.canUndo} onMouseDown={keepFocus} onClick={() => onCommand('undo')} />
      <IconButton icon="redo" label="Redo" disabled={!info.canRedo} onMouseDown={keepFocus} onClick={() => onCommand('redo')} />
      <span className="ed-toolbar-sep" aria-hidden />
      <button
        type="button"
        className="icon-btn"
        aria-label="Outdent"
        title="Outdent (Shift-Tab)"
        onMouseDown={keepFocus}
        onClick={() => onCommand('outdent')}
      >
        <IndentGlyph outdent />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Indent"
        title="Indent (Tab)"
        onMouseDown={keepFocus}
        onClick={() => onCommand('indent')}
      >
        <IndentGlyph />
      </button>
      <span className="ed-toolbar-sep" aria-hidden />
      <IconButton icon="search" label="Find and replace" onMouseDown={keepFocus} onClick={() => onCommand('find')} />
      {!compact && (
        <IconButton icon="sparkle" label="Ask Antigravity about this file" onMouseDown={keepFocus} onClick={onAsk} />
      )}
      <span className="ed-toolbar-status" aria-live="off">
        {!compact && <span className="ed-toolbar-lang">{language}</span>}
        <span className="mono" title={`Line ${info.line}, column ${info.col}`}>
          {compact ? `${info.line}:${info.col}` : `Ln ${info.line}, Col ${info.col}`}
        </span>
      </span>
      <button
        type="button"
        className={`btn ed-toolbar-save ${dirty ? 'primary' : 'ghost'}`}
        onMouseDown={keepFocus}
        onClick={onSave}
      >
        <Icon name="save" size={18} />
        Save
      </button>
    </div>
  );
}
