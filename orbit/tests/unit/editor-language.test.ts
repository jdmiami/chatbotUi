import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, language as languageFacet } from '@codemirror/language';
import {
  fileExtension,
  LANGUAGE_LABELS,
  languageExtension,
  languageForPath,
  languageIdForPath,
  type LanguageId,
} from '../../src/apps/editor/language';

describe('languageIdForPath', () => {
  it.each<[string, LanguageId]>([
    ['src/main.js', 'javascript'],
    ['tools/build.mjs', 'javascript'],
    ['config.cjs', 'javascript'],
    ['src/App.jsx', 'jsx'],
    ['src/utils.ts', 'typescript'],
    ['src/mod.mts', 'typescript'],
    ['src/App.tsx', 'tsx'],
    ['src/app.py', 'python'],
    ['types.pyi', 'python'],
    ['README.md', 'markdown'],
    ['docs/guide.markdown', 'markdown'],
    ['config/settings.json', 'json'],
    ['public/index.html', 'html'],
    ['page.htm', 'html'],
    ['styles/site.css', 'css'],
  ])('%s → %s', (path, id) => {
    expect(languageIdForPath(path)).toBe(id);
  });

  it('is case-insensitive about extensions', () => {
    expect(languageIdForPath('NOTES.MD')).toBe('markdown');
    expect(languageIdForPath('Main.PY')).toBe('python');
    expect(languageIdForPath('App.TSX')).toBe('tsx');
  });

  it('falls back to plain text', () => {
    for (const path of ['notes.txt', 'Makefile', 'Dockerfile', '.env', '.gitignore', 'src/.hidden', 'archive.tar.gz', 'trailing.']) {
      expect(languageIdForPath(path), path).toBe('plain');
    }
  });

  it('uses only the file name, not folder names with dots', () => {
    expect(languageIdForPath('my.app/README')).toBe('plain');
    expect(languageIdForPath('v1.2/app.py')).toBe('python');
  });
});

describe('fileExtension', () => {
  it('returns the lower-case extension without the dot', () => {
    expect(fileExtension('a/b/c.Test.TS')).toBe('ts');
    expect(fileExtension('.env')).toBe('');
    expect(fileExtension('noext')).toBe('');
    expect(fileExtension('dir.d/noext')).toBe('');
  });
});

describe('languageExtension', () => {
  const ids = Object.keys(LANGUAGE_LABELS) as LanguageId[];

  it('has a human label for every language', () => {
    for (const id of ids) expect(LANGUAGE_LABELS[id]).toBeTruthy();
  });

  it('installs a CodeMirror language for every id except plain text', () => {
    for (const id of ids) {
      const state = EditorState.create({ doc: 'x', extensions: languageExtension(id) });
      const lang = state.facet(languageFacet);
      if (id === 'plain') expect(lang, id).toBeNull();
      else expect(lang, id).not.toBeNull();
    }
  });

  it('enables TypeScript/JSX dialects for .ts/.jsx/.tsx', () => {
    const tree = (path: string, doc: string) => {
      const state = EditorState.create({ doc, extensions: languageForPath(path).extension });
      return { name: state.facet(languageFacet)?.name, tree: ensureSyntaxTree(state, doc.length, 5000)!.toString() };
    };
    const jsx = 'const a = <div className="x" />;';
    const typed = 'interface A { x: number }';
    expect(tree('a.js', jsx).tree).not.toContain('JSX');
    expect(tree('a.jsx', jsx).tree).toContain('JSX');
    expect(tree('a.tsx', jsx).tree).toContain('JSX');
    expect(tree('a.ts', typed).tree).toContain('InterfaceDeclaration');
    expect(tree('a.tsx', typed).tree).toContain('InterfaceDeclaration');
    expect(tree('a.js', typed).tree).not.toContain('InterfaceDeclaration');
    expect(tree('a.ts', typed).name).toBe('typescript');
    expect(tree('a.py', 'x = 1').name).toBe('python');
    expect(tree('a.json', '{}').name).toBe('json');
    expect(tree('a.css', 'a{}').name).toBe('css');
    expect(tree('a.html', '<p>').name).toBe('html');
    expect(tree('a.md', '# x').name).toBe('markdown');
  });

  it('languageForPath bundles id, label and extension', () => {
    const info = languageForPath('src/app.py');
    expect(info.id).toBe('python');
    expect(info.label).toBe('Python');
  });
});
