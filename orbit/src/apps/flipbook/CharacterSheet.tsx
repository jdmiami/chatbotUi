import { useState } from 'react';
import { Segmented, Sheet } from '../../ui/components';
import { newCharacter, progress, rename, setLevel, type Character } from './character';
import { LEVELS, type Level } from './rig';

/**
 * The character on this flipbook: put one on, make a new one, keep drawing its parts, change how
 * detailed its skeleton is, swap it for another, or take it off. Characters live in a library on the
 * device, so one character can be used in any flipbook.
 */
export function CharacterSheet({
  library,
  onStage,
  onClose,
  onUse,
  onSave,
  onDraw,
  onRemove,
}: {
  library: Character[];
  /** The character on this flipbook now, if any. */
  onStage: Character | null;
  onClose: () => void;
  /** Put this character on the flipbook (or swap it in). */
  onUse: (c: Character) => void;
  onSave: (c: Character) => void;
  /** Open the part-by-part drawing. */
  onDraw: (c: Character) => void;
  onRemove: () => void;
}) {
  const [making, setMaking] = useState(!library.length);
  const [name, setName] = useState('');
  const [level, setLvl] = useState<Level>('simple');
  const others = library.filter((c) => c.id !== onStage?.id);

  const make = () => {
    const c = newCharacter(name, level);
    onSave(c);
    onUse(c);
    onDraw(c);
  };

  return (
    <Sheet title={onStage ? onStage.name : 'Characters'} onClose={onClose}>
      <section className="fb-more">
        {onStage && (
          <>
            <p className="fb-hint">{line(onStage)}</p>
            <div className="fb-more-actions">
              <button type="button" className="btn primary" onClick={() => onDraw(onStage)}>
                {progress(onStage).drawn ? 'Keep drawing its parts' : 'Draw its parts'}
              </button>
            </div>
            <h3>How detailed</h3>
            <Segmented label="Skeleton detail" value={onStage.level} options={LEVELS.map((l) => ({ value: l.value, label: l.label }))} onChange={(v) => onSave(setLevel(onStage, v))} />
            <p className="fb-hint">{LEVELS.find((l) => l.value === onStage.level)!.parts}. Parts you have drawn are kept when you change this.</p>
            <h3>Name</h3>
            <input className="fb-input" aria-label="Character name" defaultValue={onStage.name} maxLength={40} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== onStage.name && onSave(rename(onStage, e.target.value))} />
          </>
        )}

        {others.length > 0 && (
          <>
            <h3>{onStage ? 'Swap for another' : 'Your characters'}</h3>
            <ul className="fb-cast-list">
              {others.map((c) => (
                <li key={c.id}>
                  <span>
                    <strong>{c.name}</strong>
                    <small>{line(c)}</small>
                  </span>
                  <button type="button" className="btn small" onClick={() => onUse(c)}>
                    {onStage ? 'Swap in' : 'Use'}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <h3>A new character</h3>
        {making ? (
          <div className="fb-new">
            <input className="fb-input" aria-label="New character's name" placeholder="Name, e.g. Jumpy" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            <Segmented label="Skeleton detail" value={level} options={LEVELS.map((l) => ({ value: l.value, label: l.label }))} onChange={setLvl} />
            <p className="fb-hint">{LEVELS.find((l) => l.value === level)!.parts}. You can change it later.</p>
            <button type="button" className="btn primary" onClick={make}>
              Make it and start drawing
            </button>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setMaking(true)}>
            Make a new character
          </button>
        )}

        {onStage && (
          <>
            <h3>Take it off</h3>
            <button type="button" className="btn danger" onClick={onRemove}>
              Take {onStage.name} off this flipbook
            </button>
            <p className="fb-hint">Its poses on these notes go too (undo brings them back). The character stays in your library.</p>
          </>
        )}
      </section>
    </Sheet>
  );
}

function line(c: Character): string {
  const { drawn, total } = progress(c);
  const lvl = LEVELS.find((l) => l.value === c.level)!.label;
  return `${lvl} · ${drawn} of ${total} parts drawn${c.eyes.some((l) => l.length) ? ' · has eyes' : ''}${c.mouths.some((l) => l.length) ? ' · has a mouth' : ''}`;
}
