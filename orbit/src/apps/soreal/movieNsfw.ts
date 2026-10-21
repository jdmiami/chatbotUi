import type { Movie, StudioItem } from '../../services/ai/LocalAi';
import { isNsfw } from '../../ui/nsfw';
import { nsfwFor } from '../../ui/nsfwFlags';

/**
 * One verdict for a whole movie: every shot and picture comes from the same story. NSFW when its
 * words are, or the AI machine's check (or your own say) on any picture or shot in it is.
 */
export function movieNsfw(m: Movie, itemById: Map<string, StudioItem>): boolean {
  const madeIds = [m.render?.itemId, m.lead?.itemId, ...m.shots.map((s) => s.itemId), ...(m.frames ?? []).map((f) => f.itemId)];
  return (
    madeIds.some((id) => id && nsfwFor(id, itemById.get(id)?.nsfw === true)) ||
    isNsfw(m.idea, m.title, m.look, m.lead?.description, ...m.shots.flatMap((s) => [s.prompt, s.says, s.end]), ...(m.frames ?? []).map((f) => f.prompt))
  );
}
