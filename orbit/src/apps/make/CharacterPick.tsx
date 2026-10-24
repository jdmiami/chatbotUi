import { Icon } from '../../ui/Icon';
import { thumbOf, type Character } from '../../services/ai/Characters';
import './characters.css';

/**
 * "Add a character": your saved characters as chips with their face; tap one to attach it, tap it
 * again to take it off. Used on Make's Describe it step and, as "Pick one of your characters", on
 * Swap a person's "The new person" step.
 */
export function CharacterPick({
  characters,
  value,
  onChange,
  onCreate,
  swap = false,
  slot = false,
}: {
  characters: Character[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Opens Characters to make the first one. */
  onCreate?: () => void;
  swap?: boolean;
  /** In place of a photo (a starting photo, the picture to edit, who should move). */
  slot?: boolean;
}) {
  const label = slot ? 'Use one of your characters' : swap ? 'Pick one of your characters' : 'Add a character';
  return (
    <div className="chr-pick" data-testid="character-pick">
      <p className="o5-kicker">{label}</p>
      {characters.length > 0 ? (
        <div className="chr-pick-chips" role="group" aria-label={label}>
          {characters.map((c) => {
            const pic = thumbOf(c);
            return (
              <button key={c.id} type="button" className="chr-pick-chip" aria-pressed={value === c.id} onClick={() => onChange(value === c.id ? null : c.id)}>
                {pic ? <img className="chr-pick-face" src={pic} alt="" /> : <span className="chr-pick-face" aria-hidden />}
                <span>{c.name}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="chr-pick-chips">
          <button type="button" className="chr-pick-chip chr-pick-plain" onClick={() => onCreate?.()} disabled={!onCreate}>
            <Icon name="plus" size={16} />
            <span>Make a character</span>
          </button>
        </div>
      )}
      <p className="ai-muted chr-pick-note">
        {slot
          ? 'Your character goes in instead of a photo, looking the same every time.'
          : swap
          ? 'Photos of real people work as before. For adult results a character is needed: a made-up grown-up you create in Characters.'
          : 'A character is added to your words, so the same person shows up every time. Photos you upload work as before; for adult results use a character.'}
      </p>
    </div>
  );
}
