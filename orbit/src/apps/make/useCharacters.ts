import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocalAi } from '../../services/ai/LocalAi';
import { CharactersApi, storedCharacters, type Character, type CharacterLibrary } from '../../services/ai/Characters';

/**
 * Your characters. From the AI machine when it is on, from cloud storage when it is off (so the
 * library still shows). `tick` asks for a fresh list (something changed elsewhere).
 */
export function useCharacters(ai: LocalAi, { machineOn, active, tick = 0 }: { machineOn: boolean; active: boolean; tick?: number }) {
  const api = useMemo(() => new CharactersApi(ai), [ai]);
  const [library, setLibrary] = useState<CharacterLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      let next: CharacterLibrary | null = null;
      if (machineOn) {
        try {
          next = { characters: await api.list(), source: 'machine' };
        } catch {
          next = await storedCharacters();
        }
      } else {
        next = await storedCharacters();
      }
      if (mine !== seq.current) return;
      setLibrary(next ?? { characters: [], source: 'storage', unconfigured: true });
      setError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      setError((err as Error).message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [api, machineOn]);

  useEffect(() => {
    if (active) void reload();
  }, [active, reload, tick]);

  /** Put a changed character into the list now (the list is then refreshed when asked to). */
  const put = useCallback((c: Character) => {
    setLibrary((lib) => {
      const rest = (lib?.characters ?? []).filter((x) => x.id !== c.id);
      return { source: lib?.source ?? 'machine', characters: [c, ...rest] };
    });
  }, []);
  const drop = useCallback((id: string) => setLibrary((lib) => (lib ? { ...lib, characters: lib.characters.filter((x) => x.id !== id) } : lib)), []);

  const characters = library?.characters ?? [];
  return { api, library, characters, ready: characters.filter((c) => c.status === 'ready'), error, loading, reload, put, drop };
}
