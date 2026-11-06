import { useEffect, useRef, useState } from 'react';
import type { AppProps } from '../types';
import { historyOf, type History } from './model';
import { listCharacters, loadLatest, saveCharacter, saveScene } from './store';
import type { Character } from './character';
import { Studio } from './Studio';
import { Viewer } from './Viewer';
import './flipbook.css';

/**
 * Flipbook: stick-figure animation on a U of square paper notes (docs/flipbook/DESIGN.md).
 * iPad draws; iPhone plays.
 */

/** A phone: its screen's short side is under 600 px (iPad's is 744 or more). */
const isPhone = () => typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 600;

export default function FlipbookApp({ isActive }: AppProps) {
  const [phone] = useState(isPhone);
  return <div className="fb-root">{phone ? <Viewer isActive={isActive} /> : <Drawing isActive={isActive} />}</div>;
}

function Drawing({ isActive }: { isActive: boolean }) {
  const [history, setHistory] = useState<History | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [saveLine, setSaveLine] = useState('Saved on this iPad as you draw. Backing up to your account comes in a later update.');
  const savedAt = useRef(0);

  useEffect(() => {
    let alive = true;
    void Promise.all([loadLatest(), listCharacters()]).then(([{ scene }, chars]) => {
      if (!alive) return;
      setCharacters(chars);
      setHistory(historyOf(scene));
    });
    return () => {
      alive = false;
    };
  }, []);

  // Saved a moment after each change, and straight away when the app goes to the background.
  const scene = history?.now;
  useEffect(() => {
    if (!scene || scene.updatedAt === savedAt.current) return;
    const save = () => {
      savedAt.current = scene.updatedAt;
      void saveScene(scene).then((ok) => {
        if (!ok) setSaveLine('This device would not let Flipbook save. Your drawing stays only while the app is open.');
      });
    };
    const t = setTimeout(save, 400);
    const hide = () => document.visibilityState === 'hidden' && save();
    document.addEventListener('visibilitychange', hide);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [scene]);

  // A character is saved a moment after each change to it (the walkthrough changes it stroke by stroke).
  const charTimers = useRef(new Map<string, number>());
  const onCharacter = (c: Character) => {
    setCharacters((all) => [c, ...all.filter((x) => x.id !== c.id)]);
    clearTimeout(charTimers.current.get(c.id));
    charTimers.current.set(
      c.id,
      window.setTimeout(() => {
        charTimers.current.delete(c.id);
        void saveCharacter(c).then((ok) => !ok && setSaveLine('This device would not let Flipbook save. Your drawing stays only while the app is open.'));
      }, 300),
    );
  };
  const charsNow = useRef(characters);
  charsNow.current = characters;
  useEffect(
    () => () => {
      // Closing: save any character still waiting.
      for (const id of charTimers.current.keys()) {
        const c = charsNow.current.find((x) => x.id === id);
        if (c) void saveCharacter(c);
      }
    },
    [],
  );

  // Closing the app saves whatever the last moment's wait had not saved yet.
  const latest = useRef(scene);
  latest.current = scene;
  useEffect(
    () => () => {
      const s = latest.current;
      if (s && s.updatedAt !== savedAt.current) void saveScene(s);
    },
    [],
  );

  if (!history) return <div className="fb-studio" aria-busy="true" />;
  return <Studio history={history} setHistory={(fn) => setHistory((h) => (h ? fn(h) : h))} isActive={isActive} saveLine={saveLine} characters={characters} onCharacter={onCharacter} />;
}
