/**
 * CodeMirror 6 configuration for the Code app.
 *
 * Why CodeMirror: it works with mobile Safari's touch selection handles and the iOS on-screen
 * keyboard (contenteditable based); Monaco does not officially support mobile browsers.
 *
 * Every open file gets its own EditorState (own undo history, cursor and scroll position); the
 * single EditorView swaps between them with view.setState(). Per-file and user-preference parts of
 * the configuration live in compartments so they can be reconfigured on every state.
 */
import { basicSetup } from 'codemirror';
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view';
import { Compartment, EditorState, Prec, type Extension, type StateEffect } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { languageExtension, languageIdForPath } from './language';

export const themeCompartment = new Compartment();
export const fileCompartment = new Compartment();
export const wrapCompartment = new Compartment();

export interface EditorHooks {
  /** Mod-s inside the editor. */
  onSave(): void;
  /** Every view update of the visible document. */
  onUpdate(update: ViewUpdate): void;
}

/** Tokens-based chrome on top of oneDark / the default light look. Font size is set in editor.css. */
const orbitTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--code-bg)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.55',
    overscrollBehavior: 'contain',
  },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--code-bg)',
    color: 'var(--text-3)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-tooltip': {
    fontFamily: 'var(--font-mono)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--surface-2)',
    color: 'var(--text)',
  },
  '.cm-panels.cm-panels-bottom': {
    borderTop: '1px solid var(--border)',
  },
});

export function themeExtension(dark: boolean): Extension {
  return dark ? oneDark : [];
}

export function wrapExtension(wrap: boolean): Extension {
  return wrap ? EditorView.lineWrapping : [];
}

/** Path-dependent configuration: language and the accessible name of the text area. */
export function fileExtension(path: string): Extension {
  const name = path ? path.slice(path.lastIndexOf('/') + 1) : 'No file';
  return [
    languageExtension(languageIdForPath(path)),
    EditorView.contentAttributes.of({ 'aria-label': `${name} — code editor` }),
  ];
}

export function createFileState(
  path: string,
  doc: string,
  opts: { dark: boolean; wrap: boolean; hooks: EditorHooks },
): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      // Mod-s must win over everything (and preventDefault so the browser doesn't open "Save page").
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              opts.hooks.onSave();
              return true;
            },
          },
        ]),
      ),
      basicSetup,
      keymap.of([indentWithTab]),
      EditorState.tabSize.of(4),
      fileCompartment.of(fileExtension(path)),
      themeCompartment.of(themeExtension(opts.dark)),
      wrapCompartment.of(wrapExtension(opts.wrap)),
      Prec.highest(orbitTheme),
      EditorView.updateListener.of((u) => opts.hooks.onUpdate(u)),
    ],
  });
}

/** Apply a reconfiguration to a state that isn't in the view (no history entry is created). */
export function reconfigureState(state: EditorState, effects: StateEffect<unknown> | StateEffect<unknown>[]): EditorState {
  return state.update({ effects }).state;
}
