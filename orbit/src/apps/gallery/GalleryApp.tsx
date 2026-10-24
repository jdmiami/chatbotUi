import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppProps } from '../types';
import { MagCover } from '../../ui/Magazine';
import { useShell } from '../../state/shell';
import { useScrollDepth } from '../../shell/o5/depth';
import { Icon } from '../../ui/Icon';
import { ConfirmSheet, Segmented } from '../../ui/components';
import { isNsfw } from '../../ui/nsfw';
import { connectMarkFallback, connectMarks, nsfwFor, rememberItems, useNsfwFlags } from '../../ui/nsfwFlags';
import { shows, useNsfwView } from '../../ui/Censor';
import { MachineNotice } from '../../ui/MachineNotice';
import { SpeedChoice, useSpeed } from '../../ui/SpeedChoice';
import { getLocalAi, type AiMachineStatus } from '../../services/ai/LocalAi';
import { cloudMadeList, cloudMadeRemove, moveCloudMadeToStorage } from '../../services/ai/CloudMake';
import { deleteStored, keepStored, markStoredNsfw, saveCloudToStorage, sourceOf, storedGallery, type CreationSource, type StoredGallery } from '../../services/ai/StoredGallery';
import { GalleryGrid, GalleryViewer, useGalleryStepper, type GalleryMedia } from '../ai/Gallery';
import { loadHeld, type HeldItem } from '../../services/ai/HeldReview';
import { HeldReview } from './HeldReview';
import '../agent/agent.css';
import '../ai/ai.css';
import './gallery.css';

/**
 * Gallery: every creation in one place, from every app: Make (pictures, videos and edits), the
 * cloud, the Lab (movies and remixes), soReal movies and Live Draw. It reads the gallery kept in
 * cloud storage through the site, so it works with the AI machine off; with the machine on it shows
 * the machine's own gallery too. Tabs narrow it by where things came from and by pictures or videos.
 * The viewer is the same as everywhere: swipe between them, hold to see an NSFW one, save, delete.
 */
type Origin = 'machine' | 'storage' | 'device';
export interface Creation extends GalleryMedia {
  source: CreationSource;
  origin: Origin;
  prompt: string;
  title?: string;
  caption?: string;
  hashtags?: string[];
  score?: number | null;
  lab: boolean;
  movie?: string;
  createdAt: string;
  downloadUrl: string;
}

type Kind = 'all' | 'image' | 'video';
type Source = 'all' | CreationSource;
const SOURCES: { value: Source; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'make', label: 'Make' },
  { value: 'cloud', label: 'Cloud' },
  { value: 'lab', label: 'Lab' },
  { value: 'soreal', label: 'soReal' },
  { value: 'livedraw', label: 'Live Draw' },
];
const SOURCE_NAME: Record<CreationSource, string> = { make: 'Make', cloud: 'Made in the cloud', lab: 'Lab', soreal: 'soReal', livedraw: 'Live Draw' };
/** Said when the site has no storage keys and the machine is off. */
export const NOT_SET_UP = 'Your gallery shows here with the machine off once storage keys are added.';
const PICK_KEY = 'orbit:gallery:pick';

const withParam = (url: string, p: string) => url + (url.includes('?') ? '&' : '?') + p;
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
function loadPick(): { kind: Kind; source: Source } {
  try {
    const v = JSON.parse(localStorage.getItem(PICK_KEY) || '{}') as { kind?: Kind; source?: Source };
    return { kind: v.kind === 'image' || v.kind === 'video' ? v.kind : 'all', source: SOURCES.some((s) => s.value === v.source) ? v.source! : 'all' };
  } catch {
    return { kind: 'all', source: 'all' };
  }
}

export default function GalleryApp({ isActive }: AppProps) {
  const ai = useMemo(() => getLocalAi(), []);
  const toast = useShell((s) => s.toast);
  const launch = useShell((s) => s.launch);
  const [status, setStatus] = useState<AiMachineStatus | null>(null);
  const [powering, setPowering] = useState(false);
  const speed = useSpeed(status);
  const scroller = useRef<HTMLDivElement>(null);
  useScrollDepth(scroller, isActive, 'edges');

  const [stored, setStored] = useState<StoredGallery | null | undefined>(undefined);
  const [machineList, setMachineList] = useState<Creation[] | null>(null);
  const [device, setDevice] = useState<Creation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pick, setPickState] = useState(loadPick);
  const [viewing, setViewing] = useState<string | null>(null);
  const viewFrom = useRef<DOMRect | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Creation | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Results set aside for the owner to look at: only there when something is held (and only the owner is ever told).
  const [held, setHeld] = useState<HeldItem[]>([]);
  const [showHeld, setShowHeld] = useState(false);

  const setPick = (next: Partial<typeof pick>) =>
    setPickState((p) => {
      const v = { ...p, ...next };
      try {
        localStorage.setItem(PICK_KEY, JSON.stringify(v));
      } catch {
        /* private mode */
      }
      return v;
    });

  // The machine: on or off (the same check as Make and the Lab).
  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await ai.status());
    } catch {
      /* the site isn't behind Orbit (preview, tests) */
    }
  }, [ai]);
  useEffect(() => {
    if (!isActive) return;
    void refreshStatus();
    const waking = status && status.state !== 'on' && status.state !== 'off' && status.state !== 'unconfigured';
    const t = setInterval(refreshStatus, waking ? 5000 : 30000);
    return () => clearInterval(t);
  }, [isActive, refreshStatus, status?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const wasOn = useRef(false);
  if (status?.state === 'on') wasOn.current = true;
  else if (status && status.state !== 'error') wasOn.current = false;
  const machineOn = status?.state === 'on' || wasOn.current;
  const configured = stored?.configured === true;

  // Marks go to the machine; with it off, to cloud storage (when the site has it).
  useEffect(() => connectMarks(ai), [ai]);
  useEffect(() => {
    connectMarkFallback(configured ? markStoredNsfw : null);
    return () => connectMarkFallback(null);
  }, [configured]);

  const load = useCallback(async () => {
    let failed = false;
    const [s, m, d, h] = await Promise.all([
      storedGallery().catch((err: Error) => {
        failed = true;
        setProblem(err.message);
        return null;
      }),
      machineOn
        ? Promise.all([ai.studioItems(), ai.memeLab().catch(() => null)]).then(
            ([items, lab]) => {
              rememberItems(items);
              if (lab) rememberItems(lab.records ?? []);
              const made: Creation[] = items.map((it) => {
                const source = sourceOf(it);
                return {
                  id: it.id,
                  kind: it.kind,
                  url: it.url,
                  label: it.prompt,
                  nsfw: it.nsfw === true || isNsfw(it.prompt),
                  seconds: it.seconds,
                  source,
                  origin: 'machine' as const,
                  prompt: it.prompt,
                  lab: false,
                  movie: it.movie,
                  createdAt: it.createdAt,
                  downloadUrl: withParam(it.url, 'download=1'),
                };
              });
              const fromLab: Creation[] = (lab?.records ?? [])
                .filter((r) => r && r.id && r.url)
                .map((r) => ({
                  id: r.id,
                  kind: r.kind === 'image' ? 'image' : 'video',
                  url: r.url!,
                  label: r.title,
                  nsfw: r.nsfw === true || isNsfw(r.title, r.prompt, r.caption, r.remixOf),
                  seconds: r.seconds,
                  source: 'lab' as const,
                  origin: 'machine' as const,
                  prompt: r.prompt,
                  title: r.title,
                  caption: r.caption,
                  hashtags: r.hashtags,
                  score: r.score,
                  lab: true,
                  movie: r.movieId,
                  createdAt: r.createdAt,
                  downloadUrl: withParam(r.url!, 'download=1'),
                }));
              return [...made, ...fromLab];
            },
            () => null,
          )
        : Promise.resolve(null),
      cloudMadeList(),
      loadHeld(ai, machineOn),
    ]);
    setHeld(h);
    if (s) {
      setProblem(null);
      rememberItems(s.items);
    }
    // A failed look keeps what was shown before.
    if (!failed) setStored(s);
    setMachineList(m);
    setDevice(
      d.map((c) => ({
        id: `cloud-${c.id}`,
        kind: c.kind,
        url: c.url,
        label: c.prompt,
        nsfw: isNsfw(c.prompt),
        source: 'cloud',
        origin: 'device',
        prompt: c.prompt,
        lab: false,
        createdAt: c.createdAt,
        downloadUrl: c.url,
      })),
    );
    setLoaded(true);
    // Made in the cloud and waiting on this device: into cloud storage now, if the site has it.
    if (s?.configured && !machineOn && d.length) void moveCloudMadeToStorage(saveCloudToStorage).then((n) => {
        if (n) void load();
      });
  }, [ai, machineOn]);

  useEffect(() => {
    if (!isActive) return;
    void load();
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
  }, [isActive, load]);

  // One list: the machine's first (its links work best while it is on), then what only cloud storage
  // has, then what waits on this device.
  const all = useMemo(() => {
    const out: Creation[] = [];
    const seen = new Set<string>();
    for (const c of machineList ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    for (const it of stored?.items ?? []) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push({
        id: it.id,
        kind: it.kind,
        url: it.url,
        label: it.title || it.prompt,
        nsfw: it.nsfw === true || isNsfw(it.title, it.prompt, it.caption),
        seconds: it.seconds,
        source: it.source,
        origin: 'storage',
        prompt: it.prompt,
        title: it.title,
        caption: it.caption,
        hashtags: it.hashtags,
        score: it.score,
        lab: it.lab,
        movie: it.movie,
        createdAt: it.createdAt,
        downloadUrl: it.downloadUrl,
      });
    }
    out.push(...device);
    return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [machineList, stored, device]);

  // Counted as shown: NSFW ones only while "Show NSFW" is on.
  useNsfwFlags();
  const view = useNsfwView();
  const visible = all.filter((it) => shows(nsfwFor(it.id, it.nsfw), view));
  const counts = (() => {
    const c: Record<string, number> = { all: 0 };
    for (const it of visible) {
      if (pick.kind !== 'all' && it.kind !== pick.kind) continue;
      c.all++;
      c[it.source] = (c[it.source] ?? 0) + 1;
    }
    return c;
  })();
  const shown = all.filter((it) => (pick.kind === 'all' || it.kind === pick.kind) && (pick.source === 'all' || it.source === pick.source));
  const open = viewing ? (all.find((x) => x.id === viewing) ?? null) : null;
  const step = useGalleryStepper(shown, open?.id);
  const reviewing = showHeld && held.length > 0;

  // Gone (deleted elsewhere): the viewer closes.
  useEffect(() => {
    if (viewing && loaded && !open) setViewing(null);
  }, [viewing, loaded, open]);

  const turnOn = async () => {
    setPowering(true);
    try {
      setStatus(await ai.power('start', speed.chosen?.id));
      toast('Turning the AI machine on (2–4 minutes).', 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPowering(false);
    }
  };

  const keep = async (c: Creation) => {
    setBusy(c.id);
    try {
      if (c.origin === 'machine') await ai.keepMeme(c.id);
      else await keepStored(c.id);
      toast('Kept in your gallery.', 'success');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const remove = async (c: Creation) => {
    try {
      if (c.origin === 'device') await cloudMadeRemove(c.id.replace(/^cloud-/, ''));
      else if (c.origin === 'machine') await (c.lab ? ai.deleteMeme(c.id) : ai.deleteStudioItem(c.id));
      else await deleteStored(c.id);
      setViewing(null);
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const copyCaption = (c: Creation) => {
    const text = `${c.caption ?? ''} ${(c.hashtags ?? []).join(' ')}`.trim();
    navigator.clipboard?.writeText(text).then(
      () => toast('Caption copied.', 'success'),
      () => toast('Could not copy. Select the caption and copy it instead.', 'error'),
    );
  };

  const off = status ? !machineOn : false;
  const waking = status?.state === 'starting' || status?.state === 'downloading';
  const noStorage = stored !== undefined && !configured;
  const kicker = `Gallery${loaded ? ` · ${visible.length} ${visible.length === 1 ? 'creation' : 'creations'}` : ''}${status ? ` · your AI machine is ${machineOn ? 'on' : waking ? 'waking up' : 'resting'}` : ''}`;

  return (
    <div className="ag-root ai-root gallery-root">
      <div className="gallery-scroll" ref={scroller}>
        <MagCover
          kicker={kicker}
          title="Gallery"
          dek="Everything you have made, in one place: Make, the cloud, the Lab, soReal and Live Draw. It shows here with the AI machine off too."
        />
        <section className="gallery-body" aria-label="Your creations">
          {off && noStorage && (
            <MachineNotice id="gallery" label="AI machine off">
              <div className="ai-banner" role="status">
                <p>{NOT_SET_UP} Until then, turn the AI machine on to see it.</p>
                {!waking && (
                  <>
                    <SpeedChoice {...speed} />
                    <button type="button" className="btn primary" onClick={() => void turnOn()} disabled={powering}>
                      {powering ? 'Turning on…' : 'Turn it on'}
                    </button>
                  </>
                )}
              </div>
            </MachineNotice>
          )}
          {problem && <p className="ai-error">{problem}</p>}

          <div className="gallery-filters">
            {!reviewing && (
            <Segmented<Kind>
              label="Pictures or videos"
              value={pick.kind}
              options={[
                { value: 'all', label: 'All' },
                { value: 'image', label: 'Pictures' },
                { value: 'video', label: 'Videos' },
              ]}
              onChange={(kind) => setPick({ kind })}
            />
            )}
            <div className="gallery-sources" role="radiogroup" aria-label="Made in">
              {SOURCES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={!reviewing && pick.source === s.value}
                  className="gallery-source"
                  onClick={() => {
                    setShowHeld(false);
                    setPick({ source: s.value });
                  }}
                >
                  {s.label}
                  <span className="gallery-source-n">{counts[s.value] ?? 0}</span>
                </button>
              ))}
              {held.length > 0 && (
                <button type="button" role="radio" aria-checked={reviewing} className="gallery-source gallery-source-held" onClick={() => setShowHeld(true)}>
                  Held for review
                  <span className="gallery-source-n" aria-label={`${held.length} held`}>
                    {held.length}
                  </span>
                </button>
              )}
            </div>
          </div>

          {reviewing ? (
            <HeldReview items={held} ai={ai} machineOn={machineOn} onChanged={() => void load()} />
          ) : !loaded ? (
            <p className="ai-muted">Opening your gallery…</p>
          ) : shown.length === 0 ? (
            <p className="ai-muted gallery-empty">
              {all.length === 0
                ? off && noStorage
                  ? 'Nothing to show yet with the machine off.'
                  : 'Nothing here yet. What you make in Make, the Lab, soReal and Live Draw shows up here.'
                : 'Nothing of this kind yet. Pick another tab.'}
            </p>
          ) : (
            <GalleryGrid
              items={shown}
              label={pick.source === 'all' ? 'All your creations' : `From ${SOURCES.find((s) => s.value === pick.source)!.label}`}
              onOpen={(m, from) => {
                viewFrom.current = from;
                setViewing(m.id);
              }}
              corner={(m) =>
                m.lab ? (
                  <span className="ai-tile-score gallery-tile-tag" aria-hidden>
                    {m.score != null ? m.score : 'Lab'}
                  </span>
                ) : m.origin === 'device' ? (
                  <span className="ai-tile-score gallery-tile-tag" aria-hidden>
                    On this device
                  </span>
                ) : null
              }
            />
          )}
          <div className="gallery-links">
            <button type="button" className="btn ghost" onClick={() => launch('make')}>
              <Icon name="image" size={16} /> Make something
            </button>
            <button type="button" className="btn ghost" onClick={() => launch('lab')}>
              <Icon name="sparkle" size={16} /> Open the Lab
            </button>
          </div>
        </section>
      </div>

      {open && (
        <GalleryViewer
          media={open}
          title={open.lab ? (open.kind === 'image' ? 'Lab picture' : 'Lab video') : open.kind === 'image' ? 'Picture' : 'Video'}
          origin={viewFrom.current}
          onClose={() => setViewing(null)}
          onPrev={step.prev ? () => setViewing(step.prev!.id) : null}
          onNext={step.next ? () => setViewing(step.next!.id) : null}
          position={step.index >= 0 ? { index: step.index, count: step.count } : undefined}
          words={
            <div className="lab-detail-words">
              {open.title && <p className="meme-card-title">{open.title}</p>}
              {open.caption ? (
                <p className="meme-card-caption">
                  {open.caption} <span className="ai-muted">{(open.hashtags ?? []).join(' ')}</span>
                </p>
              ) : (
                open.prompt && open.prompt !== open.title && <p className="ai-viewer-prompt">{open.prompt}</p>
              )}
            </div>
          }
        >
          <p className="ai-muted gallery-meta">
            {SOURCE_NAME[open.source]}
            {open.lab ? ' · kept apart until you keep it' : ''}
            {open.createdAt ? ` · ${when(open.createdAt)}` : ''}
            {open.seconds ? ` · ${Math.round(open.seconds)} s` : ''}
            {open.score != null ? ` · viral score ${open.score}` : ''}
            {open.origin === 'device' ? ' · waiting on this device, it moves into your gallery once it can' : ''}
          </p>
          <div className="ai-viewer-actions">
            <a className="btn" href={open.downloadUrl} download target={open.origin === 'device' ? '_blank' : undefined} rel="noopener noreferrer">
              <Icon name="download" size={16} /> Save
            </a>
            {open.lab && (
              <button type="button" className="btn" disabled={busy === open.id} onClick={() => void keep(open)}>
                <Icon name="check" size={16} /> Keep in my gallery
              </button>
            )}
            {open.caption && (
              <button type="button" className="btn" onClick={() => copyCaption(open)}>
                <Icon name="copy" size={16} /> Copy caption
              </button>
            )}
            <button type="button" className="btn danger" onClick={() => setConfirmDelete(open)}>
              <Icon name="trash" size={16} /> Delete
            </button>
          </div>
        </GalleryViewer>
      )}
      {confirmDelete && (
        <ConfirmSheet
          title="Delete this?"
          message={confirmDelete.origin === 'device' ? 'It is removed from this device.' : 'It is removed from your gallery for all your devices.'}
          confirmLabel="Delete"
          destructive
          onConfirm={() => {
            const c = confirmDelete;
            setConfirmDelete(null);
            void remove(c);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
