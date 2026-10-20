import { useCallback, useEffect, useRef, useState } from 'react';
import { Step, nextStep } from '../../shell/o5/Step';
import { useShell } from '../../state/shell';
import { Icon } from '../../ui/Icon';
import { ConfirmSheet, EmptyState, IconButton, Segmented, Sheet, Toggle } from '../../ui/components';
import { AiError, type LocalAi, type StudioItem, type StudioJob, type StudioKind, type StudioMakerInfo, type StudioState } from '../../services/ai/LocalAi';
import { MAKER_CATALOG, rememberMakers, rememberedMakers } from './makerCatalog';
import { TextArea } from '../../ui/TextArea';

type Mode = StudioKind | 'edit';
const DEFAULT_PICK: Record<Mode, string> = { image: 'qwen', video: 'ltx', edit: 'edit' };
const ANGLES = ['front-right quarter view, eye-level shot', 'right side view, eye-level shot', 'back view, eye-level shot', 'left side view, eye-level shot', 'front view, high-angle shot', 'front view, eye-level shot close-up'];

function loadPick(): Record<Mode, string> {
  try {
    return { ...DEFAULT_PICK, ...JSON.parse(localStorage.getItem('orbit:studio:pick') || '{}') };
  } catch {
    return { ...DEFAULT_PICK };
  }
}

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

/** "about 40 s", "about 3 min" */
const about = (sec: number) => (sec < 50 ? `about ${Math.max(5, Math.round(sec / 5) * 5)} s` : `about ${Math.max(1, Math.round(sec / 60))} min`);
const ordinal = (n: number) => (n === 1 ? 'Next' : `${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`);
/** One line on where a job stands: its place in line, time left, or that it is slow. */
function jobLine(j: StudioJob): string | null {
  if (j.status !== 'queued' && j.status !== 'running') return null;
  if (j.position) return `${ordinal(j.position)} in line${j.etaSeconds != null ? ` · ready in ${about(j.etaSeconds)}` : ''}`;
  if (j.slow) return 'Slower than usual · the machine is watching it';
  if (j.etaSeconds != null) return j.etaSeconds > 0 ? `Making it · ${about(j.etaSeconds)} left` : 'Almost there';
  return null;
}

const withParam = (url: string, param: string) => url + (url.includes('?') ? '&' : '?') + param;
const active = (j: StudioJob) => j.status === 'queued' || j.status === 'running';

/**
 * Create: make images and videos (with sound) on the AI machine. Results stay on the machine's
 * storage and show in the gallery on every device.
 */
export function CreateView({
  ai,
  machineOn,
  isActive,
  onOpenMakers,
}: {
  ai: LocalAi;
  machineOn: boolean;
  isActive: boolean;
  /** Opens the Store at its picture and video makers. */
  onOpenMakers?: () => void;
}) {
  const toast = useShell((s) => s.toast);
  const o5 = useShell((s) => s.settings.skin === 'o5');
  // The next step glides into view once this one is answered.
  const next = (id: string) => nextStep(o5, id);
  const [kind, setKind] = useState<Mode>('image');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<Record<StudioKind, string>>({ image: 'square', video: 'landscape' });
  const [seconds, setSeconds] = useState('5');
  const [startImage, setStartImage] = useState<string | null>(null);
  /** When the starting picture comes from the gallery: its id (the machine already has the file). */
  const [startItem, setStartItem] = useState<string | null>(null);
  /** Pictures to edit: up to two (outfit swap: the person, then the outfit). */
  const [editImages, setEditImages] = useState<{ src: string; item?: string }[]>([]);
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [makers, setMakersState] = useState<StudioMakerInfo[] | null>(null);
  const [, setMakersError] = useState<string | null>(null);
  // Until the machine answers (or while it is off): the makers it last had, else what it offers.
  const [offline] = useState(() => rememberedMakers() ?? MAKER_CATALOG);
  const known = makers ?? offline;
  const setMakers = useCallback((list: StudioMakerInfo[]) => {
    setMakersState(list);
    setMakersError(null);
    rememberMakers(list);
  }, []);
  const [pick, setPickState] = useState<Record<Mode, string>>(loadPick);
  const [style, setStyle] = useState<string>('');
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [items, setItems] = useState<StudioItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [viewing, setViewing] = useState<StudioItem | null>(null);
  // The tapped tile, so the viewer grows out of it and the picture appears to fly up.
  const viewFrom = useRef<DOMRect | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StudioItem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const editInput = useRef<HTMLInputElement>(null);

  const setPick = (mode: Mode, id: string) =>
    setPickState((prev) => {
      const next = { ...prev, [mode]: id };
      try {
        localStorage.setItem('orbit:studio:pick', JSON.stringify(next));
      } catch {
        /* private mode */
      }
      return next;
    });

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
      ai.studioMakers().then(setMakers, (err: Error) => setMakersError(err.message));
    } catch (err) {
      const msg = err instanceof AiError && err.status === 404 ? 'The image and video maker is not installed on your AI machine yet.' : (err as Error).message;
      setStudioError(msg);
      setMakersError(msg);
    }
  }, [ai, setMakers]);

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

  // Makers for this mode: the installed ones, plus the one picked (even while it downloads).
  const kindsFor = (m: Mode): StudioMakerInfo['kind'][] => (m === 'edit' ? ['edit', 'upscale'] : [m]);
  const choices = known.filter((m) => kindsFor(kind).includes(m.kind) && (m.installed || m.wanted));
  const chosen = known.find((m) => m.id === pick[kind]) ?? known.find((m) => m.id === DEFAULT_PICK[kind]) ?? null;
  const chosenId = chosen?.id ?? DEFAULT_PICK[kind];
  const styles = known.filter((m) => m.kind === 'style' && m.for === chosenId && m.installed);
  const sharpen = chosen?.kind === 'upscale';
  const needImages = kind === 'edit' ? (chosen?.twoImages ? 2 : 1) : 0;
  const builtInMaker = studio?.[kind === 'video' ? 'video' : 'image'];
  const makerReady = machineOn && Boolean(studio?.running) && (chosen ? chosen.installed : Boolean(builtInMaker?.ready));
  const canMake = makerReady && (sharpen || Boolean(prompt.trim())) && editImages.length >= needImages && !submitting;

  const make = async () => {
    if (!canMake) return;
    setSubmitting(true);
    try {
      const fromGallery = kind === 'edit' ? editImages.find((p, i) => i === 0 && p.item)?.item : undefined;
      const job = await ai.createStudioJob({
        kind: kind === 'video' ? 'video' : 'image',
        maker: chosenId,
        prompt: prompt.trim(),
        ...(kind !== 'edit' ? { size: size[kind] } : {}),
        ...(style && styles.some((s) => s.id === style) ? { style } : {}),
        ...(kind === 'video'
          ? { seconds: Number(seconds), ...(startItem ? { fromItem: startItem } : { image: startImage ?? undefined }) }
          : {}),
        ...(kind === 'edit'
          ? {
              ...(fromGallery ? { fromItem: fromGallery } : {}),
              images: editImages.filter((p, i) => !(i === 0 && p.item)).map((p) => p.src).slice(0, needImages),
            }
          : {}),
      });
      if (job.status === 'error') {
        toast(job.error || 'That did not start.', 'error');
        return false;
      }
      setJobs((prev) => [...prev, job]);
      return true;
    } catch (err) {
      toast((err as Error).message, 'error');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      setStartImage(await toDataUrl(file));
      setStartItem(null);
      setKind('video');
    } catch {
      toast('That picture could not be read.', 'error');
    }
  };

  const addEditPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const src = await toDataUrl(file);
      setEditImages((prev) => [...prev, { src }].slice(-2));
    } catch {
      toast('That picture could not be read.', 'error');
    }
  };

  const animate = (item: StudioItem) => {
    setStartImage(item.url);
    setStartItem(item.id);
    setKind('video');
    setPrompt('');
    setViewing(null);
    toast('Describe how it should move, then tap Make video.', 'info');
  };

  const editItem = (item: StudioItem, maker = 'edit') => {
    setKind('edit');
    setPick('edit', maker);
    setEditImages([{ src: item.url, item: item.id }]);
    setPrompt('');
    setViewing(null);
    if (maker !== 'sharpen') toast('Describe the change, then tap Edit.', 'info');
  };

  const status = (() => {
    if (!machineOn) return 'Turn on your AI machine to make images and videos.';
    if (studioError) return studioError;
    if (!studio) return 'Checking the image and video maker…';
    if (chosen && !chosen.installed) return chosen.wanted ? `${chosen.name} is downloading: ${chosen.percent}%.` : `${chosen.name} is not installed. Open Makers to add it.`;
    if (!chosen && !builtInMaker?.downloaded) return `The maker is downloading (first start only): ${builtInMaker?.percent ?? 0}%.`;
    if (!studio.running) return studio.setup.startsWith('error') ? `The maker had a problem: ${studio.setup.slice(6).trim()}` : 'The image and video maker is starting…';
    if (kind === 'edit') return needImages === 2 && editImages.length < 2 ? 'Add the person first, then the outfit.' : sharpen ? 'Makes the picture four times larger and crisper.' : 'Edits take under a minute.';
    return kind === 'image' ? 'Images take under a minute.' : 'Videos with sound take a few minutes.';
  })();

  const verb = kind === 'image' ? 'Make image' : kind === 'video' ? 'Make video' : sharpen ? 'Sharpen' : 'Edit';

  return (
    <div className="ai-create">
      <form
        className="ai-create-form"
        onSubmit={(e) => {
          e.preventDefault();
          void make().then((started) => {
            // Only once something is actually being made; a failed start leaves you on the form.
            if (started) setTimeout(() => next('o5-making'), 120);
          });
        }}
      >
        <Step on={o5} n="01" id="o5-make-what" title="What will it be?">
          {o5 ? (
            <div className="o5-choices" role="radiogroup" aria-label="What to make">
              {(
                [
                  ['image', 'A picture', 'From a description'],
                  ['video', 'A video', 'With sound, from words or a photo'],
                  ['edit', 'An edit', 'Change a photo with words'],
                ] as const
              ).map(([v, label, hint]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={kind === v}
                  className="o5-choice"
                  onClick={() => {
                    setKind(v);
                    next('o5-make-who');
                  }}
                >
                  <span className="o5-go-label">{label}</span>
                  <span className="o5-go-hint">{hint}</span>
                </button>
              ))}
            </div>
          ) : (
            <Segmented
              label="What to make"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'image', label: 'Image' },
                { value: 'video', label: 'Video' },
                { value: 'edit', label: 'Edit' },
              ]}
            />
          )}
        </Step>
        <Step on={o5} n="02" id="o5-make-who" title="Who makes it">
        <div className="ai-maker-picks" role="radiogroup" aria-label="Maker">
          {(choices.length ? choices : chosen ? [chosen] : []).map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={m.id === chosenId} className="ai-maker-chip" onClick={() => {
              setPick(kind, m.id);
              next('o5-make-describe');
            }}>
              {m.name}
              {!m.installed && <span className="ai-muted"> {m.percent}%</span>}
            </button>
          ))}
          <button type="button" className="ai-maker-chip ai-maker-more" onClick={() => onOpenMakers?.()}>
            <Icon name="plus" size={14} /> Makers
          </button>
        </div>
        {styles.length > 0 && (
          <div className="ai-maker-picks" role="radiogroup" aria-label="Style">
            <button type="button" role="radio" aria-checked={!style} className="ai-maker-chip" onClick={() => setStyle('')}>
              No style
            </button>
            {styles.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={style === s.id} className="ai-maker-chip" onClick={() => setStyle(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
        )}
        </Step>
        <Step on={o5} n="03" id="o5-make-describe" title={kind === 'edit' ? 'Show it, then say the change' : 'Describe it'}>
        {kind === 'edit' && (
          <div className="ai-edit-photos">
            {editImages.map((p, i) => (
              <div key={i} className="ai-edit-photo">
                <img src={p.src} alt={needImages === 2 ? (i === 0 ? 'The person' : 'The outfit') : 'Picture to edit'} />
                <IconButton icon="close" label="Remove this picture" onClick={() => setEditImages((prev) => prev.filter((_, k) => k !== i))} />
              </div>
            ))}
            {editImages.length < Math.max(1, needImages) && (
              <button type="button" className="btn ghost" onClick={() => editInput.current?.click()}>
                <Icon name="image" size={18} /> {needImages === 2 && editImages.length === 1 ? 'Add the outfit' : 'Add a picture'}
              </button>
            )}
            <input
              ref={editInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void addEditPhoto(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        )}
        {!sharpen && (
          <TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            aria-label="Describe it"
            placeholder={
              kind === 'edit'
                ? chosenId === 'angles'
                  ? 'Which angle? e.g. back view, eye-level shot'
                  : chosenId === 'outfit'
                    ? 'e.g. Dress the person in image 1 in the denim jacket from image 2.'
                    : 'Describe the change… e.g. make it night, add snow'
                : kind === 'image'
                  ? 'Describe the picture…'
                  : startImage
                    ? 'Describe how the photo should move, and any sound…'
                    : 'Describe the scene, the motion and the sound…'
            }
          />
        )}
        {kind === 'edit' && chosenId === 'angles' && (
          <div className="ai-maker-picks" aria-label="Angles">
            {ANGLES.map((a) => (
              <button key={a} type="button" className="ai-maker-chip" onClick={() => setPrompt(a)}>
                {a.split(',')[0]}
              </button>
            ))}
          </div>
        )}
        </Step>
        {(kind !== 'edit' || !o5) && (
        <Step on={o5} n="04" id="o5-make-shape" title={kind === 'video' ? 'Shape, length and start' : 'Shape'}>
        {kind !== 'edit' && (
          <div className="ai-create-options">
            <Segmented label="Shape" value={size[kind]} onChange={(v) => setSize((s) => ({ ...s, [kind]: v }))} options={SIZES[kind]} />
            {kind === 'video' && <Segmented label="Length" value={seconds} onChange={setSeconds} options={LENGTHS} />}
          </div>
        )}
        {kind === 'video' && (
          <div className="ai-create-photo">
            {startImage ? (
              <>
                <img src={startImage} alt="Starting photo" />
                <span className="ai-muted">The video starts from this photo.</span>
                <IconButton
                  icon="close"
                  label="Remove the starting photo"
                  onClick={() => {
                    setStartImage(null);
                    setStartItem(null);
                  }}
                />
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
        </Step>
        )}
        <Step on={o5} n={kind === 'edit' ? '04' : '05'} id="o5-make-go" title="Make it">
        <button type="submit" className="btn primary ai-make" disabled={!canMake}>
          <Icon name={kind === 'video' ? 'film' : kind === 'edit' ? 'pencil' : 'image'} size={18} /> {submitting ? 'Starting…' : verb}
        </button>
        <p className="ai-muted" role="status">
          {status}
        </p>
        </Step>
      </form>

      {studio && typeof studio.censor === 'boolean' && (
        <section className="ai-censor" aria-labelledby="ai-censor-title">
          <div className="ai-censor-text">
            <p className="o5-kicker" id="ai-censor-title">Censor</p>
            <p className="ai-muted">
              {studio.censor
                ? 'On: nothing sexual or undressed is made, by any maker, until you turn it off.'
                : 'Off: the makers are uncensored. Turn it on to block anything sexual or undressed. Sexual content involving minors is always blocked.'}
            </p>
          </div>
          <Toggle checked={studio.censor} label="Censor: block anything sexual or undressed" onChange={(on) => void ai.setCensor(on).then(setStudio, (err: Error) => setStudioError(err.message))} />
        </section>
      )}

      {o5 && jobs.length > 0 && (
        <h3 className="o5-chapter-title" id="o5-making">
          In the making
        </h3>
      )}
      {jobs.length > 0 && (
        <ul className="ai-jobs" aria-label="In progress">
          {jobs.map((j) => (
            <li key={j.id} className={`ai-job ai-job-${j.status}`}>
              <span className="ai-job-art" data-live={active(j)} aria-hidden>
                <Icon name={j.kind === 'image' ? 'image' : 'film'} size={18} />
              </span>
              <div className="ai-job-text">
                <span className="ai-list-title">{j.prompt}</span>
                {j.status === 'error' ? (
                  <span className="ai-error">{j.error}</span>
                ) : (
                  <div className="ai-bar" aria-label={`${j.progress}%`}>
                    <span style={{ width: `${Math.max(3, j.progress)}%` }} />
                  </div>
                )}
                {jobLine(j) && (
                  <span className="ai-job-line" data-slow={j.slow || undefined}>
                    {jobLine(j)}
                  </span>
                )}
                {(j.notes?.length ?? 0) > 0 && <span className="ai-job-notes">{j.notes!.slice(-2).join(' ')}</span>}
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

      {o5 && items.length > 0 && (
        <header className="o5-gallery-head">
          <p className="o5-kicker">The gallery</p>
          <h3 className="o5-chapter-title">Your creations</h3>
        </header>
      )}
      {items.length === 0 ? (
        <EmptyState icon="image" title="Your creations">
          Pictures and videos you make are kept on your AI machine and show up here on all your devices.
        </EmptyState>
      ) : (
        <ul className="ai-gallery" aria-label="Your creations">
          {items.map((it, n) => (
            <li key={it.id} style={{ '--i': Math.min(n, 14) } as React.CSSProperties}>
              <button type="button" className="ai-tile" onClick={(e) => {
                viewFrom.current = (e.currentTarget.querySelector('img, video') ?? e.currentTarget).getBoundingClientRect();
                setViewing(it);
              }} aria-label={`${it.kind === 'video' ? 'Video' : 'Image'}: ${it.prompt}`}>
                {it.kind === 'image' ? (
                  <DevelopImg src={it.url} alt="" loading="lazy" />
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
        <Sheet title={viewing.kind === 'image' ? 'Image' : 'Video'} origin={viewFrom.current} onClose={() => setViewing(null)}>
          <div className="ai-viewer">
            {viewing.kind === 'image' ? (
              <DevelopImg src={viewing.url} alt={viewing.prompt} />
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
                  setPrompt(viewing.prompt === 'Sharpened 4×' ? '' : viewing.prompt);
                  setViewing(null);
                }}
              >
                <Icon name="refresh" size={16} /> Use prompt
              </button>
              {viewing.kind === 'image' && (
                <>
                  <button type="button" className="btn" onClick={() => animate(viewing)}>
                    <Icon name="film" size={16} /> Make it move
                  </button>
                  <button type="button" className="btn" onClick={() => editItem(viewing)}>
                    <Icon name="pencil" size={16} /> Edit
                  </button>
                  {makers?.some((m) => m.id === 'sharpen' && m.installed) && (
                    <button type="button" className="btn" onClick={() => editItem(viewing, 'sharpen')}>
                      <Icon name="sparkle" size={16} /> Sharpen
                    </button>
                  )}
                </>
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

/**
 * A picture that "develops": it starts blurred and colourless and sharpens as it loads (see
 * motion.css). The final state is always a normal image, so nothing depends on the effect.
 */
function DevelopImg(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth > 0) setLoaded(true);
  }, []);
  return <img {...props} ref={ref} className="ai-dev" data-loaded={loaded} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} />;
}
