import { useCallback, useEffect, useRef, useState } from 'react';
import { Step, nextStep } from '../../shell/o5/Step';
import { useShell } from '../../state/shell';
import { Icon } from '../../ui/Icon';
import { ConfirmSheet, EmptyState, IconButton, Segmented, Sheet, Toggle } from '../../ui/components';
import { Censor } from '../../ui/Censor';
import { isNsfw } from '../../ui/nsfw';
import { connectMarks, nsfwFor, rememberItems, setMark, useNsfwFlags } from '../../ui/nsfwFlags';
import { AiError, type LocalAi, type StudioItem, type StudioJob, type StudioKind, type StudioMakerInfo, type StudioState, type VideoTask } from '../../services/ai/LocalAi';
import { MAKER_CATALOG, rememberMakers, rememberedMakers } from './makerCatalog';
import { AudioSource, VideoSource, type AudioPick, type VideoPick } from './VideoInputs';
import { TextArea } from '../../ui/TextArea';

/** vedit: change, erase or sharpen a video you have. */
type Mode = StudioKind | 'edit' | 'vedit';
const DEFAULT_PICK: Record<Mode, string> = { image: 'qwen', video: 'ltx', edit: 'edit', vedit: 'vace' };
const TASKS: Record<VideoTask, { label: string; placeholder: string }> = {
  replace: { label: 'Replace', placeholder: 'What goes there instead? e.g. a white horse' },
  restyle: { label: 'Restyle', placeholder: 'The new look, e.g. a watercolour painting' },
  extend: { label: 'Extend', placeholder: 'What happens next?' },
  motion: { label: 'Move a photo', placeholder: 'Describe the scene, e.g. she dances in a sunlit room' },
};
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
  const censor = useShell((s) => s.settings.censor !== false);
  const updateSettings = useShell((s) => s.updateSettings);
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
  /** Video makers: the video to work on, a voice or song, the end photo, and what to do. */
  const [video, setVideo] = useState<VideoPick | null>(null);
  const [audio, setAudio] = useState<AudioPick | null>(null);
  const [endImage, setEndImage] = useState<string | null>(null);
  const [task, setTask] = useState<VideoTask>('replace');
  const [target, setTarget] = useState('');
  const [change, setChange] = useState<'little' | 'lot'>('lot');
  /** Wan VACE: a picture of the new thing (replace) or of who should move (motion). */
  const [refPhoto, setRefPhoto] = useState<{ src: string; item?: string } | null>(null);
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
  const endInput = useRef<HTMLInputElement>(null);
  const refInput = useRef<HTMLInputElement>(null);

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

  useNsfwFlags();
  useEffect(() => connectMarks(ai), [ai]);
  const loadItems = useCallback(() => {
    ai.studioItems()
      .then((list) => {
        rememberItems(list);
        setItems(list);
      })
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
  const kindsFor = (m: Mode): StudioMakerInfo['kind'][] => (m === 'edit' ? ['edit', 'upscale'] : m === 'vedit' ? ['videoedit'] : [m]);
  const choices = known.filter((m) => kindsFor(kind).includes(m.kind) && (m.installed || m.wanted));
  const chosen = known.find((m) => m.id === pick[kind]) ?? known.find((m) => m.id === DEFAULT_PICK[kind]) ?? null;
  const chosenId = chosen?.id ?? DEFAULT_PICK[kind];
  const styles = known.filter((m) => m.kind === 'style' && m.for === chosenId && m.installed);
  const sharpen = chosen?.kind === 'upscale';
  const needImages = kind === 'edit' ? (chosen?.twoImages ? 2 : 1) : 0;
  // What the chosen maker works from (video makers): the machine says; older ones don't.
  const needs = chosen?.needs ?? [];
  const accepts = chosen?.accepts ?? [];
  const tasks = kind === 'vedit' ? (chosen?.tasks ?? []) : [];
  const vTask: VideoTask | 'erase' | null = kind !== 'vedit' ? null : tasks.length ? (tasks.includes(task) ? task : tasks[0]) : needs.includes('target') ? 'erase' : null;
  const sharpenVideo = kind === 'vedit' && !tasks.length && !needs.includes('target');
  const talking = kind === 'video' && needs.includes('audio');
  const takesVideo = kind === 'vedit' || (kind === 'video' && accepts.includes('video'));
  const restyling = kind === 'video' && takesVideo && Boolean(video);
  const wantsTarget = vTask === 'replace' || vTask === 'erase';
  const wantsRef = vTask === 'replace' || vTask === 'motion';
  const noWords = sharpenVideo || vTask === 'erase';
  const promptOk = sharpen || noWords || talking || Boolean(prompt.trim());
  const inputsOk =
    kind === 'vedit'
      ? Boolean(video) && (!wantsTarget || Boolean(target.trim())) && (vTask !== 'motion' || Boolean(refPhoto))
      : kind === 'video' && talking
        ? Boolean(startImage) && Boolean(audio)
        : editImages.length >= needImages;
  const builtInMaker = studio?.[kind === 'video' || kind === 'vedit' ? 'video' : 'image'];
  const makerReady = machineOn && Boolean(studio?.running) && (chosen ? chosen.installed : Boolean(builtInMaker?.ready));
  const canMake = makerReady && promptOk && inputsOk && !submitting;

  const make = async () => {
    if (!canMake) return;
    setSubmitting(true);
    try {
      const fromGallery = kind === 'edit' ? editImages.find((p, i) => i === 0 && p.item)?.item : undefined;
      const videoRef = video ? (video.item ? { videoItem: video.item } : { videoUpload: video.upload }) : {};
      const job = await ai.createStudioJob({
        kind: kind === 'video' || kind === 'vedit' ? 'video' : 'image',
        maker: chosenId,
        prompt: noWords ? '' : prompt.trim(),
        ...(kind === 'image' || kind === 'video' ? { size: size[kind] } : {}),
        ...(style && styles.some((s) => s.id === style) ? { style } : {}),
        ...(kind === 'video' && restyling ? { ...videoRef, change } : {}),
        ...(kind === 'video' && !restyling
          ? {
              seconds: Number(seconds),
              ...(startItem ? { fromItem: startItem } : { image: startImage ?? undefined }),
              ...(endImage && accepts.includes('endPhoto') ? { endImage } : {}),
              ...(talking && audio ? { audioUpload: audio.upload } : {}),
            }
          : {}),
        ...(kind === 'vedit'
          ? {
              ...videoRef,
              ...(tasks.length && vTask && vTask !== 'erase' ? { task: vTask } : {}),
              ...(wantsTarget ? { target: target.trim() } : {}),
              ...(wantsRef && refPhoto ? (refPhoto.item ? { fromItem: refPhoto.item } : { image: refPhoto.src }) : {}),
            }
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

  /** A gallery video into Video edit, with the maker that does what was tapped. */
  const workOnVideo = (item: StudioItem, maker: string, hint: string) => {
    setKind('vedit');
    setPick('vedit', maker);
    setVideo({ src: item.url, item: item.id, nsfw: nsfwFor(item.id, item.nsfw === true || isNsfw(item.prompt)), label: item.prompt });
    setPrompt('');
    setTarget('');
    setViewing(null);
    toast(hint, 'info');
  };
  const installed = (id: string) => known.some((m) => m.id === id && m.installed);

  const pickRef = async (file: File | undefined) => {
    if (!file) return;
    try {
      setRefPhoto({ src: await toDataUrl(file) });
    } catch {
      toast('That picture could not be read.', 'error');
    }
  };
  const pickEnd = async (file: File | undefined) => {
    if (!file) return;
    try {
      setEndImage(await toDataUrl(file));
    } catch {
      toast('That picture could not be read.', 'error');
    }
  };

  const status = (() => {
    if (!machineOn) return 'Turn on your AI machine to make images and videos.';
    if (studioError) return studioError;
    if (!studio) return 'Checking the image and video maker…';
    if (chosen && !chosen.installed) return chosen.wanted ? `${chosen.name} is downloading: ${chosen.percent}%.` : `${chosen.name} is not installed. Open Makers to add it.`;
    if (!chosen && !builtInMaker?.downloaded) return `The maker is downloading (first start only): ${builtInMaker?.percent ?? 0}%.`;
    if (!studio.running) return studio.setup.startsWith('error') ? `The maker had a problem: ${studio.setup.slice(6).trim()}` : 'The image and video maker is starting…';
    if (kind === 'edit') return needImages === 2 && editImages.length < 2 ? 'Add the person first, then the outfit.' : sharpen ? 'Makes the picture four times larger and crisper.' : 'Edits take under a minute.';
    if (kind === 'vedit') {
      if (!video) return 'Add the video to work on.';
      if (wantsTarget && !target.trim()) return vTask === 'erase' ? 'Say what to erase.' : 'Say what to replace.';
      if (vTask === 'motion' && !refPhoto) return 'Add a photo of who should move.';
      return sharpenVideo ? 'Makes the video twice as large and crisper: a few minutes.' : 'Works on the first 5 seconds. Video edits take a few minutes.';
    }
    if (talking) return !startImage ? 'Add a photo of the person.' : !audio ? 'Add a voice recording or a song.' : 'Talking videos take a few minutes.';
    if (restyling) return 'Keeps the motion and the sound of your video (up to 10 s).';
    return kind === 'image' ? 'Images take under a minute.' : 'Videos with sound take a few minutes.';
  })();

  const verb =
    kind === 'image' ? 'Make image' : kind === 'video' ? 'Make video' : kind === 'vedit' ? (sharpenVideo ? 'Sharpen video' : vTask === 'erase' ? 'Erase it' : 'Edit video') : sharpen ? 'Sharpen' : 'Edit';

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
                  ['vedit', 'Edit a video', 'Change, erase or sharpen one you have'],
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
                { value: 'vedit', label: 'Video edit' },
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
        <Step on={o5} n="03" id="o5-make-describe" title={kind === 'edit' || kind === 'vedit' ? 'Show it, then say the change' : 'Describe it'}>
        {kind === 'vedit' && (
          <>
            <VideoSource ai={ai} value={video} onChange={setVideo} onError={(m) => toast(m, 'error')} />
            {tasks.length > 0 && (
              <div className="ai-maker-picks" role="radiogroup" aria-label="What to do">
                {tasks.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={vTask === t} className="ai-maker-chip" onClick={() => setTask(t)}>
                    {TASKS[t].label}
                  </button>
                ))}
              </div>
            )}
            {wantsTarget && (
              <input
                className="input ai-target"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                aria-label={vTask === 'erase' ? 'What to erase' : 'What to replace'}
                placeholder={vTask === 'erase' ? 'What to erase, e.g. the man in the red shirt' : 'What to replace, e.g. the red car'}
                maxLength={200}
                enterKeyHint="done"
              />
            )}
            {wantsRef && (
              <div className="ai-create-photo">
                {refPhoto ? (
                  <>
                    <img src={refPhoto.src} alt={vTask === 'motion' ? 'Who should move' : 'The new thing'} />
                    <span className="ai-muted">{vTask === 'motion' ? 'This person moves like the video.' : 'It looks like this picture.'}</span>
                    <IconButton icon="close" label="Remove the picture" onClick={() => setRefPhoto(null)} />
                  </>
                ) : (
                  <button type="button" className="btn ghost" onClick={() => refInput.current?.click()}>
                    <Icon name="image" size={18} /> {vTask === 'motion' ? 'Add a photo of who should move' : 'Add a picture of it (optional)'}
                  </button>
                )}
                <input
                  ref={refInput}
                  type="file"
                  accept="image/*"
                  hidden
                  aria-label="Picture for the video edit"
                  onChange={(e) => {
                    void pickRef(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>
            )}
          </>
        )}
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
        {!sharpen && !noWords && (
          <TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            aria-label="Describe it"
            placeholder={
              kind === 'vedit' && vTask && vTask in TASKS
                ? TASKS[vTask as VideoTask].placeholder
                : talking
                  ? 'Describe the scene (optional), e.g. she sings softly on a stage'
                  : restyling
                    ? 'The new look, e.g. as a claymation'
                    : kind === 'edit'
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
        {((kind !== 'edit' && kind !== 'vedit') || !o5) && (
        <Step on={o5} n="04" id="o5-make-shape" title={kind === 'video' ? (talking ? 'Shape, photo and sound' : 'Shape, length and start') : 'Shape'}>
        {(kind === 'image' || kind === 'video') && !restyling && (
          <div className="ai-create-options">
            <Segmented label="Shape" value={size[kind]} onChange={(v) => setSize((s) => ({ ...s, [kind]: v }))} options={SIZES[kind]} />
            {kind === 'video' && !talking && <Segmented label="Length" value={seconds} onChange={setSeconds} options={LENGTHS} />}
          </div>
        )}
        {restyling && (
          <div className="ai-create-options">
            <Segmented
              label="How much to change"
              value={change}
              onChange={setChange}
              options={[
                { value: 'little', label: 'A little' },
                { value: 'lot', label: 'A lot' },
              ]}
            />
          </div>
        )}
        {kind === 'video' && takesVideo && !startImage && !endImage && (
          <VideoSource ai={ai} value={video} onChange={setVideo} onError={(m) => toast(m, 'error')} hint="Or restyle a video you have: it keeps the motion and the sound." />
        )}
        {talking && <AudioSource ai={ai} value={audio} onChange={setAudio} onError={(m) => toast(m, 'error')} />}
        {kind === 'video' && accepts.includes('endPhoto') && !restyling && (
          <div className="ai-create-photo">
            {endImage ? (
              <>
                <img src={endImage} alt="Ending photo" />
                <span className="ai-muted">The video ends on this photo.</span>
                <IconButton icon="close" label="Remove the ending photo" onClick={() => setEndImage(null)} />
              </>
            ) : (
              <button type="button" className="btn ghost" onClick={() => endInput.current?.click()}>
                <Icon name="image" size={18} /> End on a photo
              </button>
            )}
            <input
              ref={endInput}
              type="file"
              accept="image/*"
              hidden
              aria-label="Ending photo file"
              onChange={(e) => {
                void pickEnd(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        )}
        {kind === 'video' && !restyling && (
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
                <Icon name="image" size={18} /> {talking ? 'Add a photo of the person' : 'Start from a photo'}
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
        <Step on={o5} n={kind === 'edit' || kind === 'vedit' ? '04' : '05'} id="o5-make-go" title="Make it">
        <button type="submit" className="btn primary ai-make" disabled={!canMake}>
          <Icon name={kind === 'video' || kind === 'vedit' ? 'film' : kind === 'edit' ? 'pencil' : 'image'} size={18} /> {submitting ? 'Starting…' : verb}
        </button>
        <p className="ai-muted" role="status">
          {status}
        </p>
        </Step>
      </form>

      <section className="ai-censor" aria-labelledby="ai-censor-title">
        <div className="ai-censor-text">
          <p className="o5-kicker" id="ai-censor-title">NSFW blur</p>
          <p className="ai-muted">{censor ? 'On: NSFW pictures and videos, and their words, are blurred everywhere in Orbit. Keep your finger on one to see it; a video plays while you hold it and pauses when you let go. One that was missed: hold it for a moment and it blurs. One blurred by mistake: open it and turn off "Blur this one".' : 'Off: NSFW pictures and videos show as they are.'}</p>
        </div>
        <Toggle checked={censor} label="Blur NSFW pictures and videos" onChange={(on) => updateSettings({ censor: on })} />
      </section>

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
              <Censor as="div" markId={it.id} nsfw={it.nsfw === true || isNsfw(it.prompt)}>
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
              </Censor>
            </li>
          ))}
        </ul>
      )}

      {viewing && (
        <Sheet title={viewing.kind === 'image' ? 'Image' : 'Video'} origin={viewFrom.current} onClose={() => setViewing(null)}>
          <div className="ai-viewer">
            <Censor as="div" className="ai-viewer-media" markId={viewing.id} nsfw={viewing.nsfw === true || isNsfw(viewing.prompt)}>
              {viewing.kind === 'image' ? (
                <DevelopImg src={viewing.url} alt={viewing.prompt} />
              ) : (
                <video src={viewing.url} controls playsInline autoPlay />
              )}
            </Censor>
            <Censor as="div" text markId={viewing.id} nsfw={viewing.nsfw === true || isNsfw(viewing.prompt)}>
              <p className="ai-viewer-prompt">{viewing.prompt}</p>
            </Censor>
            {censor && (
              <div className="ai-viewer-blur">
                <span className="ai-muted">Blur this one (NSFW)</span>
                <Toggle
                  checked={nsfwFor(viewing.id, viewing.nsfw === true || isNsfw(viewing.prompt))}
                  label="Blur this one (NSFW)"
                  onChange={(on) => setMark(viewing.id, on)}
                />
              </div>
            )}
            <div className="ai-viewer-actions">
              <a className="btn" href={withParam(viewing.url, 'download=1')} download>
                <Icon name="download" size={16} /> Save
              </a>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setKind(viewing.kind);
                  setVideo(null);
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
              {viewing.kind === 'video' && (
                <>
                  {installed('vace') && (
                    <button type="button" className="btn" onClick={() => workOnVideo(viewing, 'vace', 'Pick what to do, then describe the change.')}>
                      <Icon name="pencil" size={16} /> Edit this video
                    </button>
                  )}
                  {installed('video-erase') && (
                    <button type="button" className="btn" onClick={() => workOnVideo(viewing, 'video-erase', 'Say what to erase, then tap Erase it.')}>
                      <Icon name="close" size={16} /> Erase from video
                    </button>
                  )}
                  {installed('video-sharpen') && (
                    <button type="button" className="btn" onClick={() => workOnVideo(viewing, 'video-sharpen', 'Tap Sharpen video to make it twice as large and crisper.')}>
                      <Icon name="sparkle" size={16} /> Sharpen video
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
