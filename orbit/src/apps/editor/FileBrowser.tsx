import { useMemo } from 'react';
import type { FileEntry } from '../../services/files/types';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/components';
import { formatBytes, relativeTime } from '../../ui/format';
import { buildTree, visibleRows } from './model';

/**
 * Project tree: implicit folders (collapsible), files with size and last-modified time,
 * and a persistent note about where files are stored. Used as the docked sidebar and,
 * on narrow layouts, inside a sheet.
 */
export function FileBrowser({
  entries,
  loading,
  rootName,
  storageNote,
  activePath,
  dirtyPaths,
  collapsed,
  onToggleFolder,
  onOpen,
  onNewFile,
  onFileActions,
  variant,
}: {
  entries: FileEntry[];
  loading: boolean;
  rootName: string;
  storageNote: string;
  activePath: string | null;
  dirtyPaths: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
  onOpen: (path: string) => void;
  onNewFile: () => void;
  onFileActions: (path: string) => void;
  variant: 'sidebar' | 'sheet';
}) {
  const rows = useMemo(() => visibleRows(buildTree(entries), collapsed), [entries, collapsed]);
  const now = Date.now();

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

      {loading ? (
        <p className="ed-browser-empty muted">Loading files…</p>
      ) : rows.length === 0 ? (
        <p className="ed-browser-empty muted">This project has no files yet. Use “New file” to create one.</p>
      ) : (
        <ul className="ed-tree" aria-label={`Files in ${rootName}`}>
          {rows.map(({ node, depth }) => {
            const indent = { paddingLeft: `calc(${depth} * 16px + 8px)` };
            if (node.kind === 'folder') {
              const open = !collapsed.has(node.path);
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
            }
            const current = node.path === activePath;
            const dirty = dirtyPaths.has(node.path);
            return (
              <li key={`f:${node.path}`} className="ed-tree-item">
                <button
                  type="button"
                  className="ed-tree-row ed-tree-file"
                  style={indent}
                  aria-current={current ? 'true' : undefined}
                  onClick={() => onOpen(node.path)}
                  title={node.path}
                >
                  <span className="ed-tree-chevron-space" aria-hidden />
                  <Icon name="file" size={18} />
                  <span className="ed-tree-text">
                    <span className="ed-tree-name">
                      <span className="ed-tree-label">{node.name}</span>
                      {dirty && (
                        <>
                          <span className="ed-dot" aria-hidden />
                          <span className="visually-hidden">, edited</span>
                        </>
                      )}
                    </span>
                    <span className="ed-tree-meta">
                      {formatBytes(node.entry.size)} · {relativeTime(node.entry.updatedAt, now)}
                    </span>
                  </span>
                </button>
                <IconButton
                  icon="more"
                  label={`Actions for ${node.name}`}
                  className="ed-tree-more"
                  onClick={() => onFileActions(node.path)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
