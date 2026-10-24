import { useEffect, useState } from 'react';
import { useShell } from '../../state/shell';
import { Icon } from '../../ui/Icon';
import { ConfirmSheet, EmptyState, PromptSheet, Sheet } from '../../ui/components';
import type { LocalAi } from '../../services/ai/LocalAi';
import { sheetComplete, thumbOf, type Character } from '../../services/ai/Characters';
import { useCharacters } from './useCharacters';
import { CharacterWizard } from './CharacterWizard';
import './characters.css';

/**
 * Characters: the library of made-up adults you have created, and the walk-through that makes a new
 * one. It opens over Make like the gallery does. The library lists from cloud storage when the AI
 * machine is off; making or changing a character needs the machine.
 */
export function CharactersScreen({
  ai,
  machineOn,
  open,
  onClose,
  onUse,
  reloadKey = 0,
}: {
  ai: LocalAi;
  machineOn: boolean;
  open: boolean;
  onClose: () => void;
  /** Use this character in Make. */
  onUse: (c: Character) => void;
  reloadKey?: number;
}) {
  const toast = useShell((s) => s.toast);
  const lib = useCharacters(ai, { machineOn, active: open, tick: reloadKey });
  const [mode, setMode] = useState<'library' | 'wizard'>('library');
  const [editing, setEditing] = useState<Character | null>(null);
  const [wizardKey, setWizardKey] = useState(0);
  const [shown, setShown] = useState<Character | null>(null);
  const [renaming, setRenaming] = useState<Character | null>(null);
  const [deleting, setDeleting] = useState<Character | null>(null);

  // Closed while the wizard was open: come back to the library next time.
  useEffect(() => {
    if (!open) setShown(null);
  }, [open]);

  const startNew = () => {
    setEditing(null);
    setWizardKey((n) => n + 1);
    setMode('wizard');
  };
  const edit = (c: Character) => {
    setShown(null);
    setEditing(c);
    setWizardKey((n) => n + 1);
    setMode('wizard');
  };
  const backToLibrary = () => {
    setMode('library');
    void lib.reload();
  };

  const ready = (c: Character) => c.status === 'ready';
  const off = !machineOn;

  const note = (() => {
    if (lib.error) return lib.error;
    if (off && lib.library?.unconfigured) return 'Your characters show here with the AI machine off once storage keys are added. Turn the machine on to see and make them.';
    if (off) return 'Showing what is saved in cloud storage. Turn on the AI machine to make or change characters.';
    return null;
  })();

  const act = async (what: () => Promise<unknown>, done?: string) => {
    try {
      await what();
      if (done) toast(done, 'info');
      await lib.reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <>
      <header className="mk-screen-head">
        <div>
          <p className="o5-kicker">Characters</p>
          <h3 className="o5-chapter-title">{mode === 'wizard' ? (editing ? `Edit ${editing.name}` : 'Make a character') : 'Your characters'}</h3>
        </div>
        <div className="mk-screen-acts">
          {mode === 'library' ? (
            <>
              <button type="button" className="mk-top-btn" disabled={off} title={off ? 'Turn on the AI machine to make a character' : undefined} onClick={startNew}>
                <Icon name="plus" size={18} />
                <span>Create character</span>
              </button>
              <button type="button" className="mk-top-btn" onClick={onClose}>
                <Icon name="back" size={18} />
                <span>Back to making</span>
              </button>
            </>
          ) : (
            <button type="button" className="mk-top-btn" onClick={backToLibrary}>
              <Icon name="back" size={18} />
              <span>Your characters</span>
            </button>
          )}
        </div>
      </header>

      {mode === 'wizard' ? (
        <CharacterWizard
          key={wizardKey}
          api={lib.api}
          machineOn={machineOn}
          isActive={open}
          existing={editing}
          onChanged={lib.put}
          onSaved={(c) => {
            lib.put(c);
            toast(`${c.name} is saved. Add them in Make.`, 'info');
            backToLibrary();
          }}
        />
      ) : (
        <div className="mk-screen-scroll">
          <p className="chr-intro">
            Made-up adults, 25 or older, that you create here from words. Add one to any picture or video in Make, or pick one as the new person in Swap a person. Photos you upload still work as before; for adult results a character is needed.
          </p>
          {note && (
            <p className="ai-muted chr-note" role="status">
              {note}
            </p>
          )}
          {lib.characters.length === 0 && !lib.loading ? (
            <EmptyState
              icon="user"
              title="No characters yet"
              action={
                <button type="button" className="btn primary" disabled={off} onClick={startNew}>
                  <Icon name="plus" size={16} /> Create character
                </button>
              }
            >
              {off ? 'Turn on the AI machine to make your first character.' : 'Make your first character. It takes a few minutes on your AI machine.'}
            </EmptyState>
          ) : (
            <ul className="chr-grid" aria-label="Your characters">
              {lib.characters.map((c, n) => {
                const pic = thumbOf(c);
                return (
                  <li key={c.id} style={{ '--i': Math.min(n, 12) } as React.CSSProperties}>
                    <button type="button" className="chr-card" aria-label={`${c.name}, ${c.age}${ready(c) ? '' : ', unfinished'}`} onClick={() => setShown(c)}>
                      <span className="chr-card-art">{pic ? <img src={pic} alt="" loading="lazy" /> : <Icon name="user" size={32} />}</span>
                      <span className="chr-card-name">{c.name}</span>
                      <span className="chr-card-meta">Made-up adult · {c.age}</span>
                      {!ready(c) && <span className="chr-badge">{c.sheetStale ? 'Sheet to redo' : 'Unfinished'}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {shown && (
        <Sheet title={shown.name} onClose={() => setShown(null)}>
          <div className="chr-detail">
            <p className="ai-muted">
              Made-up adult · {shown.age} · {shown.traits.style === 'anime' ? 'Anime' : shown.traits.style === 'illustration' ? 'Illustration' : 'Photoreal'}
              {!ready(shown) ? ' · not finished' : ''}
            </p>
            {shown.sheet.length > 0 ? (
              <ul className="chr-tiles chr-tiles-small" aria-label={`${shown.name}'s reference sheet`}>
                {shown.sheet.map((v) => (
                  <li key={v.view} className="chr-tile">
                    <div className="chr-tile-art">
                      <img src={v.url} alt={`${v.label} view`} loading="lazy" />
                    </div>
                    <div className="chr-tile-foot">
                      <span className="chr-tile-label">{v.label}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ai-muted">No pictures yet.</p>
            )}
            <p className="chr-desc">{shown.descriptor}</p>
            <div className="chr-detail-acts">
              {ready(shown) ? (
                <button
                  type="button"
                  className="btn primary"
                  disabled={off}
                  onClick={() => {
                    onUse(shown);
                    setShown(null);
                  }}
                >
                  <Icon name="image" size={16} /> Use in Make
                </button>
              ) : (
                <button type="button" className="btn primary" disabled={off} onClick={() => edit(shown)}>
                  <Icon name="forward" size={16} /> {sheetComplete(shown) && !shown.sheetStale ? 'Finish and save' : 'Continue'}
                </button>
              )}
              {ready(shown) && (
                <button type="button" className="btn" disabled={off} onClick={() => edit(shown)}>
                  <Icon name="pencil" size={16} /> Edit
                </button>
              )}
              <button type="button" className="btn" disabled={off} onClick={() => setRenaming(shown)}>
                <Icon name="text" size={16} /> Rename
              </button>
              <button
                type="button"
                className="btn"
                disabled={off}
                onClick={() => {
                  const c = shown;
                  setShown(null);
                  void act(() => lib.api.duplicate(c.id), `${c.name} was copied.`);
                }}
              >
                <Icon name="copy" size={16} /> Duplicate
              </button>
              <button type="button" className="btn danger" disabled={off} onClick={() => setDeleting(shown)}>
                <Icon name="trash" size={16} /> Delete
              </button>
            </div>
            {off && <p className="ai-muted chr-note">Turn on the AI machine to use, change or delete characters.</p>}
          </div>
        </Sheet>
      )}
      {renaming && (
        <PromptSheet
          title="Rename"
          label="Name"
          initial={renaming.name}
          confirmLabel="Rename"
          validate={(v) => (v.trim() ? null : 'Give them a name.')}
          onSubmit={async (v) => {
            const c = renaming;
            await lib.api.rename(c.id, v.trim());
            setRenaming(null);
            setShown(null);
            toast('Renamed.', 'info');
            await lib.reload();
          }}
          onCancel={() => setRenaming(null)}
        />
      )}
      {deleting && (
        <ConfirmSheet
          title={`Delete ${deleting.name}?`}
          message="Their reference sheet is removed from your AI machine and cloud storage. Pictures and videos you already made with them stay in your gallery."
          confirmLabel="Delete"
          destructive
          onConfirm={() => {
            const c = deleting;
            setDeleting(null);
            setShown(null);
            lib.drop(c.id);
            void act(() => lib.api.remove(c.id), `${c.name} was deleted.`);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}
