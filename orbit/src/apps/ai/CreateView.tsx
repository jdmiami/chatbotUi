import { useCallback, useEffect, useRef, useState } from 'react';
import { useShell } from '../../state/shell';
import { Icon } from '../../ui/Icon';
import { ConfirmSheet, EmptyState, IconButton, Segmented, Sheet } from '../../ui/components';
import { AiError, type LocalAi, type StudioItem, type StudioJob, type StudioKind, type StudioState } from '../../services/ai/LocalAi';

const SIZES: Record<StudioKind, { value: string; label: string }[]> = {
  image: [
    { value: 'square', label: 'Square' },
    { value: 'portrait', label: 'Portrait' },
    { value: 'landscape', label: 'Landscape' },
  ],
  video: [
    { value: 'landscape', label: 'Landscape' },
    { value: 'portrait', label: 'Portrait' },
    { value: 'square', label: 'Square' },
  ],
};
const LENGTHS = [
  { value: '3', label: '3 s' },
  { value: '5', label: '5 s' },
  { value: '8', label: '8 s' },
];

/** Shrink a picture (any format the browser reads, HEIC included on iPhone) to a JPEG data URL. */
async function toDataUrl(src: Blob, max = 1920): Promise<string> {
  const url = URL.createObjectURL(src);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const withParam = (url: string, param: string) => url + (url.includes('?') ? '&' : '?') + param;
const active = (j: StudioJob) => j.status === 'queued' || j.status === 'running';

/**
 * Create: make images and videos (with sound) on the AI machine. Results stay on the machine's
 * storage and show in the gallery on every device.
 */
export function CreateView({ ai, machineOn, isActive }: { ai: LocalAi; machineOn: boolean; isActive: boolean }) {
  const toast = useShell((s) => s.toast);
  const [kind, setKind] = useState<StudioKind>('image');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<Record<StudioKind, string>>({ image: 'square', video: 'landscape' });
  const [seconds, setSeconds] = useState('5');
  const [startImage, setStartImage] = useState<string | null>(null);
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [items, setItems] = useState<StudioItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [viewing, setViewing] = useState<StudioItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StudioItem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadItems = useCallback(() => {
    ai.studioItems()
      .then(setItems)
      .catch(() => {});
  }, [ai]);

  const refresh = useCallback(async () => {
    try {
      const s = await ai.studioState();
      setStudio(s);
      setStudioError(null);
      setJobs((prev) => {
        const known = new Map(prev.map((j) => [j.id, j]));
        for (const j of s.jobs) known.set(j.id, j);
        return [...known.values()].filter((j) => active(j) || j.status === 'error').slice(-6);
      });
    } catch (err) {
      setStudioError(err instanceof AiError && err.status === 404 ? 'The image and video maker is not installed on your AI machine yet.' : (err as Error).message);
    }
  }, [ai]);

  // Machine state and the gallery while this view is open.
  useEffect(() => {
    if (!isActive || !machineOn) return;
    void refresh();
    loadItems();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [isActive, machineOn, refresh, loadItems]);

  // Follow running jobs closely.
  const running = jobs.filter(active);
  useEffect(() => {
    if (!running.length) return;
    const t = setInterval(async () => {
      const updated = await Promise.all(running.map((j) => ai.studioJob(j.id).catch(() => j)));
      setJobs((prev) => prev.map((j) => updated.find((x) => x.id === j.id) ?? j).filter((j) => j.status !== 'done' && j.status !== 'stopped'));
      if (updated.some((u) => u.status === 'done')) loadItems();
    }, 2000);
    return () => clearInterval(t);
  }, [running.map((j) => j.id).join(','), ai, loadItems]); // eslint-disable-line react-hooks/exhaustive-deps

  const maker = studio?.[kind];
  const canMake = machineOn && Boolean(maker?.ready) && Boolean(prompt.trim()) && !submitting;

  const make = async () => {
    if (!canMake) return;
    setSubmitting(true);
    try {
      const job = await ai.createStudioJob({
        kind,
        prompt: prompt.trim(),
        size: size[kind],
        ...(kind === 'video' ? { seconds: Number(seconds), image: startImage ?? undefined } : {}),
      });
      if (job.status === 'error') toast(job.error || 'That did not start.', 'error');
      else setJobs((prev) => [...prev, job]);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      setStartImage(await toDataUrl(file));
      setKind('video');
    } catch {
      toast('That picture could not be read.', 'error');
    }
  };

  const animate = async (item: StudioItem) => {
    try {
      const blob = await (await fetch(item.url)).blob();
      setStartImage(await toDataUrl(blob));
      setKind('video');
      setPrompt('');
      setViewing(null);
      toast('Describe how it should move, then tap Make.', 'info');
    } catch {
      toast('Could not load that picture.', 'error');
    }
  };

  const status = (() => {
    if (!machineOn) return 'Turn on your AI machine to make images and videos.';
    if (studioError) return studioError;
    if (!studio) return 'Checking the image and video maker…';
    if (!maker?.downloaded) return `The ${kind} maker is downloading (first start only): ${maker?.percent ?? 0}%.`;
    if (!studio.running) return studio.setup.startsWith('error') ? `The maker had a problem: ${studio.setup.slice(6).trim()}` : 'The image and video maker is starting…';
    return kind === 'image' ? 'Images take under a minute.' : 'Videos with sound take a few minutes.';
  })();

  return (
    <div className="ai-create">
      <form
        className="ai-create-form"
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
      >
        <Segmented
          label="What to make"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'image', label: 'Image' },
            { value: 'video', label: 'Video' },
          ]}
        />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          aria-label="Describe it"
          placeholder={kind === 'image' ? 'Describe the picture…' : startImage ? 'Describe how the photo should move, and any sound…' : 'Describe the scene, the motion and the sound…'}
        />
        <div className="ai-create-options">
          <Segmented label="Shape" value={size[kind]} onChange={(v) => setSize((s) => ({ ...s, [kind]: v }))} options={SIZES[kind]} />
          {kind === 'video' && <Segmented label="Length" value={seconds} onChange={setSeconds} options={LENGTHS} />}
        </div>
        {kind === 'video' && (
          <div className="ai-create-photo">
            {startImage ? (
              <>
                <img src={startImage} alt="Starting photo" />
                <span className="ai-muted">The video starts from this photo.</span>
                <IconButton icon="close" label="Remove the starting photo" onClick={() => setStartImage(null)} />
              </>
            ) : (
              <button type="button" className="btn ghost" onClick={() => fileInput.current?.click()}>
                <Icon name="image" size={18} /> Start from a photo
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void pickPhoto(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        )}
        <button type="submit" className="btn primary ai-make" disabled={!canMake}>
          <Icon name={kind === 'image' ? 'image' : 'film'} size={18} /> {submitting ? 'Starting…' : kind === 'image' ? 'Make image' : 'Make video'}
        </button>
        <p className="ai-muted" role="status">
          {status}
        </p>
      </form>

      {jobs.length > 0 && (
        <ul className="ai-jobs" aria-label="In progress">
          {jobs.map((j) => (
            <li key={j.id} className={`ai-job ai-job-${j.status}`}>
              <Icon name={j.kind === 'image' ? 'image' : 'film'} size={18} />
              <div className="ai-job-text">
                <span className="ai-list-title">{j.prompt}</span>
                {j.status === 'error' ? (
                  <span className="ai-error">{j.error}</span>
                ) : (
                  <div className="ai-bar" aria-label={`${j.progress}%`}>
                    <span style={{ width: `${Math.max(3, j.progress)}%` }} />
                  </div>
                )}
              </div>
              {active(j) ? (
                <IconButton
                  icon="stop"
                  label="Stop"
                  onClick={() => void ai.cancelStudioJob(j.id).then(() => setJobs((p) => p.filter((x) => x.id !== j.id)), () => {})}
                />
              ) : (
                <IconButton icon="close" label="Dismiss" onClick={() => setJobs((p) => p.filter((x) => x.id !== j.id))} />
              )}
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 ? (
        <EmptyState icon="image" title="Your creations">
          Pictures and videos you make are kept on your AI machine and show up here on all your devices.
        </EmptyState>
      ) : (
        <ul className="ai-gallery" aria-label="Your creations">
          {items.map((it) => (
            <li key={it.id}>
              <button type="button" className="ai-tile" onClick={() => setViewing(it)} aria-label={`${it.kind === 'video' ? 'Video' : 'Image'}: ${it.prompt}`}>
                {it.kind === 'image' ? (
                  <img src={it.url} alt="" loading="lazy" />
                ) : (
                  <>
                    <video src={`${it.url}#t=0.1`} muted playsInline preload="metadata" />
                    <span className="ai-tile-badge">
                      <Icon name="play" size={14} /> {it.seconds ? `${it.seconds}s` : ''}
                    </span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {viewing && (
        <Sheet title={viewing.kind === 'image' ? 'Image' : 'Video'} onClose={() => setViewing(null)}>
          <div className="ai-viewer">
            {viewing.kind === 'image' ? (
              <img src={viewing.url} alt={viewing.prompt} />
            ) : (
              <video src={viewing.url} controls playsInline autoPlay />
            )}
            <p className="ai-viewer-prompt">{viewing.prompt}</p>
            <div className="ai-viewer-actions">
              <a className="btn" href={withParam(viewing.url, 'download=1')} download>
                <Icon name="download" size={16} /> Save
              </a>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setKind(viewing.kind);
                  setPrompt(viewing.prompt);
                  setViewing(null);
                }}
              >
                <Icon name="refresh" size={16} /> Use prompt
              </button>
              {viewing.kind === 'image' && (
                <button type="button" className="btn" onClick={() => void animate(viewing)}>
                  <Icon name="film" size={16} /> Make it move
                </button>
              )}
              <button type="button" className="btn danger" onClick={() => setConfirmDelete(viewing)}>
                <Icon name="trash" size={16} /> Delete
              </button>
            </div>
          </div>
        </Sheet>
      )}
      {confirmDelete && (
        <ConfirmSheet
          title="Delete this?"
          message="It is removed from your AI machine for all your devices."
          confirmLabel="Delete"
          destructive
          onConfirm={() => {
            const it = confirmDelete;
            setConfirmDelete(null);
            setViewing(null);
            ai.deleteStudioItem(it.id).then(
              () => setItems((list) => list.filter((x) => x.id !== it.id)),
              (err: Error) => toast(err.message, 'error'),
            );
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
