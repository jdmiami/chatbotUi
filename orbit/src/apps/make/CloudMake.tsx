import { useCallback, useEffect, useRef, useState } from 'react';
import { useShell } from '../../state/shell';
import { Icon } from '../../ui/Icon';
import { ConfirmSheet } from '../../ui/components';
import { TextArea } from '../../ui/TextArea';
import { isNsfw } from '../../ui/nsfw';
import { GalleryGrid, GalleryViewer, useGalleryStepper, type GalleryMedia } from '../ai/Gallery';
import { saveCloudToStorage } from '../../services/ai/StoredGallery';
import type { LocalAi } from '../../services/ai/LocalAi';
import {
  cloudMadeAdd,
  cloudMadeList,
  cloudMadeRemove,
  cloudMakeInfo,
  cloudMakeStart,
  cloudMakeStatus,
  moveCloudMadeToGallery,
  moveCloudMadeToStorage,
  type CloudJob,
  type CloudKind,
  type CloudMade,
  type CloudMakeInfo,
  type CloudSize,
} from '../../services/ai/CloudMake';

/**
 * Make in the cloud: pictures and videos without the AI machine (Cloudflare, fal.ai), a few cents
 * or free. What comes back is saved straight into the gallery kept in cloud storage when the site
 * has it (it shows in the Gallery app at once); otherwise it waits on this device and moves into
 * the gallery once the machine is on.
 */
export function CloudMake({
  ai,
  machineOn,
  isActive,
  open,
  onOpen,
  onMoved,
  seed,
}: {
  ai: LocalAi;
  machineOn: boolean;
  isActive: boolean;
  /** Folded (machine on): just a link to open it; what waits here still moves into the gallery. */
  open: boolean;
  onOpen: () => void;
  onMoved?: () => void;
  /** Start from what was set up in the steps (n changes each time it is sent). */
  seed?: { prompt: string; kind: CloudKind; n: number } | null;
}) {
  const toast = useShell((s) => s.toast);
  const [info, setInfo] = useState<CloudMakeInfo | null | undefined>(undefined);
  const [kind, setKind] = useState<CloudKind>('image');
  const [size, setSize] = useState<CloudSize>('square');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<(CloudJob & { prompt: string })[]>([]);
  const [made, setMade] = useState<CloudMade[]>([]);
  const [viewing, setViewing] = useState<CloudMade | null>(null);
  const from = useRef<DOMRect | null>(null);
  // Saved into cloud storage during this visit: still shown here (with links that work for hours).
  const [saved, setSaved] = useState<CloudMade[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<CloudMade | null>(null);
  const [storage, setStorage] = useState(true);
  const launch = useShell((s) => s.launch);

  useEffect(() => {
    if (!seed) return;
    setKind(seed.kind);
    setSize(seed.kind === 'video' ? 'landscape' : 'square');
    if (seed.prompt) setPrompt(seed.prompt);
  }, [seed?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => void cloudMadeList().then(setMade), []);
  useEffect(() => {
    if (!isActive) return;
    void cloudMakeInfo().then(setInfo);
    reload();
  }, [isActive, reload]);

  // The machine is on: move what waits here into the gallery.
  useEffect(() => {
    if (!machineOn || !made.length) return;
    void moveCloudMadeToGallery(ai).then((n) => {
      if (!n) return;
      reload();
      onMoved?.();
      toast(n === 1 ? 'Moved 1 cloud creation into your gallery.' : `Moved ${n} cloud creations into your gallery.`, 'success');
    });
  }, [machineOn, made.length, ai, reload, onMoved, toast]);

  // The machine is off: what waits here goes into cloud storage when the site has it.
  useEffect(() => {
    if (machineOn || !made.length || !storage) return;
    const waiting = made;
    void moveCloudMadeToStorage(saveCloudToStorage).then((n) => {
      if (!n) return setStorage(false);
      reload();
      void cloudMadeList().then((left) => setSaved((list) => [...waiting.filter((w) => !left.some((l) => l.id === w.id)), ...list]));
    });
  }, [machineOn, made, storage, reload]);

  // Follow queued jobs until they are done.
  const waiting = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    if (!waiting.length) return;
    const t = setInterval(async () => {
      for (const j of waiting) {
        try {
          const next = await cloudMakeStatus(j.id);
          if (next.status === 'done' && next.url) await keep({ ...next, prompt: j.prompt });
          setJobs((list) => list.map((x) => (x.id === j.id ? { ...next, prompt: j.prompt } : x)).filter((x) => x.status !== 'done'));
        } catch (err) {
          setJobs((list) => list.map((x) => (x.id === j.id ? { ...x, status: 'error', error: (err as Error).message } : x)));
        }
      }
    }, 3000);
    return () => clearInterval(t);
  }, [waiting.map((j) => j.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const keep = async (j: CloudJob & { prompt: string }) => {
    const item: CloudMade = { id: j.id.slice(-24) + Date.now().toString(36), kind: j.kind, prompt: j.prompt, url: j.url!, provider: j.provider, createdAt: new Date().toISOString() };
    // Straight into the gallery kept in cloud storage (machine off), else it waits on this device.
    if (!machineOn && storage) {
      try {
        await saveCloudToStorage({ url: item.url, kind: item.kind, prompt: item.prompt, maker: `cloud:${item.provider}` });
        setSaved((list) => [item, ...list]);
        return;
      } catch {
        setStorage(false);
      }
    }
    await cloudMadeAdd(item);
    reload();
  };

  const start = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    if (isNsfw(text)) return toast("Cloud makers don't allow adult content. Make this one on your own AI machine.", 'info');
    setBusy(true);
    try {
      const job = await cloudMakeStart({ kind, prompt: text, size });
      if (job.status === 'done' && job.url) await keep({ ...job, prompt: text });
      else setJobs((list) => [...list, { ...job, prompt: text }]);
      setPrompt('');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  // The viewer steps through what is shown below (hooks before the early answer).
  const shownMade = [...saved.filter((s) => !made.some((m) => m.id === s.id)), ...made];
  const step = useGalleryStepper(
    shownMade.map((m) => ({ id: `cloud-${m.id}`, kind: m.kind, url: m.url, label: m.prompt, nsfw: isNsfw(m.prompt) })),
    viewing ? `cloud-${viewing.id}` : null,
  );
  const byMediaId = (id: string | undefined) => shownMade.find((x) => `cloud-${x.id}` === id) ?? null;

  if (info === undefined) return null;
  if (!open)
    return (
      <div className="make-cloud-link">
        <button type="button" className="btn small ghost" onClick={onOpen}>
          Make it in the cloud instead
        </button>
      </div>
    );
  const makers = kind === 'video' ? info?.video ?? [] : info?.image ?? [];
  const media = (m: CloudMade): GalleryMedia => ({ id: `cloud-${m.id}`, kind: m.kind, url: m.url, label: m.prompt, nsfw: isNsfw(m.prompt) });
  const isSaved = (m: CloudMade) => saved.some((s) => s.id === m.id);

  return (
    <section className="cloud-make" aria-labelledby="cloud-make-t">
      <p className="o5-kicker">No machine needed</p>
      <h3 className="o5-step-title" id="cloud-make-t">
        Make it in the cloud
      </h3>
      {!info?.configured ? (
        <p className="ai-muted">
          Cloud making isn't set up yet. It uses Runpod Serverless (RUNPOD_API_KEY, paid from your Runpod balance), a Cloudflare Workers AI token (CLOUDFLARE_ACCOUNT_ID and
          CLOUDFLARE_AI_TOKEN: about 230 free pictures a day) or a fal.ai key (FAL_KEY) in Vercel.
        </p>
      ) : (
        <>
          <p className="ai-muted">
            Ready in seconds, while your AI machine rests. {makers[0] ? `${makers[0].name}: ${makers[0].price}.` : ''} Not for NSFW: that stays on your own machine.
            {!machineOn ? ' What you make here moves into your gallery the next time the AI machine is on.' : ''}
          </p>
          <div className="ai-maker-picks" role="radiogroup" aria-label="Cloud: what to make">
            {(
              [
                ['image', 'A picture'],
                ['video', 'A video'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                className="ai-maker-chip"
                disabled={k === 'video' && !info.video.length}
                onClick={() => {
                  setKind(k);
                  setSize(k === 'video' ? 'landscape' : 'square');
                }}
              >
                {label}
                {k === 'video' && !info.video.length ? <span className="ai-muted"> not set up</span> : null}
              </button>
            ))}
          </div>
          <div className="ai-maker-picks" role="radiogroup" aria-label="Cloud: shape">
            {(
              [
                ['square', 'Square'],
                ['landscape', 'Wide'],
                ['portrait', 'Tall'],
              ] as const
            ).map(([s, label]) => (
              <button key={s} type="button" role="radio" aria-checked={size === s} className="ai-maker-chip" onClick={() => setSize(s)}>
                {label}
              </button>
            ))}
          </div>
          <form
            className="cloud-make-form"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <TextArea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="A lighthouse at dawn, mist over the sea" aria-label="Describe it for the cloud" />
            <button type="submit" className="btn primary" disabled={!prompt.trim() || busy || !makers.length}>
              <Icon name="sparkle" size={16} /> {busy ? 'Sending…' : kind === 'video' ? 'Make the video in the cloud' : 'Make the picture in the cloud'}
            </button>
          </form>
          {jobs.length > 0 && (
            <ul className="cloud-make-jobs" aria-label="Cloud jobs">
              {jobs.map((j) => (
                <li key={j.id} data-status={j.status}>
                  <span className="cloud-make-job-text">{j.prompt}</span>
                  <span className="ai-muted">
                    {j.status === 'error' ? j.error : j.status === 'queued' ? (j.position ? `In line, ${j.position} ahead` : 'In line') : 'Making…'}
                  </span>
                  {j.status === 'error' && (
                    <button type="button" className="btn small ghost" onClick={() => setJobs((list) => list.filter((x) => x.id !== j.id))}>
                      Dismiss
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {shownMade.length > 0 && (
        <>
          <p className="o5-kicker cloud-make-made">
            Made in the cloud{made.length === 0 ? ' · saved in your gallery' : machineOn ? ' · moving into your gallery' : ' · waiting on this device'}
          </p>
          <GalleryGrid
            items={shownMade.map(media)}
            label="Made in the cloud"
            onOpen={(m, rect) => {
              from.current = rect;
              setViewing(byMediaId(m.id));
            }}
          />
        </>
      )}
      {viewing && (
        <GalleryViewer
          media={media(viewing)}
          title={viewing.kind === 'video' ? 'Video' : 'Picture'}
          origin={from.current}
          onClose={() => setViewing(null)}
          onPrev={step.prev ? () => setViewing(byMediaId(step.prev!.id)) : null}
          onNext={step.next ? () => setViewing(byMediaId(step.next!.id)) : null}
          position={step.index >= 0 ? { index: step.index, count: step.count } : undefined}
          neighbours={[step.prev, step.next]}
          words={viewing.prompt}
        >
          {isSaved(viewing) ? (
            <div className="row-inline">
              <a className="btn small ghost" href={viewing.url} download target="_blank" rel="noopener noreferrer">
                Save
              </a>
              <button type="button" className="btn small ghost" onClick={() => launch('gallery')}>
                Saved in your gallery: open Gallery
              </button>
            </div>
          ) : (
          <div className="row-inline">
            <a className="btn small ghost" href={viewing.url} download target="_blank" rel="noopener noreferrer">
              Save
            </a>
            <button
              type="button"
              className="btn small ghost"
              onClick={() => setConfirmDelete(viewing)}
            >
              Delete
            </button>
          </div>
          )}
        </GalleryViewer>
      )}
      {confirmDelete && (
        <ConfirmSheet
          title="Delete this?"
          message="It is removed from this device."
          confirmLabel="Delete"
          destructive
          onConfirm={() => {
            const it = confirmDelete;
            setConfirmDelete(null);
            setViewing(null);
            void cloudMadeRemove(it.id).then(reload);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </section>
  );
}
