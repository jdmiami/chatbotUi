import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { nsfwFor, useNsfwFlags } from './nsfwFlags';
import { useNsfwView } from './Censor';
import './ultra.css';

/**
 * NSFW Ultra: your NSFW videos played one after another like a movie, full screen, with nothing over
 * them but a pause and an exit button (which fade away while it plays; a tap brings them back).
 *
 * Two video players take turns: while one plays, the other already has the next video loaded, so
 * the cut is instant. iPhone and iPad only let a video play with sound after a tap, and only on a
 * player that tap started, so both players are made and started in the tap on the button itself
 * (`startUltra`), then handed to the screen.
 */
export interface UltraVideo {
  id: string;
  url: string;
}

interface Started {
  list: UltraVideo[];
  players: [HTMLVideoElement, HTMLVideoElement];
}

function player(url: string): HTMLVideoElement {
  const v = document.createElement('video');
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.preload = 'auto';
  v.className = 'ultra-video';
  v.src = url;
  return v;
}

/** Call in the tap itself: makes both players and starts them while the tap still counts. */
export function startUltra(list: UltraVideo[]): Started | null {
  if (!list.length) return null;
  const a = player(list[0].url);
  const b = player(list[1 % list.length].url);
  void a.play().catch(() => {});
  // The second is started and stopped at once: allowed to play with sound from now on, and loading.
  if (list.length > 1) {
    b.muted = true;
    void b
      .play()
      .then(() => {
        b.pause();
        b.currentTime = 0;
        b.muted = false;
      })
      .catch(() => {
        b.muted = false;
      });
  }
  return { list, players: [a, b] };
}

/** The NSFW videos of a list, in its order, while "Show NSFW" is on (none otherwise). */
export function useUltraList<T extends { id: string; kind: string; url?: string; nsfw?: boolean }>(items: T[]): UltraVideo[] {
  useNsfwFlags();
  const view = useNsfwView();
  if (view !== 'show') return [];
  return items.filter((it) => it.kind === 'video' && it.url && nsfwFor(it.id, it.nsfw === true)).map((it) => ({ id: it.id, url: it.url! }));
}

/** The button: shows only when there is something to play. */
export function UltraButton({ list, onStart, className = 'btn' }: { list: UltraVideo[]; onStart: (s: Started) => void; className?: string }) {
  if (!list.length) return null;
  return (
    <button
      type="button"
      className={`${className} ultra-start`}
      onClick={() => {
        const s = startUltra(list);
        if (s) onStart(s);
      }}
    >
      <Icon name="film" size={16} /> NSFW Ultra
      <span className="ultra-start-n">{list.length === 1 ? '1 video' : `${list.length} videos`}</span>
    </button>
  );
}

const HIDE_MS = 2200;

export function UltraPlayer({ started, onExit }: { started: Started; onExit: () => void }) {
  const { list, players } = started;
  const stage = useRef<HTMLDivElement | null>(null);
  // Which player is on screen, and which video of the list it holds.
  const on = useRef(0);
  const at = useRef(0);
  const [paused, setPaused] = useState(false);
  const [controls, setControls] = useState(true);
  const hideTimer = useRef<number | null>(null);

  const showControls = useCallback(() => {
    setControls(true);
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControls(false), HIDE_MS);
  }, []);

  useEffect(() => {
    const box = stage.current;
    if (!box) return;
    const [a, b] = players;
    box.append(a, b);
    a.classList.add('ultra-on');
    let gone = false;

    const next = (from: HTMLVideoElement) => {
      if (gone || players[on.current] !== from) return;
      const cur = players[on.current];
      const nxt = players[1 - on.current];
      at.current = (at.current + 1) % list.length;
      if (list.length === 1) {
        cur.currentTime = 0;
        void cur.play().catch(() => setPaused(true));
        return;
      }
      // The waiting player already holds this one: cut to it, then load the one after into the other.
      on.current = 1 - on.current;
      nxt.classList.add('ultra-on');
      cur.classList.remove('ultra-on');
      void nxt.play().catch(() => setPaused(true));
      cur.pause();
      cur.src = list[(at.current + 1) % list.length].url;
      cur.load();
    };
    const ended = (e: Event) => next(e.currentTarget as HTMLVideoElement);
    // One that won't play is skipped (it was deleted, or its link ran out).
    const failed = (e: Event) => {
      const v = e.currentTarget as HTMLVideoElement;
      if (players[on.current] === v) next(v);
    };
    const playing = () => setPaused(false);
    for (const v of players) {
      v.addEventListener('ended', ended);
      v.addEventListener('error', failed);
      v.addEventListener('playing', playing);
    }
    // iPhone may have refused the start (a slow tap): it waits paused, and Play starts it.
    if (a.paused) void a.play().catch(() => setPaused(true));
    showControls();
    return () => {
      gone = true;
      for (const v of players) {
        v.removeEventListener('ended', ended);
        v.removeEventListener('error', failed);
        v.removeEventListener('playing', playing);
        v.pause();
        v.removeAttribute('src');
        v.load();
        v.remove();
      }
      if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    };
  }, [players, list, showControls]);

  const toggle = useCallback(() => {
    const v = players[on.current];
    if (v.paused) {
      void v.play().then(
        () => setPaused(false),
        () => setPaused(true),
      );
    } else {
      v.pause();
      setPaused(true);
    }
    showControls();
  }, [players, showControls]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
      else if (e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onExit, toggle]);

  return createPortal(
    <div className={`ultra-root${controls || paused ? ' ultra-controls' : ''}`} role="dialog" aria-modal="true" aria-label="NSFW Ultra" onPointerDown={showControls}>
      <div className="ultra-stage" ref={stage} />
      <button type="button" className="ultra-btn ultra-exit" aria-label="Exit" onClick={onExit}>
        <Icon name="close" size={22} />
      </button>
      <button type="button" className="ultra-btn ultra-pause" aria-label={paused ? 'Play' : 'Pause'} onClick={toggle}>
        <Icon name={paused ? 'play' : 'pause'} size={22} />
      </button>
    </div>,
    document.body,
  );
}
