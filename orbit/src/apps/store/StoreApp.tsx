import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppProps } from '../types';
import { Icon } from '../../ui/Icon';
import { ConfirmSheet, Sheet } from '../../ui/components';
import { MagChapter, MagContents, MagCover } from '../../ui/Magazine';
import { useShell } from '../../state/shell';
import { useWorkspace } from '../../state/workspace';
import { getLocalAi, type AiMachineStatus, type HubFile, type HubModel, type InstalledModel, type StudioMakerInfo } from '../../services/ai/LocalAi';
import { useModelList } from '../ai/models';
import { DownloadManager } from './DownloadManager';
import { PENDING_TEXT, canResume, offlineMakers, progressText, rememberMakers, withCatalog } from '../ai/makerCatalog';
import {
  CATALOG,
  CHAT,
  CHAT_SHELVES,
  GPU_BYTES,
  formatContext,
  formatCount,
  formatSize,
  gpuNeed,
  hueOf,
  inShelf,
  nameOfSpec,
  speedOf,
  type ChatEntry,
  type MakerDetails,
} from './catalog';
import './store.css';

/**
 * The AI Store: every chat model and picture/video maker the AI machine can run, on shelves like an
 * app store, each with its own page (what it is good at, what to try, and the full specifications).
 * Installing happens on the AI machine; while it rests, the shelves still show (from catalog.json).
 */

type Item = { type: 'chat'; entry: ChatEntry } | { type: 'maker'; maker: StudioMakerInfo };
const keyOf = (i: Item) => (i.type === 'chat' ? `chat:${i.entry.id}` : `maker:${i.maker.id}`);
const titleOf = (i: Item) => (i.type === 'chat' ? i.entry.title : i.maker.name);

const MAKER_SHELVES: { id: string; title: string; dek: string; kinds: StudioMakerInfo['kind'][] }[] = [
  { id: 'store-pictures', title: 'Pictures', dek: 'Each paints in its own hand.', kinds: ['image'] },
  { id: 'store-video', title: 'Video', dek: 'Moving pictures, with sound.', kinds: ['video'] },
  { id: 'store-edit', title: 'Editing', dek: 'Change, restage or restore a picture you have.', kinds: ['edit'] },
  { id: 'store-video-edit', title: 'Video editing', dek: 'Change, erase or sharpen a video you have.', kinds: ['videoedit'] },
  { id: 'store-upscale', title: 'Sharpen & enlarge', dek: 'Make small pictures big and crisp.', kinds: ['upscale'] },
  { id: 'store-styles', title: 'Styles', dek: 'Looks to lay over a picture maker.', kinds: ['style'] },
  { id: 'store-live', title: 'Live', dek: 'Draw, and watch it turn into a picture as you go.', kinds: ['live', 'sketch'] },
];
const KIND_NAME: Record<StudioMakerInfo['kind'], string> = { image: 'Picture maker', video: 'Video maker', edit: 'Picture editor', upscale: 'Upscaler', style: 'Style', videoedit: 'Video editor', live: 'Live maker', sketch: 'Sketch finisher' };
const NEED_WORDS: Record<string, string> = { video: 'a video', audio: 'a voice or song', photo: 'a photo', target: 'words naming what to change' };
/** "A video and a voice or song" */
function needsText(m: StudioMakerInfo): string | null {
  const list = (m.needs ?? []).map((n) => NEED_WORDS[n]).filter(Boolean);
  if (!list.length) return m.twoImages ? 'Two pictures' : m.kind === 'edit' || m.kind === 'upscale' ? 'A picture to start from' : m.kind === 'live' || m.kind === 'sketch' ? 'Your drawing (in Live Draw)' : null;
  const s = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
  return s[0].toUpperCase() + s.slice(1);
}
const RESTART_HELP = `${PENDING_TEXT}. Turn it off and on again to get it.`;
const TOKEN_HELP =
  'LTX-2.5 is gated on Hugging Face. Accept its licence at huggingface.co/Lightricks/LTX-2.5, add your token in Runpod as the secret hf_token, set AI_HF_TOKEN_SECRET=hf_token in Vercel, then turn the AI machine off and on.';

type Filter = 'all' | 'chat' | 'makers' | 'library' | 'downloads';


function Tile({ item, size = 56 }: { item: Item; size?: number }) {
  const id = item.type === 'chat' ? item.entry.id : item.maker.id;
  const h = hueOf(id);
  const letter = titleOf(item).replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '·';
  const glyph = item.type === 'chat' ? null : item.maker.kind;
  return (
    <span
      className="st-tile"
      aria-hidden
      style={{ width: size, height: size, background: `linear-gradient(145deg, hsl(${h} 46% 38%), hsl(${(h + 40) % 360} 52% 18%))` }}
    >
      {glyph ? <Icon name={glyph === 'video' || glyph === 'videoedit' ? 'film' : glyph === 'style' ? 'sparkle' : glyph === 'upscale' ? 'search' : glyph === 'live' || glyph === 'sketch' ? 'pencil' : 'image'} size={Math.round(size * 0.42)} /> : <span>{letter}</span>}
    </span>
  );
}

export default function StoreApp({ isActive }: AppProps) {
  const ai = useMemo(() => getLocalAi(), []);
  const toast = useShell((s) => s.toast);
  const launch = useShell((s) => s.launch);
  const sendIntent = useWorkspace((s) => s.sendIntent);
  const [status, setStatus] = useState<AiMachineStatus | null>(null);
  const [makers, setMakersState] = useState<StudioMakerInfo[] | null>(null);
  const [offline] = useState(offlineMakers);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Item | null>(null);
  const [remove, setRemove] = useState<Item | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [powering, setPowering] = useState(false);
  const [hub, setHub] = useState<HubModel[] | null>(null);
  const [hubBusy, setHubBusy] = useState(false);
  const [repo, setRepo] = useState<{ name: string; files: HubFile[] | null } | null>(null);

  const machineOn = status?.state === 'on';
  const { list, refresh } = useModelList(ai, machineOn && isActive);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await ai.status());
    } catch {
      /* the site isn't behind Orbit (preview, tests): shelves still show */
    }
  }, [ai]);
  useEffect(() => {
    if (!isActive) return;
    void refreshStatus();
    const busyMachine = status && status.state !== 'on' && status.state !== 'off' && status.state !== 'unconfigured';
    const t = setInterval(refreshStatus, busyMachine ? 5000 : 30000);
    return () => clearInterval(t);
  }, [isActive, refreshStatus, status?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const setMakers = useCallback((l: StudioMakerInfo[]) => {
    setMakersState(l);
    rememberMakers(l);
  }, []);
  const makerDownloading = !!makers?.some((m) => m.wanted && !m.installed);
  useEffect(() => {
    if (!machineOn || !isActive) return;
    const load = () => ai.studioMakers().then(setMakers, () => {});
    void load();
    const t = setInterval(load, makerDownloading ? 3000 : 30000);
    return () => clearInterval(t);
  }, [ai, machineOn, isActive, makerDownloading, setMakers]);

  // "Open the store" from anywhere (home, index, settings, the AI app, the orb).
  const intent = useWorkspace((s) => s.intent);
  useEffect(() => {
    if (intent?.app !== 'store') return;
    useWorkspace.getState().consumeIntent(intent.seq);
    setFilter(intent.shelf === 'chat' ? 'chat' : intent.shelf === 'makers' ? 'makers' : intent.shelf === 'library' ? 'library' : intent.shelf === 'downloads' ? 'downloads' : 'all');
    const target = intent.item && [...CHAT.map((e) => ({ type: 'chat', entry: e }) as Item)].find((i) => keyOf(i) === intent.item);
    setOpen(target || null);
  }, [intent]);

  // Every maker in the catalog shows, even those an AI machine on older code doesn't know yet.
  const allMakers = useMemo(() => (makers ? withCatalog(makers) : offline), [makers, offline]);
  const installed: InstalledModel[] = list?.installed ?? [];
  const haveChat = (e: ChatEntry) => installed.some((m) => m.name === nameOfSpec(e.spec) || m.name === nameOfSpec(e.spec).replace(/:latest$/, ''));
  const pullOf = (e: ChatEntry) => list?.pulls.find((p) => p.name === nameOfSpec(e.spec) || p.name === nameOfSpec(e.spec).replace(/:latest$/, ''));
  const free = list?.disk?.free ?? Infinity;

  const q = query.trim().toLowerCase();
  const matches = (text: (string | undefined)[]) => !q || text.some((t) => t?.toLowerCase().includes(q));
  const chatShown = CHAT.filter((e) => matches([e.title, e.blurb, e.publisher, e.family, ...e.tags]));
  const makersShown = allMakers.filter((m) => matches([m.name, m.blurb, KIND_NAME[m.kind], CATALOG.makers[m.id]?.base]));
  // Models on the machine that the catalog doesn't know (added from Hugging Face search).
  const extraInstalled = installed.filter((m) => !CHAT.some((e) => nameOfSpec(e.spec).replace(/:latest$/, '') === m.name.replace(/:latest$/, '')));

  const turnOn = async () => {
    setPowering(true);
    try {
      setStatus(await ai.power('start'));
      toast('Turning the AI machine on. Adding and removing work once it is ready (2–4 minutes).', 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPowering(false);
    }
  };

  const get = async (item: Item) => {
    if (!machineOn) return void turnOn();
    const key = keyOf(item);
    setBusy(key);
    try {
      if (item.type === 'chat') {
        if (item.entry.size > free) throw new Error(`Not enough free storage: needs ${formatSize(item.entry.size)}, ${formatSize(free)} free. Remove something first.`);
        const name = await ai.installModel({ spec: item.entry.spec });
        toast(`Adding ${name}. You can keep using Orbit meanwhile.`, 'info');
        await refresh();
      } else {
        const again = canResume(item.maker, machineOn);
        setMakers(await ai.installStudioMaker(item.maker.id));
        toast(again ? `Resuming ${item.maker.name}.` : `Adding ${item.maker.name}.`, 'info');
      }
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const doRemove = async (item: Item) => {
    setRemove(null);
    try {
      if (item.type === 'chat') {
        const name = installed.find((m) => m.name.replace(/:latest$/, '') === nameOfSpec(item.entry.spec).replace(/:latest$/, ''))?.name ?? nameOfSpec(item.entry.spec);
        await ai.removeModel(name);
        await refresh();
      } else setMakers(await ai.removeStudioMaker(item.maker.id));
      toast(`Removed ${titleOf(item)}`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const use = (item: Item) => {
    if (item.type === 'chat') {
      sendIntent({ app: 'ai', type: 'use-model', model: nameOfSpec(item.entry.spec).replace(/:latest$/, '') });
      launch('ai');
    } else {
      launch('make');
    }
  };

  /** What the main button says and does. */
  function action(item: Item): { label: string; state: 'get' | 'progress' | 'have' | 'wait' | 'token' | 'soon'; percent?: number } {
    if (item.type === 'chat') {
      const pull = pullOf(item.entry);
      if (pull && !pull.done) return { label: pull.percent > 0 ? `${pull.percent}%` : 'Starting', state: 'progress', percent: pull.percent };
      if (haveChat(item.entry)) return { label: 'Open', state: 'have' };
      return { label: machineOn ? `Get · ${formatSize(item.entry.size)}` : 'Get', state: machineOn ? 'get' : 'wait' };
    }
    const m = item.maker;
    if (m.pending) return { label: 'After restart', state: 'soon' };
    if (m.needsToken && !m.installed) return { label: 'Needs a token', state: 'token' };
    if (m.wanted && !m.installed) return { label: progressText(m, machineOn), state: 'progress', percent: m.percent };
    if (m.installed) return { label: 'Open', state: 'have' };
    return { label: machineOn ? `Get${m.size ? ` · ${formatSize(m.size)}` : ''}` : 'Get', state: machineOn ? 'get' : 'wait' };
  }

  // The open sheet follows the refreshed list (a maker resumed or finished while it is open).
  const shownMaker = open?.type === 'maker' ? allMakers.find((m) => m.id === open.maker.id) : undefined;
  const shown: Item | null = open?.type === 'maker' && shownMaker ? { type: 'maker', maker: shownMaker } : open;

  // Plain render helpers, not components: a component declared inside StoreApp is a new type on
  // every render, so each refresh (every few seconds) would throw away and rebuild every row,
  // which on iPhone/iPad jumps the page back up and loses the tap in progress.
  function button(item: Item, big?: boolean) {
    const a = action(item);
    const key = keyOf(item);
    if (a.state === 'progress') {
      const progress = (
        <span className="st-progress" role="status" aria-label={`Adding ${titleOf(item)}: ${a.label}`}>
          <span className="st-ring" style={{ '--p': `${Math.max(3, a.percent ?? 0)}%` } as React.CSSProperties} />
          {a.label}
        </span>
      );
      // A download that stopped: start it again from where it was.
      if (item.type !== 'maker' || !canResume(item.maker, machineOn)) return progress;
      return (
        <span className="st-resume">
          {progress}
          <button
            type="button"
            className="btn small primary"
            disabled={busy === key}
            onClick={(e) => {
              e.stopPropagation();
              void get(item);
            }}
            aria-label={`Resume ${titleOf(item)}`}
          >
            Resume
          </button>
        </span>
      );
    }
    return (
      <button
        type="button"
        className={`btn ${big ? '' : 'small '}${a.state === 'have' || a.state === 'soon' ? '' : 'primary'}`}
        disabled={busy === key || powering}
        onClick={(e) => {
          e.stopPropagation();
          if (a.state === 'have') use(item);
          else if (a.state === 'token') toast(TOKEN_HELP, 'info');
          else if (a.state === 'soon') toast(RESTART_HELP, 'info');
          else void get(item);
        }}
        aria-label={
          a.state === 'have' ? `Open ${titleOf(item)}` : a.state === 'token' ? `${titleOf(item)} needs a Hugging Face token` : a.state === 'soon' ? `${titleOf(item)}: ${PENDING_TEXT}` : `Get ${titleOf(item)}`
        }
      >
        {a.label}
      </button>
    );
  }

  function row(item: Item, key: string) {
    const sub =
      item.type === 'chat'
        ? [item.entry.publisher, item.entry.params, formatSize(item.entry.size)].filter(Boolean).join(' · ')
        : item.maker.pending
          ? [KIND_NAME[item.maker.kind], PENDING_TEXT].join(' · ')
          : [KIND_NAME[item.maker.kind], CATALOG.makers[item.maker.id]?.publisher, item.maker.size ? formatSize(item.maker.size) : item.maker.builtIn ? 'Included' : ''].filter(Boolean).join(' · ');
    const blurb = item.type === 'chat' ? item.entry.blurb : item.maker.blurb;
    const adult = item.type === 'chat' ? item.entry.tags.includes('uncensored') : /uncensored/i.test(item.maker.blurb);
    return (
      <li key={key} className="st-row" data-installed={action(item).state === 'have' || undefined}>
        <button type="button" className="st-row-open" onClick={() => setOpen(item)} aria-label={`${titleOf(item)}: details`}>
          <Tile item={item} />
          <span className="st-row-text">
            <span className="st-row-title">{titleOf(item)}</span>
            <span className="st-row-sub">
              {sub}
              {adult && <span className="st-adult">18+</span>}
            </span>
            <span className="st-row-blurb">{blurb}</span>
          </span>
        </button>
        {button(item)}
      </li>
    );
  }

  const chapters: { id: string; title: string }[] = [];
  const showChat = filter === 'all' || filter === 'chat';
  const showMakers = filter === 'all' || filter === 'makers';
  const chatShelves = showChat ? CHAT_SHELVES.map((s) => ({ ...s, items: chatShown.filter((e) => inShelf(e, s.tag)) })).filter((s) => s.items.length) : [];
  const makerShelves = showMakers ? MAKER_SHELVES.map((s) => ({ ...s, items: makersShown.filter((m) => s.kinds.includes(m.kind)) })).filter((s) => s.items.length) : [];
  const picks = CHAT_SHELVES.map((s) => CHAT.find((e) => inShelf(e, s.tag))).filter((e, i, a): e is ChatEntry => Boolean(e) && a.indexOf(e) === i).slice(0, 6);
  if (filter === 'all' && !q) chapters.push({ id: 'store-picks', title: 'Editor’s picks' });
  for (const s of chatShelves) chapters.push({ id: `store-chat-${s.tag}`, title: s.title });
  for (const s of makerShelves) chapters.push({ id: s.id, title: s.title });
  if (filter === 'all' || filter === 'library') chapters.push({ id: 'store-library', title: 'Your library' });
  if (filter === 'all' || filter === 'chat') chapters.push({ id: 'store-hub', title: 'Find more' });

  const libChat = CHAT.filter(haveChat);
  const libMakers = allMakers.filter((m) => m.installed || (m.wanted && !m.installed));
  let n = 0;

  const searchHub = async () => {
    if (!q || !machineOn) return;
    setHubBusy(true);
    setRepo(null);
    try {
      setHub(await ai.searchModels(query.trim()));
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setHubBusy(false);
    }
  };

  return (
    <div className="st-app" data-testid="store">
      <div className="st-scroll mag">
        <MagCover
          kicker={
            <>
              The AI Store · {CHAT.length + allMakers.length} models
              {list?.disk ? ` · ${formatSize(list.disk.free)} free` : ''}
            </>
          }
          title="Store"
          dek="Open models that run on your own GPU: chat, pictures, video and more. Add one once and it is there on every start."
        >
          <form
            className="st-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              void searchHub();
            }}
          >
            <Icon name="search" size={18} />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search models, makers, styles" aria-label="Search the store" enterKeyHint="search" />
          </form>
          <div className="st-filters" role="tablist" aria-label="Show">
            {(
              [
                ['all', 'Everything'],
                ['chat', 'Chat'],
                ['makers', 'Pictures & video'],
                ['library', 'Your library'],
                ['downloads', 'Downloads'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={filter === id} className="st-filter" onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          {!machineOn && (
            <div className="st-off" role="status">
              <p>
                <strong>Your AI machine is {status?.state === 'starting' || status?.state === 'downloading' ? 'waking up' : 'resting'}.</strong> Browse everything now; adding and removing
                happen on the machine.
              </p>
              {status?.state !== 'starting' && status?.state !== 'downloading' && status?.state !== 'unconfigured' && (
                <button type="button" className="btn small primary" onClick={() => void turnOn()} disabled={powering}>
                  Turn on
                </button>
              )}
            </div>
          )}
          {list?.disk && (
            <div className="st-storage" aria-label="Storage">
              <span>
                {formatSize(list.disk.total - list.disk.free)} used of {formatSize(list.disk.total)}
              </span>
              <span className="st-bar" aria-hidden>
                <span style={{ width: `${Math.min(100, ((list.disk.total - list.disk.free) / list.disk.total) * 100)}%` }} />
              </span>
            </div>
          )}
          {chapters.length > 1 && <MagContents chapters={chapters} />}
        </MagCover>

        {filter === 'downloads' && <DownloadManager ai={ai} status={status} machineOn={machineOn} isActive={isActive} />}

        {filter === 'all' && !q && (
          <MagChapter n={++n} id="store-picks" title="Editor’s picks" dek="The best of each shelf for this machine.">
            <ul className="st-cards" role="list">
              {picks.map((e) => {
                const item: Item = { type: 'chat', entry: e };
                return (
                  <li key={e.id} className="st-card">
                    <button type="button" className="st-card-open" onClick={() => setOpen(item)} aria-label={`${e.title}: details`}>
                      <Tile item={item} size={72} />
                      <span className="st-card-kicker">{CHAT_SHELVES.find((s) => inShelf(e, s.tag))?.title}</span>
                      <span className="st-card-title">{e.title}</span>
                      <span className="st-card-blurb">{e.blurb}</span>
                    </button>
                    {button(item)}
                  </li>
                );
              })}
            </ul>
          </MagChapter>
        )}

        {chatShelves.map((s) => (
          <MagChapter key={s.tag} n={++n} id={`store-chat-${s.tag}`} title={s.title} dek={s.dek}>
            <ul className="st-list" role="list">
              {s.items.map((e) => row({ type: 'chat', entry: e }, e.id))}
            </ul>
          </MagChapter>
        ))}

        {makerShelves.map((s) => (
          <MagChapter key={s.id} n={++n} id={s.id} title={s.title} dek={s.dek}>
            <ul className="st-list" role="list">
              {s.items.map((m) => row({ type: 'maker', maker: m }, m.id))}
            </ul>
          </MagChapter>
        ))}

        {(filter === 'all' || filter === 'library') && (
          <MagChapter n={++n} id="store-library" title="Your library" dek="On your AI machine now. Only the model you chat with sits in the GPU.">
            {!machineOn && !libMakers.length && <p className="st-muted">Turn the machine on to see what it holds.</p>}
            <ul className="st-list" role="list">
              {libChat.map((e) => row({ type: 'chat', entry: e }, e.id))}
              {extraInstalled.map((m) => (
                <li key={m.name} className="st-row" data-installed>
                  <span className="st-row-open">
                    <Tile item={{ type: 'chat', entry: { id: m.name, spec: m.name, title: m.name, size: m.size, tags: [], blurb: '' } }} />
                    <span className="st-row-text">
                      <span className="st-row-title">{m.name}</span>
                      <span className="st-row-sub">{[m.params, m.quant, formatSize(m.size), m.loaded ? 'in the GPU now' : ''].filter(Boolean).join(' · ')}</span>
                      <span className="st-row-blurb">Added from Hugging Face.</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => setRemove({ type: 'chat', entry: { id: m.name, spec: m.name, title: m.name, size: m.size, tags: [], blurb: '' } })}
                    disabled={!machineOn}
                  >
                    Remove
                  </button>
                </li>
              ))}
              {libMakers.map((m) => row({ type: 'maker', maker: m }, m.id))}
            </ul>
          </MagChapter>
        )}

        {(filter === 'all' || filter === 'chat') && (
          <MagChapter n={++n} id="store-hub" title="Find more" dek="Any chat model on Hugging Face, in the size that fits. Type above, then search.">
            <button type="button" className="btn" disabled={!machineOn || !q || hubBusy} onClick={() => void searchHub()}>
              <Icon name="search" size={16} /> {hubBusy ? 'Searching…' : q ? `Search Hugging Face for “${query.trim()}”` : 'Type a name above to search'}
            </button>
            {!machineOn && <p className="st-muted">Searching Hugging Face needs the AI machine on.</p>}
            {repo ? (
              <div className="st-repo">
                <button type="button" className="btn ghost small" onClick={() => setRepo(null)}>
                  <Icon name="back" size={16} /> Results
                </button>
                <h4 className="st-repo-name">{repo.name}</h4>
                <p className="st-muted">Smaller sizes are faster and use less memory; bigger ones answer a little better.</p>
                {!repo.files && <p className="st-muted">Loading sizes…</p>}
                <ul className="st-list" role="list">
                  {repo.files?.map((f) => (
                    <li key={f.quant} className="st-row">
                      <span className="st-row-text">
                        <span className="st-row-title">{f.quant}</span>
                        <span className="st-row-sub">
                          {formatSize(f.size)}
                          {f.size > free ? ' · not enough storage' : gpuNeed(f.size) > GPU_BYTES ? ' · needs the Turbo machine' : ' · fits'}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn small primary"
                        disabled={f.size > free}
                        onClick={() =>
                          void ai
                            .installModel({ repo: repo.name, quant: f.quant })
                            .then((name) => {
                              toast(`Adding ${name}.`, 'info');
                              return refresh();
                            })
                            .catch((err: Error) => toast(err.message, 'error'))
                        }
                      >
                        Get
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <ul className="st-list" role="list">
                {hub?.length === 0 && <li className="st-muted">Nothing found. Try a shorter word.</li>}
                {hub?.map((r) => (
                  <li key={r.repo}>
                    <button
                      type="button"
                      className="o5-go st-hub"
                      onClick={() => {
                        setRepo({ name: r.repo, files: null });
                        ai.modelFiles(r.repo).then(
                          (files) => setRepo({ name: r.repo, files }),
                          (err: Error) => toast(err.message, 'error'),
                        );
                      }}
                    >
                      <span className="o5-go-label">{r.repo}</span>
                      <span className="o5-go-hint">
                        {formatCount(r.downloads)} downloads · {formatCount(r.likes)} likes
                      </span>
                      <Icon name="forward" size={20} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </MagChapter>
        )}
        <p className="mag-colophon">That is the whole store.</p>
      </div>

      {shown && (
        <Detail
          item={shown}
          button={button(shown, true)}
          installedChat={shown.type === 'chat' && haveChat(shown.entry)}
          free={free}
          onRemove={machineOn && (shown.type === 'chat' ? haveChat(shown.entry) : shown.maker.installed && !shown.maker.builtIn) ? () => setRemove(shown) : undefined}
          onClose={() => setOpen(null)}
        />
      )}
      {remove && (
        <ConfirmSheet
          title={`Remove ${titleOf(remove)}?`}
          message="Frees its storage on your AI machine. You can get it again any time."
          confirmLabel="Remove"
          destructive
          onConfirm={() => {
            const item = remove;
            setOpen(null);
            void doRemove(item);
          }}
          onCancel={() => setRemove(null)}
        />
      )}
    </div>
  );
}

/** One model's page: what it is, what to try, and every specification. */
function Detail({
  item,
  button,
  installedChat,
  free,
  onRemove,
  onClose,
}: {
  item: Item;
  button: React.ReactNode;
  installedChat: boolean;
  free: number;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const e = item.type === 'chat' ? item.entry : null;
  const m = item.type === 'maker' ? item.maker : null;
  const d: MakerDetails = (m && CATALOG.makers[m.id]) || {};
  const adult = e ? e.tags.includes('uncensored') : /uncensored/i.test(m?.blurb ?? '');
  const size = e ? e.size : (m?.size ?? 0);
  const fit = e
    ? installedChat
      ? 'On your machine'
      : size > free
        ? 'Not enough free storage'
        : gpuNeed(size) > GPU_BYTES
          ? 'Needs the Turbo machine (80 GB)'
          : `Fits this machine (needs about ${formatSize(gpuNeed(size))} of 48 GB GPU memory)`
    : m?.installed
      ? 'On your machine'
      : m?.pending
        ? PENDING_TEXT
        : m?.setup
        ? `Setting up its own Python: ${m.setup}`
        : m?.turboOnly
        ? 'Turbo machine only (H100, 80 GB): turn the AI machine on as Turbo to add it'
        : m?.needsToken
        ? 'Needs a Hugging Face token on your AI machine'
        : 'Fits this machine';
  const abilities = e?.abilities ? [e.abilities.vision && 'Sees pictures', e.abilities.tools && 'Uses tools', e.abilities.thinking && 'Thinks step by step'].filter(Boolean).join(', ') : null;
  const specs: [string, React.ReactNode][] = (
    e
      ? [
          ['Kind', 'Chat model'],
          ['Publisher', e.publisher],
          ['Family', e.family],
          ['Size of the brain', e.params && `${e.params} parameters${e.moe ? ' (mixture of experts)' : ''}`],
          ['Precision', e.quant],
          ['Download', formatSize(e.size)],
          ['GPU memory', `About ${formatSize(gpuNeed(e.size))}`],
          ['Remembers', formatContext(e.context)],
          ['Abilities', abilities || 'Text only'],
          ['Speed', speedOf(e)],
          ['Licence', e.license],
          ['Updated', e.released],
          ['Popularity', e.downloads ? `${formatCount(e.downloads)} downloads · ${formatCount(e.likes ?? 0)} likes` : null],
          ['Shelves', e.tags.join(', ')],
          ['Source', e.repo ? <a href={`https://huggingface.co/${e.repo}`} target="_blank" rel="noopener">{e.repo}</a> : e.source === 'ollama' ? 'Ollama library' : null],
          ['On this machine', fit],
        ]
      : [
          ['Kind', m && KIND_NAME[m.kind]],
          ['Publisher', d.publisher],
          ['Built on', d.base],
          ['Download', m?.size ? formatSize(m.size) : m?.builtIn ? 'Included with the machine' : null],
          ['Makes', d.output],
          ['Best size', d.resolution],
          ['Steps', d.steps ? `${d.steps} (more is slower, finer)` : null],
          ['Needs', m ? needsText(m) : null],
          ['GPU memory', d.gpu],
          ['Speed', d.speed],
          ['Access', d.gated || m?.gated ? (m?.needsToken ? 'Gated: your AI machine needs a Hugging Face token first' : 'Gated on Hugging Face (needs a token)') : null],
          ['Works with', m?.for ? `${m.for === 'krea-real' ? 'Krea Real' : m.for}` : null],
          ['Trigger words', d.trigger],
          ['Licence', d.license],
          ['Updated', d.released],
          ['Source', d.repo ? <a href={`https://huggingface.co/${d.repo}`} target="_blank" rel="noopener">{d.repo}</a> : null],
          ['Code', d.code ? <a href={d.code} target="_blank" rel="noopener">{d.code.replace(/^https:\/\/(www\.)?/, '')}</a> : null],
          ['On this machine', fit],
        ]
  ).filter(([, v]) => v !== null && v !== undefined && v !== '' && (v as unknown) !== false) as [string, React.ReactNode][];
  const tryIt = e?.tryIt ?? d.tryIt;
  return (
    <Sheet title={titleOf(item)} onClose={onClose} page>
      <article className="st-detail" aria-label={titleOf(item)}>
        <header className="st-detail-head">
          <Tile item={item} size={112} />
          <div className="st-detail-id">
            <p className="o5-kicker">{e ? 'Chat model' : m && KIND_NAME[m.kind]}</p>
            <h2 className="st-detail-title">{titleOf(item)}</h2>
            <p className="st-detail-pub">
              {e?.publisher ?? d.publisher ?? 'Open model'}
              {adult && <span className="st-adult">18+ · Unfiltered</span>}
            </p>
            <div className="st-detail-actions">
              {button}
              {onRemove && (
                <button type="button" className="btn ghost small" onClick={onRemove}>
                  Remove
                </button>
              )}
            </div>
          </div>
        </header>
        <dl className="st-glance" aria-label="At a glance">
          {(
            [
              ['Size', size ? formatSize(size) : '—'],
              e ? ['Brain', e.params ?? '—'] : ['Kind', m ? KIND_NAME[m.kind] : '—'],
              e ? ['Memory', e.context ? `${Math.round(e.context / 1024)}k` : '—'] : ['Steps', d.steps ?? '—'],
              e ? ['Likes', e.likes ? formatCount(e.likes) : '—'] : ['Output', d.output ?? '—'],
            ] as [string, React.ReactNode][]
          ).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="st-detail-about">{e?.about ?? d.about ?? (e ? e.blurb : m?.blurb)}</p>
        {tryIt?.length ? (
          <section className="st-try" aria-label="Try saying">
            <p className="o5-kicker">Try saying</p>
            <ul>
              {tryIt.map((t) => (
                <li key={t}>“{t}”</li>
              ))}
            </ul>
          </section>
        ) : null}
        {m?.pending && (
          <p className="st-note" role="note">
            {RESTART_HELP}
          </p>
        )}
        {m?.needsToken && !m.pending && (
          <p className="st-note" role="note">
            {TOKEN_HELP}
          </p>
        )}
        {m?.problem && !m.needsToken && (
          <p className="st-note" role="note">
            {m.problem}
          </p>
        )}
        {adult && <p className="st-note">Refusals removed: it answers without filtering. Orbit's one rule still applies everywhere: nothing sexual involving minors, and no undressing of real photos.</p>}
        <section aria-label="Specifications">
          <p className="o5-kicker">Specifications</p>
          <dl className="st-specs">
            {specs.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </article>
    </Sheet>
  );
}
