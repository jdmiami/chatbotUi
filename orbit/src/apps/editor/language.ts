import type { Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';

/** Languages the Code app highlights. Anything else is edited as plain text. */
export type LanguageId =
  | 'javascript'
  | 'jsx'
  | 'typescript'
  | 'tsx'
  | 'python'
  | 'markdown'
  | 'json'
  | 'html'
  | 'css'
  | 'plain';

export const LANGUAGE_LABELS: Record<LanguageId, string> = {
  javascript: 'JavaScript',
  jsx: 'JavaScript (JSX)',
  typescript: 'TypeScript',
  tsx: 'TypeScript (TSX)',
  python: 'Python',
  markdown: 'Markdown',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  plain: 'Plain text',
};

const BY_EXTENSION: Record<string, LanguageId> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  md: 'markdown',
  markdown: 'markdown',
  json: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
};

/** The file's extension (lower-case, without the dot), or '' for none. Dotfiles like ".env" have no extension. */
export function fileExtension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/** Pure mapping from a project path to the language used for highlighting. */
export function languageIdForPath(path: string): LanguageId {
  return BY_EXTENSION[fileExtension(path)] ?? 'plain';
}

/** CodeMirror language support for a language id ([] for plain text). */
export function languageExtension(id: LanguageId): Extension {
  switch (id) {
    case 'javascript':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'typescript':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'python':
      return python();
    case 'markdown':
      return markdown();
    case 'json':
      return json();
    case 'html':
      return html();
    case 'css':
      return css();
    case 'plain':
      return [];
  }
}

export function languageForPath(path: string): { id: LanguageId; label: string; extension: Extension } {
  const id = languageIdForPath(path);
  return { id, label: LANGUAGE_LABELS[id], extension: languageExtension(id) };
}
