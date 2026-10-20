import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { APPS } from '../apps/registry';
import { loadChats } from '../apps/ai/chats';
import { connection } from '../services';
import { getLocalAi, type AiMachineStatus } from '../services/ai/LocalAi';
import { APP_ORDER, useShell } from '../state/shell';
import { useWorkspace } from '../state/workspace';
import { useMotionLevel } from '../motion/MotionProvider';
import { cue } from '../motion/feedback';
import { AppArt } from '../ui/AppArt';
import { SpaceEngine } from './engine';
import { buildGraph, cycleLayout, nextLayout, type Layout, type SpaceGraph, type SpaceNode } from './model';
import { placeWorld, type Placed, type Screen, type World } from './place';
import { useSpace } from './store';
import './space.css';

const greeting = (h: number) => (h < 5 ? 'Good night.' : h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.');
const AI_STATE: Record<AiMachineStatus['state'], string> = {
  unconfigured: 'not set up',
  off: 'resting',
  starting: 'waking up',
  downloading: 'getting models',
  on: 'awake',
  error: 'in trouble',
};
const LAYOUT_WORD: Record<Layout, string> = { list: 'a list', stack: 'a stack', grid: 'a grid' };

/** One paper page. The same frames, rules and type for every kind, so the space stays uniform. */
function Page({ n, room }: { n: SpaceNode; room?: { layout: Layout; count: number } }) {
  const head = (
    <p className="k">
      <span>{n.kicker}</span>
      {n.meta && <span>{n.meta}</span>}
    </p>
  );
  switch (n.kind) {
    case 'chapter':
      return (
        <div className="num">
          <span>{n.title}</span>
          <small>{n.kicker}</small>
        </div>
      );
    case 'cover':
      return (
        <div className="pg cover">
          {head}
          <p className="q">{n.title}</p>
          <p className="d dc">{n.body}</p>
          <p className="ft">
            <i className="dot" />
            {n.foot}
          </p>
        </div>
      );
    case 'said':
      return (
        <div className="pg said">
          {head}
          <p className="q sm">{n.title}</p>
          <p className="ft">{n.foot}</p>
        </div>
      );
    case 'log':
      return (
        <div className="pg slip">
          {head}
          {n.lines?.map(([a, b]) => (
            <p className="ln" key={a}>
              <b>{a}</b>
              {b}
            </p>
          ))}
          <p className="ft">{n.foot}</p>
        </div>
      );
    case 'picture':
      return (
        <div className="pg file">
          {head}
          <div className="plate">{n.image && <img src={n.image} alt="" loading="lazy" decoding="async" draggable={false} />}</div>
          <p className="cap2">{n.title}</p>
        </div>
      );
    case 'room':
      return (
        <div className="pg stack">
          {head}
          <p className="t">{n.title}</p>
          <p className="ft">
            {room ? `As ${LAYOUT_WORD[room.layout]}` : ''} · {n.foot}
          </p>
        </div>
      );
    case 'app':
      return (
        <div className="pg app">
          {head}
          {n.art && <AppArt id={n.art} size={52} className="art" />}
          <p className="t">{n.title}</p>
          <p className="ft">Tap again to open</p>
        </div>
      );
    default:
      return (
        <div className={`pg ${n.kind}`}>
          {head}
          <p className="t">{n.title}</p>
          {n.body && <p className={`d${n.kind === 'reply' ? ' dc' : n.kind === 'file' ? ' mono' : ''}`}>{n.body}</p>}
          {n.foot && <p className="ft">{n.foot}</p>}
        </div>
      );
  }
}

function labelOf(n: SpaceNode, room?: { layout: Layout; count: number }): string {
  if (n.kind === 'room' && room) return `Room: ${n.title}, ${n.meta}, as ${LAYOUT_WORD[room.layout]}`;
  if (n.kind === 'log') return `${n.kicker}: ${n.lines?.map((l) => l.join(' ')).join(', ')}`;
  return [n.kicker, n.title, n.meta].filter(Boolean).join(': ');
}

/** Paper grain, drawn once. */
let grain: string | null = null;
function grainUrl(): string {
  if (grain) return grain;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 180;
    const x = c.getContext('2d');
    if (!x) return '';
    const img = x.createImageData(180, 180);
    let seed = 99;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const v = 110 + (seed / 0x7fffffff) * 145;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    grain = `url(${c.toDataURL()})`;
  } catch {
    grain = '';
  }
  return grain;
}

/**
 * Orbit Space: the home is a blank, endless 3D space where the orb lives. Every node is a flat
 * paper page; the orb travels to whatever you are at, and tapping a page you are at opens it flat
 * and full screen as one of Orbit's apps.
 */
export function Space({ hidden }: { hidden: boolean }) {
  const { launch, updateSettings } = useShell();
  const { recentFiles, recentSessions, sendIntent } = useWorkspace();
  const { layouts, tops, setLayout, flip } = useSpace();
  const level = useMotionLevel();
  const [ai, setAi] = useState<AiMachineStatus | null>(null);
  const [chats, setChats] = useState(() => loadChats().chats);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const stage = useRef<HTMLDivElement>(null);
  const worldEl = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const mast = useRef<HTMLElement>(null);
  const engine = useRef<SpaceEngine | null>(null);

  // Fresh data each time you come back to the space.
  useEffect(() => {
    if (hidden) return;
    setChats(loadChats().chats);
    let live = true;
    getLocalAi()
      .status()
      .then((s) => live && setAi(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hidden]);

  const graph: SpaceGraph = useMemo(() => {
    const now = new Date();
    const machines: [string, string][] = [['Linux', connection.mode === 'host' ? 'connected' : 'demo workspace']];
    if (ai && ai.state !== 'unconfigured') machines.push(['AI', `${AI_STATE[ai.state]}${ai.state === 'on' && ai.costPerHour ? ` · $${ai.costPerHour.toFixed(2)}/h` : ''}`]);
    else machines.push(['AI', ai ? AI_STATE[ai.state] : 'checking']);
    return buildGraph({
      now,
      greeting: greeting(now.getHours()),
      apps: APP_ORDER.map((id) => ({ id, name: APPS[id].name, description: APPS[id].description })),
      chats,
      files: recentFiles,
      sessions: recentSessions,
      machines,
    });
  }, [ai, chats, recentFiles, recentSessions]);

  const roomInfo = useMemo(() => {
    const m: Record<string, { layout: Layout; count: number }> = {};
    for (const r of graph.rooms) m[r.id] = { layout: layouts[r.id] ?? r.layout, count: r.children.length };
    return m;
  }, [graph, layouts]);
  const effectiveLayouts = useMemo(() => Object.fromEntries(Object.entries(roomInfo).map(([k, v]) => [k, v.layout])), [roomInfo]);

  const world = useMemo(() => (screen ? placeWorld(graph, effectiveLayouts, tops, screen) : null), [graph, effectiveLayouts, tops, screen]);

  // Latest callbacks for the engine (it is created once).
  const live = useRef({ graph, roomInfo, launch, sendIntent, setLayout, flip });
  live.current = { graph, roomInfo, launch, sendIntent, setLayout, flip };

  useLayoutEffect(() => {
    if (!stage.current || !worldEl.current || !cv.current) return;
    const announce = (s: string) => setSaid(s);
    const reshape = (room: string, layout: Layout) => {
      const { graph: g, roomInfo: ri, setLayout: set } = live.current;
      if (ri[room]?.layout === layout) return;
      set(room, layout);
      cue('pop');
      announce(`${g.nodes[room]?.title ?? 'Room'} as ${LAYOUT_WORD[layout]}.`);
    };
    const e = new SpaceEngine(
      stage.current,
      worldEl.current,
      cv.current,
      {
        onApproach(id) {
          setAt(id);
          const n = id ? live.current.graph.nodes[id] : null;
          if (n) {
            cue('tap');
            announce(n.kind === 'room' ? `At ${n.title}. Pinch its pages to spread or gather them; double tap to change the layout.` : `At ${n.title}.${n.open ? ' Tap again to open it.' : ''}`);
          } else announce('Overview.');
        },
        onOpen(id) {
          const n = live.current.graph.nodes[id];
          if (!n?.open) return;
          cue('send');
          if (n.open.intent) live.current.sendIntent(n.open.intent);
          live.current.launch(n.open.app);
        },
        onReshape(room, dir) {
          const cur = live.current.roomInfo[room]?.layout;
          if (cur) reshape(room, nextLayout(cur, dir));
        },
        onCycle(room) {
          const cur = live.current.roomInfo[room]?.layout;
          if (cur) reshape(room, cycleLayout(cur));
        },
        onLayout: reshape,
        onFlip(room, dir) {
          const info = live.current.roomInfo[room];
          if (!info || info.layout !== 'stack') return;
          live.current.flip(room, dir, info.count);
          cue('tap');
        },
        onScreen: setScreen,
      },
      () => ({ top: mast.current?.offsetHeight ?? 56, bottom: 34 }),
    );
    engine.current = e;
    setScreen(e.screen);
    return () => {
      e.destroy();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    if (engine.current) engine.current.reduced = level === 'off';
  }, [level]);
  useEffect(() => {
    engine.current?.setPaused(hidden);
  }, [hidden]);

  const placedRef = useRef<World | null>(null);
  useLayoutEffect(() => {
    const e = engine.current;
    if (!e || !world) return;
    const resized = placedRef.current !== null && placedRef.current.home.r !== world.home.r;
    placedRef.current = world;
    e.set(world, effectiveLayouts, { instant: resized });
    e.renderNow();
  }, [world, effectiveLayouts]);

  const placed: Placed[] = world ? Object.values(world.placed) : [];

  return (
    <main className="sp" data-hidden={hidden} aria-hidden={hidden} inert={hidden || undefined} aria-label="Home" style={{ '--noise': grainUrl() } as React.CSSProperties}>
      <div
        ref={stage}
        className="sp-stage"
        tabIndex={0}
        role="application"
        aria-roledescription="3D space"
        aria-label="Orbit Space. Drag to look around, two fingers to move, pinch to come closer. Tap a page to go to it; tap it again to open it."
      >
        <canvas ref={cv} className="sp-bg" aria-hidden />
        <div ref={worldEl} className="sp-world">
          {placed.map((p) => {
            const n = graph.nodes[p.id];
            if (!n) return null;
            const style = { width: p.w, height: p.h, marginLeft: -p.w / 2, marginTop: -p.h / 2 };
            if (p.sculpture)
              return (
                <div key={p.id} data-node={p.id} className="sp-node sp-chapter" style={style} aria-hidden>
                  <Page n={n} />
                </div>
              );
            const info = roomInfo[p.id];
            return (
              <button
                key={p.id}
                type="button"
                data-node={p.id}
                data-kind={n.kind}
                data-layout={info?.layout}
                data-at={at === p.id || undefined}
                className={`sp-node${p.group ? ' sp-card' : ''}`}
                style={style}
                aria-label={labelOf(n, info)}
                aria-current={at === p.id ? 'true' : undefined}
                onFocus={(ev) => {
                  if (ev.currentTarget.matches(':focus-visible') && at !== p.id) engine.current?.approach(p.id);
                }}
                onClick={(ev) => {
                  // Touch and mouse go through the engine's gestures; this is the keyboard (and screen readers).
                  if (ev.detail === 0) engine.current?.tap(p.id);
                }}
              >
                <Page n={n} room={info} />
              </button>
            );
          })}
          <div className="sp-orb" data-orb aria-hidden>
            <span className="ring r2" />
            <span className="ring" />
            <span className="core" />
          </div>
        </div>
        <div className="sp-grain" aria-hidden />
      </div>

      <header ref={mast} className="sp-mast">
        <p className="sp-kick">
          Orbit · Space <span aria-hidden>·</span> <em>{at ? (graph.nodes[at]?.title ?? '') : 'Everything is a page'}</em>
        </p>
        <div className="sp-mast-ctl">
          {at && (
            <button type="button" className="sp-btn" onClick={() => engine.current?.overview()}>
              Back
            </button>
          )}
          <button type="button" className="sp-btn" onClick={() => updateSettings({ space: false })} aria-label="Flat view: the contents as pages you scroll">
            Flat
          </button>
        </div>
      </header>
      <p className="visually-hidden" aria-live="polite">
        {said}
      </p>
    </main>
  );
}
