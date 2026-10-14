import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { FileEntry } from '../../services/files/types';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/components';
import { formatBytes, relativeTime, splitPath } from '../../ui/format';
import { buildTree, filterEntries, visibleRows } from './model';

/** Rows rendered at once in the tree; more appear with "Show more" so huge folders stay smooth. */
const ROW_PAGE = 400;
/** Filter results rendered at most. */
const FILTER_LIMIT = 200;

/** "Collapse all" glyph (not in the shared icon set). Decorative: the button carries the label. */
function CollapseGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <path d="M7 4l5 5 5-5M7 20l5-5 5 5" />
    </svg>
  );
}

export type ListStatus = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };

/**
 * Project tree: implicit folders (collapsible), files with size and last-modified time, a filter
 * box, and a persistent note about where files are stored. Used as the docked sidebar and, on
 * narrow layouts, inside a sheet. Works for both the browser-local demo project and a real
 * project on the Linux machine (async, can fail, can have thousands of files).
 */
export function FileBrowser({
  entries,
  status,
  rootName,
  storageNote,
  activePath,
  dirtyPaths,
  openingPaths,
  isCollapsed,
  query,
  onQueryChange,
  onToggleFolder,
  onCollapseAll,
  onOpen,
  onNewFile,
  onFileActions,
  onRetry,
  variant,
}: {
  entries: FileEntry[];
  status: ListStatus;
  rootName: string;
  storageNote: string;
  activePath: string | null;
  dirtyPaths: ReadonlySet<string>;
  openingPaths: ReadonlySet<string>;
  isCollapsed: (folderPath: string) => boolean;
  query: string;
  onQueryChange: (q: string) => void;
  onToggleFolder: (path: string) => void;
  onCollapseAll: () => void;
  onOpen: (path: string) => void;
  onNewFile: () => void;
  onFileActions: (path: string) => void;
  onRetry: () => void;
  variant: 'sidebar' | 'sheet';
}) {
  const filterId = useId();
  const tree = useMemo(() => buildTree(entries), [entries]);
  const rows = useMemo(() => visibleRows(tree, isCollapsed), [tree, isCollapsed]);
  const filtering = query.trim().length > 0;
  const filtered = useMemo(() => (filtering ? filterEntries(entries, query, FILTER_LIMIT) : null), [entries, query, filtering]);
  const [rowLimit, setRowLimit] = useState(ROW_PAGE);
  const now = Date.now();
  const hasFolders = tree.some((n) => n.kind === 'folder');

  // A different tree shape starts from the first page again.
  useEffect(() => setRowLimit(ROW_PAGE), [isCollapsed, entries]);

  const onFilterKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && query) {
      e.preventDefault();
      e.stopPropagation(); // clear the filter instead of closing the sheet
      onQueryChange('');
    } else if (e.key === 'Enter' && filtered?.matches[0]) {
      e.preventDefault();
      onOpen(filtered.matches[0].path);
    }
  };

  const fileRow = (entry: FileEntry, label: string, sub: string | null, style?: React.CSSProperties) => {
    const current = entry.path === activePath;
    const dirty = dirtyPaths.has(entry.path);
    const opening = openingPaths.has(entry.path);
    return (
      <li key={`f:${entry.path}`} className="ed-tree-item">
        <button
          type="button"
          className="ed-tree-row ed-tree-file"
          style={style}
          aria-current={current ? 'true' : undefined}
          aria-busy={opening || undefined}
          onClick={() => onOpen(entry.path)}
          title={entry.path}
        >
          {!sub && <span className="ed-tree-chevron-space" aria-hidden />}
          <Icon name="file" size={18} />
          <span className="ed-tree-text">
            <span className="ed-tree-name">
              <span className="ed-tree-label">{label}</span>
              {dirty && (
                <>
                  <span className="ed-dot" aria-hidden />
                  <span className="visually-hidden">, edited</span>
                </>
              )}
            </span>
            {sub && <span className="ed-tree-meta ed-tree-dir">{sub}</span>}
            <span className="ed-tree-meta">
              {opening ? 'Opening…' : `${formatBytes(entry.size)} · ${relativeTime(entry.updatedAt, now)}`}
            </span>
          </span>
        </button>
        <IconButton
          icon="more"
          label={`Actions for ${label}`}
          className="ed-tree-more"
          onClick={() => onFileActions(entry.path)}
        />
      </li>
    );
  };

  let body: React.ReactNode;
  if (status.kind === 'loading' && entries.length === 0) {
    body = (
      <p className="ed-browser-empty muted" role="status">
        <span className="ed-spinner" aria-hidden /> Loading files…
      </p>
    );
  } else if (status.kind === 'error' && entries.length === 0) {
    body = (
      <div className="ed-browser-error" role="alert">
        <p>
          <strong>Couldn’t load the file list.</strong> {status.message}
        </p>
        <button type="button" className="btn small primary" onClick={onRetry}>
          <Icon name="refresh" size={18} />
          Retry
        </button>
      </div>
    );
  } else if (entries.length === 0) {
    body = <p className="ed-browser-empty muted">This project has no files yet. Use “New file” to create one.</p>;
  } else if (filtered) {
    body =
      filtered.total === 0 ? (
        <p className="ed-browser-empty muted" role="status">
          No files match “{query.trim()}”.
        </p>
      ) : (
        <>
          <p className="ed-browser-count muted" role="status">
            {filtered.total > filtered.matches.length
              ? `Showing ${filtered.matches.length} of ${filtered.total} matches. Type more to narrow it down.`
              : `${filtered.total} match${filtered.total === 1 ? '' : 'es'}`}
          </p>
          <ul className="ed-tree" aria-label={`Files matching ${query.trim()}`}>
            {filtered.matches.map((e) => {
              const { name, dir } = splitPath(e.path);
              return fileRow(e, name, dir || rootName);
            })}
          </ul>
        </>
      );
  } else {
    const shown = rows.slice(0, rowLimit);
    body = (
      <>
        <ul className="ed-tree" aria-label={`Files in ${rootName}`}>
          {shown.map(({ node, depth }) => {
            const indent = { paddingLeft: `calc(${depth} * 16px + 8px)` };
            if (node.kind === 'file') return fileRow(node.entry, node.name, null, indent);
            const open = !isCollapsed(node.path);
            return (
              <li key={`d:${node.path}`}>
                <button
                  type="button"
                  className="ed-tree-row ed-tree-folder"
                  style={indent}
                  aria-expanded={open}
                  onClick={() => onToggleFolder(node.path)}
                >
                  <Icon name={open ? 'down' : 'forward'} size={16} className="ed-tree-chevron" />
                  <Icon name="folder" size={18} />
                  <span className="ed-tree-name">{node.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {rows.length > shown.length && (
          <button type="button" className="btn small ghost ed-browser-more" onClick={() => setRowLimit((n) => n + ROW_PAGE)}>
            Show more ({rows.length - shown.length} hidden)
          </button>
        )}
      </>
    );
  }

  return (
    <div className="ed-browser" data-variant={variant}>
      <div className="ed-browser-head">
        <Icon name="folder" size={20} />
        <span className="ed-browser-root" title={rootName}>
          {rootName}
        </span>
        <button type="button" className="btn small ghost ed-browser-new" onClick={onNewFile}>
          <Icon name="plus" size={18} />
          New file
        </button>
      </div>
      <p className="ed-browser-note">
        <Icon name="lock" size={16} />
        <span>{storageNote}</span>
      </p>

      {entries.length > 0 && (
        <div className="ed-filter" role="search">
          <label htmlFor={filterId} className="visually-hidden">
            Filter files
          </label>
          <Icon name="search" size={18} className="ed-filter-icon" />
          <input
            id={filterId}
            className="ed-filter-input"
            type="search"
            value={query}
            placeholder={`Filter ${entries.length} file${entries.length === 1 ? '' : 's'}`}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onFilterKey}
          />
          {query ? (
            <IconButton icon="close" iconSize={18} label="Clear filter" className="ed-filter-clear" onClick={() => onQueryChange('')} />
          ) : (
            hasFolders && (
              <button
                type="button"
                className="icon-btn ed-filter-clear"
                aria-label="Collapse all folders"
                title="Collapse all folders"
                onClick={onCollapseAll}
              >
                <CollapseGlyph />
              </button>
            )
          )}
        </div>
      )}

      {status.kind === 'error' && entries.length > 0 && (
        <div className="ed-browser-error ed-browser-error-inline" role="alert">
          <p>
            <strong>Couldn’t refresh the file list.</strong> {status.message}
          </p>
          <button type="button" className="btn small ghost" onClick={onRetry}>
            <Icon name="refresh" size={18} />
            Retry
          </button>
        </div>
      )}

      {body}
    </div>
  );
}
