import { useRef } from 'react';
import { SIcon } from '../ui/StudioIcon';
import { BrushPreview } from './BrushPreview';
import { LIBRARY_GROUPS } from './presets';
import type { Brush } from './types';

/**
 * The brush library: every built-in brush and your own, each shown by the stroke it makes. Picking one
 * sets it for the tool in hand (any brush can erase or smudge, the way painting apps work).
 */
export function BrushPanel({
  brushes,
  current,
  toolLabel,
  onPick,
  onEdit,
  onDuplicate,
  onImport,
  onDelete,
}: {
  brushes: Brush[];
  current: string;
  toolLabel: string;
  onPick: (b: Brush) => void;
  onEdit: (b: Brush) => void;
  onDuplicate: (b: Brush) => void;
  onImport: (file: File) => void;
  onDelete: (b: Brush) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const groups = [...LIBRARY_GROUPS, 'Mine'];
  const cur = brushes.find((b) => b.id === current) ?? null;
  return (
    <div className="ldx-brushes">
      <p className="ldx-note">
        <strong>{toolLabel}</strong> with the brush you pick. Double-tap one (or “Change this brush”) to change how it draws.
      </p>
      {groups.map((g) => {
        const list = brushes.filter((b) => (g === 'Mine' ? !b.builtin : b.builtin && b.group === g));
        if (!list.length) return null;
        return (
          <section key={g} className="ldx-brush-group" aria-label={g}>
            <h4 className="ldx-sub">{g === 'Mine' ? 'My brushes' : g}</h4>
            <ul className="ldx-brush-list" role="radiogroup" aria-label={`${g} brushes`}>
              {list.map((b) => (
                <li key={b.id}>
                  <button type="button" role="radio" aria-checked={b.id === current} className="ldx-brush" onClick={() => onPick(b)} onDoubleClick={() => onEdit(b)}>
                    <span className="ldx-brush-name">{b.name}</span>
                    <BrushPreview brush={b} width={150} height={40} className="ldx-brush-art" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <div className="ldx-actions">
        {cur && (
          <>
            <button type="button" className="ldx-link" onClick={() => onEdit(cur)}>
              <SIcon name="edit" size={16} /> Change this brush
            </button>
            <button type="button" className="ldx-link" onClick={() => onDuplicate(cur)}>
              <SIcon name="copy" size={16} /> Duplicate
            </button>
            {!cur.builtin && (
              <button type="button" className="ldx-link ldx-danger" onClick={() => onDelete(cur)}>
                <SIcon name="trash" size={16} /> Delete
              </button>
            )}
          </>
        )}
        <button type="button" className="ldx-link" onClick={() => file.current?.click()}>
          <SIcon name="upload" size={16} /> Bring in a brush
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Brush file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
