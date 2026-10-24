import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useShell } from '../../state/shell';
import { Icon } from '../../ui/Icon';
import { ConfirmSheet, EmptyState, IconButton, Segmented } from '../../ui/components';
import { isNsfw } from '../../ui/nsfw';
import { connectMarks, nsfwFor, rememberItems, useNsfwFlags } from '../../ui/nsfwFlags';
import { GalleryGrid, GalleryViewer, useGalleryStepper, type GalleryMedia } from './Gallery';
import { AiError, type LocalAi, type StudioItem, type StudioJob, type StudioKind, type StudioMakerInfo, type StudioState, type VideoTask } from '../../services/ai/LocalAi';
import { PENDING_TEXT, offlineMakers, progressText, progressWhy, rememberMakers, withCatalog } from './makerCatalog';
import { AudioSource, VideoSource, type AudioPick, type VideoPick } from './VideoInputs';
import { TextArea } from '../../ui/TextArea';
import { useMotionLevel } from '../../motion/MotionProvider';
import { cue } from '../../motion/feedback';
import { orbApprove, useOrbAssist, type AssistOption, type OrbAssist } from '../../shell/orb/assist';
import { StepDeck, type DeckStep } from '../make/StepDeck';
import { ChooseButton, FillButton, TalkButton } from '../make/StepTools';
import type { IdeaBox } from '../make/ideas';
import { CharacterPick } from '../make/CharacterPick';
import { useCharacters } from '../make/useCharacters';
import { thumbOf } from '../../services/ai/Characters';
import { JobQueue } from '../make/JobQueue';
import { GalleryPick } from '../make/GalleryPick';

/** vedit: change, erase or sharpen a video you have. (Drawing lives in its own app: Live Draw.) */
type Mode = StudioKind | 'edit' | 'vedit';
const DEFAULT_PICK: Record<Mode, string> = { image: 'qwen', video: 'ltx', edit: 'edit', vedit: 'vace' };
const TASKS: Record<VideoTask, { label: string; placeholder: string }> = {
  replace: { label: 'Replace', placeholder: 'What goes there instead? e.g. a white horse' },
  restyle: { label: 'Restyle', placeholder: 'The new look, e.g. a watercolour painting' },
  extend: { label: 'Extend', placeholder: 'What happens next?' },
  motion: { label: 'Move a photo', placeholder: 'Describe the scene, e.g. she dances in a sunlit room' },
};
const ANGLES = ['front-right quarter view, eye-level shot', 'right side view, eye-level shot', 'back view, eye-level shot', 'left side view, eye-level shot', 'front view, high-angle shot', 'front view, eye-level shot close-up'];

/** The walk-through: one step per screen. Steps that don't apply are left out. */
type StepId = 'what' | 'maker' | 'video' | 'describe' | 'extras' | 'check';
const STEP_NAME: Record<StepId, string> = { what: 'What', maker: 'Maker & style', video: 'The video', describe: 'Describe it', extras: 'Extras', check: 'Check & make' };
/** Swap a person: the video gets its own step, and the others are named after what they hold. */
const SWAP_STEP_NAME: Partial<Record<StepId, string>> = { describe: 'Who to replace', extras: 'The new person' };
/** A video maker that puts someone from a photo in place of a person named in words. */
const isSwap = (m: StudioMakerInfo | null | undefined) => m?.kind === 'videoedit' && Boolean(m.needs?.includes('target')) && Boolean(m.needs?.includes('photo'));

const KINDS: { id: Mode; label: string; hint: string; icon: 'image' | 'film' | 'pencil' | 'brush' }[] = [
  { id: 'image', label: 'A picture', hint: 'From a description', icon: 'image' },
  { id: 'video', label: 'A video', hint: 'With sound, from words or a photo', icon: 'film' },
  { id: 'edit', label: 'An edit', hint: 'Change a photo with words', icon: 'pencil' },
  { id: 'vedit', label: 'Edit a video', hint: 'Change, erase or sharpen one you have', icon: 'film' },
];
const KIND_NOUN: Record<Mode, string> = { image: 'picture', video: 'video', edit: 'picture edit', vedit: 'video edit' };

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

/** A maker that works without words: sharpening a picture, or a video maker with nothing to describe. */
function wordless(kind: Mode, maker: StudioMakerInfo | null) {
  if (kind === 'edit') return maker?.kind === 'upscale';
  if (kind === 'vedit') return !(maker?.tasks?.length) && !(maker?.needs ?? []).includes('target');
  return false;
}

/** Replay the candy "pop" on a picked element. */
function pop(el: HTMLElement | null) {
  if (!el) return;
  el.removeAttribute('data-pop');
  void el.offsetWidth;
  el.setAttribute('data-pop', '');
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Make: images and videos (with sound) on the AI machine, as a walk-through, one step per screen:
 * what, the maker, the words, the extras, then a check and Make. Results stay on the machine's
 * storage and show in the gallery (behind its own button) on every device.
 */
export function CreateView({
  ai,
  machineOn,
  isActive,
  onOpenMakers,
  reloadKey = 0,
  kicker,
  actions,
  notice,
  onCloud,
  covered = false,
  useCharacter = null,
  onCharacters,
}: {
  ai: LocalAi;
  machineOn: boolean;
  isActive: boolean;
  /** Changes when something was added to the gallery from outside (cloud creations moved in). */
  reloadKey?: number;
  /** Opens the Store at its picture and video makers. */
  onOpenMakers?: () => void;
  /** The small line over "Make" (how the AI machine is). */
  kicker?: ReactNode;
  /** More buttons at the top, beside Gallery. */
  actions?: ReactNode;
  /** A message under the top bar (the machine is off). */
  notice?: ReactNode;
  /** The machine is off: make this in the cloud instead. */
  onCloud?: (seed: { prompt: string; kind: 'image' | 'video' }) => void;
  /** Another screen (the cloud, Characters) is over the steps. */
  covered?: boolean;
  /** A character picked in Characters ("Use in Make"): attach it and go to the words. */
  useCharacter?: { id: string; n: number } | null;
  /** Opens Characters (to make the first one). */
  onCharacters?: () => void;
}) {
  const toast = useShell((s) => s.toast);
  const launch = useShell((s) => s.launch);
  const level = useMotionLevel();
  const [step, setStep] = useState<StepId>('what');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [pane, setPane] = useState<HTMLElement | null>(null);
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
  /** Video editing: a picture of the new thing (replace) or of who should move (motion). */
  const [refPhoto, setRefPhoto] = useState<{ src: string; item?: string } | null>(null);
  /** Swap a person: a close-up of the new person's face (optional; it keeps the face right). */
  const [facePhoto, setFacePhoto] = useState<string | null>(null);
  /** A saved character added to this one (Add a character / the new person in Swap a person). */
  const [character, setCharacter] = useState<string | null>(null);
  /** Which photo slot has its "Use a character" chooser open. */
  const [charSlot, setCharSlot] = useState<string | null>(null);
  // Which photo or video slot shows "From your gallery" (one at a time).
  const [galSlot, setGalSlot] = useState<string | null>(null);
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [makers, setMakersState] = useState<StudioMakerInfo[] | null>(null);
  const [, setMakersError] = useState<string | null>(null);
  // Until the machine answers (or while it is off): the makers it last had, plus every newer one
  // in the catalog. Once it answers: its list, plus what it doesn't know yet (arrives on restart).
  const [offline] = useState(offlineMakers);
  const known = useMemo(() => (makers ? withCatalog(makers) : offline), [makers, offline]);
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
  const [launched, setLaunched] = useState(0);
  // The tapped tile, so the viewer grows out of it and the picture appears to fly up.
  const viewFrom = useRef<DOMRect | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StudioItem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const editInput = useRef<HTMLInputElement>(null);
  const endInput = useRef<HTMLInputElement>(null);
  const refInput = useRef<HTMLInputElement>(null);
  const personInput = useRef<HTMLInputElement>(null);
  const faceInput = useRef<HTMLInputElement>(null);
  const secondRow = useRef<HTMLDivElement>(null);
  const picking = useRef(false);

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
  const chars = useCharacters(ai, { machineOn, active: isActive && machineOn, tick: reloadKey });
  // Characters may have changed while it was over the steps.
  useEffect(() => {
    if (!covered && isActive && machineOn) void chars.reload();
  }, [covered]); // eslint-disable-line react-hooks/exhaustive-deps
  // The viewer steps through the gallery in the order the grid shows it.
  const stepper = useGalleryStepper(items.map(asMedia), viewing?.id);
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
        return [...known.values()].filter((j) => active(j) || j.status === 'error').slice(-30);
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

  useEffect(() => {
    if (reloadKey && machineOn) loadItems();
  }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow running jobs closely.
  const running = jobs.filter(active);
  useEffect(() => {
    if (!running.length) return;
    const t = setInterval(async () => {
      const updated = await Promise.all(running.map((j) => ai.studioJob(j.id).catch(() => j)));
      setJobs((prev) => prev.map((j) => updated.find((x) => x.id === j.id) ?? j).filter((j) => j.status !== 'done' && j.status !== 'stopped'));
      if (updated.some((u) => u.status === 'done')) {
        loadItems();
        cue('done');
      }
    }, 2000);
    return () => clearInterval(t);
  }, [running.map((j) => j.id).join(','), ai, loadItems]); // eslint-disable-line react-hooks/exhaustive-deps

  // Makers for this mode: the installed ones, plus the one picked (even while it downloads).
  const kindsFor = (m: Mode): StudioMakerInfo['kind'][] => (m === 'edit' ? ['edit', 'upscale'] : m === 'vedit' ? ['videoedit'] : [m]);
  // Video editing has no built-in maker: every one shows, so you can see what there is to add.
  const choices = known.filter((m) => kindsFor(kind).includes(m.kind) && (m.installed || m.wanted || kind === 'vedit'));
  const chosen = known.find((m) => m.id === pick[kind]) ?? known.find((m) => m.id === DEFAULT_PICK[kind]) ?? null;
  const chosenId = chosen?.id ?? DEFAULT_PICK[kind];
  const stylesFor = (id: string) => known.filter((m) => m.kind === 'style' && m.for === id && m.installed);
  const styles = stylesFor(chosenId);
  const sharpen = chosen?.kind === 'upscale';
  const needImages = kind === 'edit' ? (chosen?.twoImages ? 2 : 1) : 0;
  // What the chosen maker works from (video makers): the machine says; older ones don't.
  const needs = chosen?.needs ?? [];
  const accepts = chosen?.accepts ?? [];
  const tasks = kind === 'vedit' ? (chosen?.tasks ?? []) : [];
  // Swap a person: a video, words saying who to replace, the new person's photo (and a face close-up).
  const swapping = kind === 'vedit' && isSwap(chosen);
  const vTask: VideoTask | 'erase' | 'swap' | null =
    kind !== 'vedit' ? null : tasks.length ? (tasks.includes(task) ? task : tasks[0]) : swapping ? 'swap' : needs.includes('target') ? 'erase' : null;
  const sharpenVideo = kind === 'vedit' && !tasks.length && !needs.includes('target');
  const talking = kind === 'video' && needs.includes('audio');
  const takesVideo = kind === 'vedit' || (kind === 'video' && accepts.includes('video'));
  const restyling = kind === 'video' && takesVideo && Boolean(video);
  const wantsTarget = vTask === 'replace' || vTask === 'erase' || vTask === 'swap';
  const wantsRef = vTask === 'replace' || vTask === 'motion';
  const noWords = sharpenVideo || vTask === 'erase' || vTask === 'swap';
  const promptOk = sharpen || noWords || talking || Boolean(prompt.trim());
  // A saved character: in the words of a picture, a video or an edit, and as the new person in Swap a person.
  const charApplies = swapping || (kind === 'vedit' && vTask === 'motion') || ((kind === 'image' || kind === 'video' || kind === 'edit') && !sharpen && !restyling);
  const chosenChar = chars.ready.find((c) => c.id === character) ?? null;
  const charForJob = chosenChar && charApplies ? chosenChar : null;
  // An edit works on your picture; a character stands in when there is none (outfit swap: as the person).
  const charAsPicture = Boolean(charForJob) && kind === 'edit' && (Boolean(chosen?.twoImages) || editImages.length === 0);
  const inputsOk =
    kind === 'vedit'
      ? Boolean(video) && (!wantsTarget || Boolean(target.trim())) && (vTask !== 'motion' || Boolean(refPhoto) || Boolean(charForJob)) && (!swapping || Boolean(refPhoto) || Boolean(charForJob))
      : kind === 'video' && talking
        ? (Boolean(startImage) || Boolean(charForJob)) && Boolean(audio)
        : editImages.length + (charAsPicture ? 1 : 0) >= needImages;
  const builtInMaker = studio?.[kind === 'video' || kind === 'vedit' ? 'video' : 'image'];
  const makerReady = machineOn && Boolean(studio?.running) && (chosen ? chosen.installed : Boolean(builtInMaker?.ready));
  const canMake = makerReady && promptOk && inputsOk && !submitting;

  /* ---------------------------------------------------------------- the steps that apply */
  const hasDescribe = !wordless(kind, chosen);
  const stepIds: StepId[] = ['what', 'maker', ...(swapping ? (['video'] as const) : []), ...(hasDescribe ? (['describe'] as const) : []), 'extras', 'check'];
  const stepName = (id: StepId) => (swapping && SWAP_STEP_NAME[id]) || STEP_NAME[id];
  // A step that no longer applies (the maker changed to one without words): the next one.
  useEffect(() => {
    if (!stepIds.includes(step)) setStep('extras');
  }, [stepIds.join(','), step]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Bumped by every move you make yourself, so a pick's pending move doesn't override it. */
  const moves = useRef(0);
  // "Use in Make" in Characters: the character is attached and the words are next.
  useEffect(() => {
    if (!useCharacter) return;
    setCharacter(useCharacter.id);
    if (kind === 'vedit' && !swapping) setKind('image');
    moves.current++;
    setStep(swapping ? 'extras' : 'describe');
  }, [useCharacter?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // A character that is gone (deleted) is taken off.
  useEffect(() => {
    if (character && chars.library?.source === 'machine' && !chars.ready.some((c) => c.id === character)) setCharacter(null);
  }, [character, chars.library, chars.ready]);
  const go = useCallback((id: string) => {
    moves.current++;
    setStep(id as StepId);
    cue('tap');
  }, []);

  /** Picked: the candy, the orb's nod, then the next step slides in. */
  const choose = (el: HTMLElement | null, apply: () => void, nextId: StepId | null) => {
    apply();
    pop(el);
    cue('pop');
    if (!nextId || picking.current) return;
    picking.current = true;
    const at = moves.current;
    void orbApprove(el)
      .catch(() => {})
      .then(() => wait(level === 'full' ? 260 : level === 'lite' ? 120 : 0))
      .then(() => {
        picking.current = false;
        if (moves.current === at) setStep(nextId);
      });
  };

  const chooseKind = (v: Mode, el: HTMLElement | null) => choose(el, () => setKind(v), 'maker');
  const chooseMaker = (m: StudioMakerInfo, el: HTMLElement | null) => {
    const second = kind === 'vedit' ? (m.tasks?.length ?? 0) > 0 : stylesFor(m.id).length > 0;
    if (second) {
      // It has looks (or things to do) to pick too: point at them instead of moving on.
      choose(el, () => setPick(kind, m.id), null);
      requestAnimationFrame(() => pop(secondRow.current));
      return;
    }
    // Swap a person starts with the video (whoever is replaced must be in its first frame).
    choose(el, () => setPick(kind, m.id), kind === 'vedit' && isSwap(m) ? 'video' : wordless(kind, m) ? 'extras' : 'describe');
  };

  const make = async () => {
    if (!canMake) return false;
    setSubmitting(true);
    try {
      const fromGallery = kind === 'edit' ? editImages.find((p, i) => i === 0 && p.item)?.item : undefined;
      const videoRef = video ? (video.item ? { videoItem: video.item } : { videoUpload: video.upload }) : {};
      const sendChar = Boolean(charForJob) && (kind !== 'edit' || charAsPicture);
      const job = await ai.createStudioJob({
        kind: kind === 'video' || kind === 'vedit' ? 'video' : 'image',
        maker: chosenId,
        prompt: noWords ? '' : prompt.trim(),
        ...(sendChar && charForJob ? { character: charForJob.id } : {}),
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
              ...(tasks.length && vTask && vTask !== 'erase' && vTask !== 'swap' ? { task: vTask } : {}),
              ...(wantsTarget ? { target: target.trim() } : {}),
              // A character is the new person, or a photo is: never both.
              ...((wantsRef || swapping) && refPhoto && !charForJob ? (refPhoto.item ? { fromItem: refPhoto.item } : { image: refPhoto.src }) : {}),
              // The face close-up goes after the photo of the new person.
              ...(swapping && facePhoto && !charForJob ? { images: [facePhoto] } : {}),
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
        cue('error');
        return false;
      }
      setJobs((prev) => [...prev, job]);
      setLaunched((n) => n + 1);
      cue('send');
      return true;
    } catch (err) {
      toast((err as Error).message, 'error');
      cue('error');
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

  const leaveGallery = (to: StepId) => {
    moves.current++;
    setViewing(null);
    setGalleryOpen(false);
    setStep(to);
  };

  const animate = (item: StudioItem) => {
    setStartImage(item.url);
    setStartItem(item.id);
    setKind('video');
    setPrompt('');
    leaveGallery('describe');
    toast('Describe how it should move, then make the video.', 'info');
  };

  const editItem = (item: StudioItem, maker = 'edit') => {
    setKind('edit');
    setPick('edit', maker);
    setEditImages([{ src: item.url, item: item.id }]);
    setPrompt('');
    leaveGallery(maker === 'sharpen' ? 'check' : 'describe');
    if (maker !== 'sharpen') toast('Describe the change, then make the edit.', 'info');
  };

  /** A gallery video into Video edit, with the maker that does what was tapped. */
  const workOnVideo = (item: StudioItem, maker: string, hint: string, to: StepId) => {
    setKind('vedit');
    setPick('vedit', maker);
    setVideo({ src: item.url, item: item.id, nsfw: nsfwFor(item.id, item.nsfw === true || isNsfw(item.prompt)), label: item.prompt });
    setPrompt('');
    setTarget('');
    leaveGallery(to);
    toast(hint, 'info');
  };
  const installed = (id: string) => known.some((m) => m.id === id && m.installed);

  const pickRef = async (file: File | undefined) => {
    if (!file) return;
    try {
      setRefPhoto({ src: await toDataUrl(file) });
      if (swapping) setCharacter(null);
    } catch {
      toast('That picture could not be read.', 'error');
    }
  };
  const pickFace = async (file: File | undefined) => {
    if (!file) return;
    try {
      setFacePhoto(await toDataUrl(file));
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

  /** Anything about the maker itself that stops it now (shown on the maker step too). */
  const makerNote = (() => {
    if (!machineOn) return null;
    if (chosen?.pending) return `${chosen.name}: ${PENDING_TEXT.toLowerCase()}. Turn it off and on again to get it.`;
    if (chosen && !chosen.installed) return chosen.wanted ? progressWhy(chosen, machineOn) : `${chosen.name} is not installed. Open Makers to add it.`;
    return null;
  })();

  const status = (() => {
    if (!machineOn) return 'Turn on your AI machine to make images and videos.';
    if (studioError) return studioError;
    if (!studio) return 'Checking the image and video maker…';
    if (makerNote) return makerNote;
    if (!chosen && !builtInMaker?.downloaded) return `The maker is downloading (first start only): ${builtInMaker?.percent ?? 0}%.`;
    if (!studio.running) return studio.setup.startsWith('error') ? `The maker had a problem: ${studio.setup.slice(6).trim()}` : 'The image and video maker is starting…';
    if (kind === 'edit') return needImages === 2 && editImages.length < 2 ? 'Add the person first, then the outfit.' : sharpen ? 'Makes the picture four times larger and crisper.' : 'Edits take under a minute.';
    if (kind === 'vedit') {
      if (!video) return 'Add the video to work on.';
      if (wantsTarget && !target.trim()) return vTask === 'erase' ? 'Say what to erase.' : vTask === 'swap' ? 'Say who to replace.' : 'Say what to replace.';
      if (vTask === 'motion' && !refPhoto) return 'Add a photo of who should move.';
      if (swapping && !refPhoto && !charForJob) return 'Add a photo of the new person. You can also pick a character.';
      if (swapping) return 'The first 5 seconds, in a few minutes.';
      return sharpenVideo ? 'Makes the video twice as large and crisper: a few minutes.' : 'Works on the first 5 seconds. Video edits take a few minutes.';
    }
    if (talking) return !startImage && !charForJob ? 'Add a photo of the person. You can also add a character.' : !audio ? 'Add a voice recording or a song.' : 'Talking videos take a few minutes.';
    if (restyling) return 'Keeps the motion and the sound of your video (up to 10 s).';
    if (!promptOk) return 'Describe it first.';
    return kind === 'image' ? 'Images take under a minute.' : 'Videos with sound take a few minutes.';
  })();

  const verb =
    kind === 'image'
      ? 'Make image'
      : kind === 'video'
        ? 'Make video'
        : kind === 'vedit'
          ? sharpenVideo
            ? 'Sharpen video'
            : vTask === 'erase'
              ? 'Erase it'
              : vTask === 'swap'
                ? 'Swap the person'
                : 'Edit video'
          : sharpen
            ? 'Sharpen'
            : 'Edit';

  /* ---------------------------------------------------------------- words for the orb and the summary */
  const styleName = styles.find((s) => s.id === style)?.name;
  const shapeWord = kind === 'image' || kind === 'video' ? (SIZES[kind].find((s) => s.value === size[kind])?.label ?? '').toLowerCase() : '';
  const makerName = chosen?.name ?? 'the built-in maker';
  const about1 = `a ${shapeWord ? `${shapeWord} ` : ''}${KIND_NOUN[kind]} with ${makerName}${styleName ? `, style ${styleName}` : ''}${vTask && tasks.length ? `, ${TASKS[vTask as VideoTask]?.label.toLowerCase() ?? vTask}` : ''}`;
  const stepNo = stepIds.indexOf(step) + 1;
  const context = `Step ${stepNo} of ${stepIds.length}, ${stepName(step)}: ${about1}`;
  const promptBox: IdeaBox =
    kind === 'vedit' && vTask && vTask !== 'erase' ? (vTask === 'replace' ? 'replace' : vTask) : talking ? 'talking' : restyling ? 'restyle' : kind === 'edit' ? 'edit' : kind === 'video' ? 'video' : 'picture';
  const placeholder =
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
                : 'Describe the scene, the motion and the sound…';

  const kindOptions: AssistOption[] = KINDS.map((k) => ({ id: k.id, label: k.label }));
  const makerList = choices.length ? choices : chosen ? [chosen] : [];
  const makerOptions: AssistOption[] = makerList.map((m) => ({ id: m.id, label: m.name }));
  const byOption = (id: string) => pane?.querySelector<HTMLElement>(`[data-assist-option="${CSS.escape(id)}"]`) ?? null;

  const assist: OrbAssist | null = useMemo(() => {
    if (!isActive || galleryOpen || covered) return null;
    const targetEl = pane?.querySelector<HTMLElement>('[data-assist-target]') ?? null;
    const opts = (list: AssistOption[]) => list.map((o) => ({ ...o, el: byOption(o.id) }));
    switch (step) {
      case 'what':
        return { id: 'make:what', context, target: targetEl, kind: 'choice', options: opts(kindOptions), selected: kind, choose: (id) => chooseKind(id as Mode, byOption(id)) };
      case 'maker':
        return {
          id: 'make:maker',
          context,
          target: targetEl,
          kind: 'choice',
          options: opts(makerOptions),
          selected: chosenId,
          choose: (id) => {
            const m = makerList.find((x) => x.id === id);
            if (m) chooseMaker(m, byOption(id));
          },
        };
      case 'video':
        return { id: 'make:video', context: `${context}. Add the video; the person to replace should be in its first frame.`, target: targetEl, kind: 'choice', options: [], selected: null };
      case 'describe':
        return noWords
          ? { id: 'make:describe', context: `${context}. ${vTask === 'swap' ? 'Say who in the video to replace.' : 'Say what to erase.'}`, target: targetEl, kind: 'text', value: target, setValue: setTarget }
          : { id: 'make:describe', context, target: targetEl, kind: 'text', value: prompt, setValue: setPrompt };
      case 'extras':
        return kind === 'image' || (kind === 'video' && !restyling)
          ? {
              id: 'make:extras',
              context,
              target: targetEl,
              kind: 'choice',
              options: SIZES[kind].map((s) => ({ id: s.value, label: s.label, el: null })),
              selected: size[kind],
              choose: (id) => setSize((s) => ({ ...s, [kind]: id })),
            }
          : { id: 'make:extras', context, target: targetEl, kind: 'choice', options: [], selected: null };
      case 'check':
        return { id: 'make:check', context: `${context}. ${status}`, target: targetEl, kind: 'choice', options: [{ id: 'make', label: verb, el: targetEl }], selected: null, choose: () => void make() };
    }
  }, [isActive, galleryOpen, covered, pane, step, context, kind, chosenId, prompt, target, noWords, size, restyling, status, verb, makerOptions.map((o) => o.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  useOrbAssist(assist);

  /* ---------------------------------------------------------------- the steps */
  const textTools = (box: IdeaBox, id: string, value: string, set: (v: string) => void, what: string, ctx = context) => (
    <div className="mk-tools" role="group" aria-label={`Help with ${what}`}>
      <TalkButton value={value} onChange={set} what={what} />
      <FillButton box={box} id={id} context={ctx} value={value} onChange={set} />
    </div>
  );

  const whatStep: DeckStep = {
    id: 'what',
    name: STEP_NAME.what,
    title: 'What will it be?',
    body: (
      <>
        <div className="mk-kinds" role="radiogroup" aria-label="What to make" data-assist-target>
          {KINDS.map((k, i) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={kind === k.id}
              className="mk-kind"
              style={{ '--i': i } as React.CSSProperties}
              data-assist-option={k.id}
              onClick={(e) => chooseKind(k.id, e.currentTarget)}
            >
              <span className="mk-kind-art" aria-hidden>
                <Icon name={k.icon} size={20} />
              </span>
              <span className="mk-kind-label">{k.label}</span>
              <span className="mk-kind-hint">{k.hint}</span>
            </button>
          ))}
          {/* Characters: made-up grown-ups you create once and use in anything you make. */}
          {onCharacters && (
            <button type="button" className="mk-kind mk-kind-character" style={{ '--i': KINDS.length } as React.CSSProperties} onClick={() => onCharacters()}>
              <span className="mk-kind-art" aria-hidden>
                <Icon name="user" size={20} />
              </span>
              <span className="mk-kind-label">A character</span>
              <span className="mk-kind-hint">Make a person once, then use them in any picture or video</span>
            </button>
          )}
          {/* Drawing has its own app now: this opens it. */}
          <button type="button" className="mk-kind mk-kind-draw" style={{ '--i': KINDS.length + 1 } as React.CSSProperties} onClick={() => launch('livedraw')}>
            <span className="mk-kind-art" aria-hidden>
              <Icon name="brush" size={20} />
            </span>
            <span className="mk-kind-label">Draw it</span>
            <span className="mk-kind-hint">Opens Live Draw: draw, and watch it become a picture</span>
          </button>
        </div>
        <div className="mk-tools">
          <ChooseButton context={context} options={kindOptions} onChoose={(id) => chooseKind(id as Mode, byOption(id))} />
        </div>
      </>
    ),
  };

  const makerStep: DeckStep = {
    id: 'maker',
    name: STEP_NAME.maker,
    title: kind === 'vedit' ? 'Who does it, and what' : 'Who makes it',
    dek: chosen?.blurb ? (
      <>
        <em>{chosen.name}</em>: {chosen.blurb}
      </>
    ) : undefined,
    body: (
      <>
        <div className="mk-makers" role="radiogroup" aria-label="Maker" data-assist-target>
          {makerList.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={m.id === chosenId}
              className="mk-maker ai-maker-chip"
              data-assist-option={m.id}
              onClick={(e) => chooseMaker(m, e.currentTarget)}
            >
              <span className="mk-maker-name">{m.name}</span>
              {!m.installed && <span className="ai-muted mk-maker-state"> {m.pending ? 'soon' : m.wanted ? progressText(m, machineOn) : 'not added'}</span>}
            </button>
          ))}
        </div>
        {kind !== 'vedit' && styles.length > 0 && (
          <div className="mk-row" ref={secondRow}>
            <p className="o5-kicker">Style</p>
            <div className="mk-chips" role="radiogroup" aria-label="Style">
              <button type="button" role="radio" aria-checked={!style} className="mk-chip" onClick={(e) => choose(e.currentTarget, () => setStyle(''), 'describe')}>
                No style
              </button>
              {styles.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={style === s.id} className="mk-chip" onClick={(e) => choose(e.currentTarget, () => setStyle(s.id), 'describe')}>
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {kind === 'vedit' && tasks.length > 0 && (
          <div className="mk-row" ref={secondRow}>
            <p className="o5-kicker">What to do</p>
            <div className="mk-chips" role="radiogroup" aria-label="What to do">
              {tasks.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={vTask === t} className="mk-chip" onClick={(e) => choose(e.currentTarget, () => setTask(t), 'describe')}>
                  {TASKS[t].label}
                </button>
              ))}
            </div>
          </div>
        )}
        {makerNote && (
          <p className="ai-muted mk-note" role="status">
            {makerNote}
          </p>
        )}
        <div className="mk-tools">
          <ChooseButton
            context={context}
            options={makerOptions}
            onChoose={(id) => {
              const m = makerList.find((x) => x.id === id);
              if (m) chooseMaker(m, byOption(id));
            }}
          />
          <button type="button" className="mk-tool" onClick={() => onOpenMakers?.()}>
            <Icon name="plus" size={18} />
            <span className="mk-tool-word">Makers</span>
          </button>
        </div>
      </>
    ),
  };

  // What the words-naming-a-thing box is for: erasing it, replacing it, or who to swap.
  const targetBox = vTask === 'erase' ? 'erase' : vTask === 'swap' ? 'swap' : 'replace';
  const TARGET_TEXT = {
    erase: { label: 'What to erase', placeholder: 'What to erase, e.g. the man in the red shirt', what: 'what to erase', ask: 'Name the thing to erase from the video, in a few words.' },
    replace: { label: 'What to replace', placeholder: 'What to replace, e.g. the red car', what: 'what to replace', ask: 'Name the thing in the video to replace, in a few words.' },
    swap: {
      label: 'Who to replace',
      placeholder: 'Who to replace, e.g. the man in the red jacket',
      what: 'who to replace',
      ask: 'Name the adult in the video to replace, in a few words: what they wear or where they are.',
    },
  }[targetBox];
  const describeStep: DeckStep = {
    id: 'describe',
    name: stepName('describe'),
    title: vTask === 'erase' ? 'What should go?' : vTask === 'swap' ? 'Who to replace?' : kind === 'edit' || kind === 'vedit' ? 'Say the change' : 'Describe it',
    dek: vTask === 'swap' ? 'Say it by what they wear or where they are. They only need to be in the first frame.' : undefined,
    body: (
      <>
        {wantsTarget && (
          <div className="mk-field" data-assist-target={noWords || undefined}>
            <input
              className="input ai-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label={TARGET_TEXT.label}
              placeholder={TARGET_TEXT.placeholder}
              maxLength={200}
              enterKeyHint="done"
            />
            {textTools(targetBox, `make:target:${vTask}`, target, setTarget, TARGET_TEXT.what, `${context}. ${TARGET_TEXT.ask}`)}
          </div>
        )}
        {!noWords && (
          <div className="mk-field" data-assist-target>
            <TextArea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} aria-label="Describe it" placeholder={placeholder} />
            {textTools(promptBox, `make:prompt:${promptBox}`, prompt, setPrompt, 'the description')}
          </div>
        )}
        {charApplies && !swapping && !noWords && machineOn && <CharacterPick characters={chars.ready} value={character} onChange={setCharacter} onCreate={onCharacters} />}
        {kind === 'edit' && chosenId === 'angles' && (
          <div className="mk-chips" aria-label="Angles">
            {ANGLES.map((a) => (
              <button key={a} type="button" className="mk-chip" onClick={(e) => choose(e.currentTarget, () => setPrompt(a), null)}>
                {a.split(',')[0]}
              </button>
            ))}
          </div>
        )}
      </>
    ),
  };

  /** One of your characters in a photo's place: the slot it fills is told by `slot`, and `clear` drops the photo there. */
  const charFill = (slot: string, clear: () => void) =>
    charSlot === slot ? (
      <CharacterPick
        slot
        characters={chars.ready}
        value={character}
        onChange={(id) => {
          setCharacter(id);
          if (id) clear();
          setCharSlot(null);
        }}
        onCreate={onCharacters}
      />
    ) : null;
  /** A gallery picture as a data link, for slots the machine takes as a file (an ending photo, a face, a second picture). */
  const dataOf = async (m: GalleryMedia) => {
    const res = await fetch(m.url);
    if (!res.ok) throw new Error('That picture could not be loaded.');
    return toDataUrl(await res.blob());
  };
  const galleryButton = (slot: string) => (
    <button type="button" className="btn ghost" aria-expanded={galSlot === slot} onClick={() => setGalSlot((v) => (v === slot ? null : slot))}>
      <Icon name="layers" size={18} /> From your gallery
    </button>
  );
  const galleryFill = (slot: string, use: (m: GalleryMedia) => Promise<void> | void, kindOf: 'image' | 'video' = 'image') =>
    galSlot === slot ? (
      <GalleryPick
        items={items.map(asMedia)}
        kind={kindOf}
        label={kindOf === 'image' ? 'Pick a picture from your gallery' : 'Pick a video from your gallery'}
        onPick={async (m) => {
          try {
            await use(m);
            setGalSlot(null);
            cue('pop');
          } catch (err) {
            toast((err as Error).message, 'error');
          }
        }}
      />
    ) : null;
  const photoRow = (
    src: string | null,
    alt: string,
    note: string,
    add: string,
    onAdd: () => void,
    onRemove: () => void,
    removeLabel: string,
    char?: { slot: string; clear: () => void },
    gal?: { slot: string; use: (m: GalleryMedia) => Promise<void> | void },
  ) => (
    <>
      <div className="ai-create-photo">
        {src ? (
          <>
            <img src={src} alt={alt} />
            <span className="ai-muted">{note}</span>
            <IconButton icon="close" label={removeLabel} onClick={onRemove} />
          </>
        ) : char && charForJob ? (
          <>
            {thumbOf(charForJob) ? <img src={thumbOf(charForJob)!} alt={charForJob.name} /> : <span className="chr-pick-face" aria-hidden />}
            <span className="ai-muted">{charForJob.name}, your character</span>
            <IconButton icon="close" label={`Take ${charForJob.name} out`} onClick={() => setCharacter(null)} />
          </>
        ) : (
          <>
            <button type="button" className="btn ghost" onClick={onAdd}>
              <Icon name="image" size={18} /> {add}
            </button>
            {gal && galleryButton(gal.slot)}
            {char && (
              <button type="button" className="btn ghost" aria-expanded={charSlot === char.slot} onClick={() => setCharSlot((v) => (v === char.slot ? null : char.slot))}>
                <Icon name="user" size={18} /> Use a character
              </button>
            )}
          </>
        )}
      </div>
      {gal && !src && !(char && charForJob) && galleryFill(gal.slot, gal.use)}
      {char && !src && !charForJob && charFill(char.slot, char.clear)}
    </>
  );

  /** Swap a person: the video first, on a step of its own. */
  const videoStep: DeckStep = {
    id: 'video',
    name: stepName('video'),
    title: 'The video',
    dek: 'The person to replace should be in its first frame. It works on the first 5 seconds.',
    body: (
      <div className="mk-extras" data-assist-target>
        <VideoSource ai={ai} value={video} onChange={setVideo} onError={(m) => toast(m, 'error')} gallery={items.map(asMedia)} />
      </div>
    ),
  };

  const extrasStep: DeckStep = {
    id: 'extras',
    name: stepName('extras'),
    title:
      kind === 'edit'
        ? needImages === 2
          ? 'The person, then the outfit'
          : 'The picture'
        : swapping
          ? 'Who takes their place'
          : kind === 'vedit'
            ? 'The video'
            : kind === 'video'
              ? talking
                ? 'The photo and the sound'
                : restyling
                  ? 'How much to change'
                  : 'Shape, length and photos'
              : 'Shape',
    body: (
      <div className="mk-extras" data-assist-target>
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
        {kind === 'vedit' && !swapping && <VideoSource ai={ai} value={video} onChange={setVideo} onError={(m) => toast(m, 'error')} gallery={items.map(asMedia)} />}
        {swapping && (
          <>
            {photoRow(
              refPhoto?.src ?? null,
              'The new person',
              'They take over in the video, with the same moves.',
              'Add a photo of the new person',
              () => personInput.current?.click(),
              () => setRefPhoto(null),
              'Remove the photo of the new person',
              undefined,
              {
                slot: 'swap',
                use: (m) => {
                  setRefPhoto({ src: m.url, item: m.id });
                  setCharacter(null);
                },
              },
            )}
            <CharacterPick
              swap
              characters={chars.ready}
              value={character}
              onChange={(id) => {
                setCharacter(id);
                if (id) {
                  setRefPhoto(null);
                  setFacePhoto(null);
                }
              }}
              onCreate={onCharacters}
            />
            {photoRow(
              facePhoto,
              'Their face, close up',
              'Helps keep their face right.',
              'Add a close-up of their face (optional)',
              () => faceInput.current?.click(),
              () => setFacePhoto(null),
              'Remove the face close-up',
              undefined,
              { slot: 'face', use: async (m) => setFacePhoto(await dataOf(m)) },
            )}
            <p className="ai-muted mk-note">A plain background works best. Photos of real people are never made sexual, and children can’t be swapped.</p>
            <input
              ref={personInput}
              type="file"
              accept="image/*"
              hidden
              aria-label="Photo of the new person"
              onChange={(e) => {
                void pickRef(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <input
              ref={faceInput}
              type="file"
              accept="image/*"
              hidden
              aria-label="Face close-up"
              onChange={(e) => {
                void pickFace(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </>
        )}
        {kind === 'vedit' && wantsRef && (
          <>
            {photoRow(
              refPhoto?.src ?? null,
              vTask === 'motion' ? 'Who should move' : 'The new thing',
              vTask === 'motion' ? 'This person moves like the video.' : 'It looks like this picture.',
              vTask === 'motion' ? 'Add a photo of who should move' : 'Add a picture of it (optional)',
              () => refInput.current?.click(),
              () => setRefPhoto(null),
              'Remove the picture',
              vTask === 'motion' ? { slot: 'motion', clear: () => setRefPhoto(null) } : undefined,
              { slot: 'ref', use: (m) => setRefPhoto({ src: m.url, item: m.id }) },
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
          </>
        )}
        {kind === 'edit' && (
          <div className="ai-edit-photos">
            {charAsPicture && charForJob && (
              <div className="ai-edit-photo">
                {thumbOf(charForJob) ? <img src={thumbOf(charForJob)!} alt={`${charForJob.name}, your character`} /> : <span className="chr-pick-face" aria-hidden />}
                <IconButton icon="close" label={`Take ${charForJob.name} out`} onClick={() => setCharacter(null)} />
              </div>
            )}
            {editImages.map((p, i) => (
              <div key={i} className="ai-edit-photo">
                <img src={p.src} alt={needImages === 2 ? (i === 0 ? 'The person' : 'The outfit') : 'Picture to edit'} />
                <IconButton icon="close" label="Remove this picture" onClick={() => setEditImages((prev) => prev.filter((_, k) => k !== i))} />
              </div>
            ))}
            {editImages.length + (charAsPicture ? 1 : 0) < Math.max(1, needImages) && (
              <>
                <button type="button" className="btn ghost" onClick={() => editInput.current?.click()}>
                  <Icon name="image" size={18} /> {needImages === 2 && editImages.length + (charAsPicture ? 1 : 0) === 1 ? 'Add the outfit' : 'Add a picture'}
                </button>
                {galleryButton('edit')}
              </>
            )}
            {!charForJob && editImages.length === 0 && (
              <button type="button" className="btn ghost" aria-expanded={charSlot === 'edit'} onClick={() => setCharSlot((v) => (v === 'edit' ? null : 'edit'))}>
                <Icon name="user" size={18} /> Use a character
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
        {kind === 'edit' &&
          editImages.length + (charAsPicture ? 1 : 0) < Math.max(1, needImages) &&
          galleryFill('edit', async (m) => {
            // The first picture goes by its gallery id (the machine has it); a second one as a file.
            const next = editImages.length === 0 ? { src: m.url, item: m.id } : { src: await dataOf(m) };
            setEditImages((prev) => [...prev, next].slice(-2));
          })}
        {kind === 'edit' && !charForJob && editImages.length === 0 && charFill('edit', () => {})}
        {kind === 'video' && takesVideo && !startImage && !endImage && (
          <VideoSource ai={ai} value={video} onChange={setVideo} onError={(m) => toast(m, 'error')} gallery={items.map(asMedia)} hint="Or restyle a video you have: it keeps the motion and the sound." />
        )}
        {talking && <AudioSource ai={ai} value={audio} onChange={setAudio} onError={(m) => toast(m, 'error')} />}
        {kind === 'video' && !restyling && (
          <>
            {photoRow(
              startImage,
              'Starting photo',
              'The video starts from this photo.',
              talking ? 'Add a photo of the person' : 'Start from a photo',
              () => fileInput.current?.click(),
              () => {
                setStartImage(null);
                setStartItem(null);
              },
              'Remove the starting photo',
              {
                slot: 'start',
                clear: () => {
                  setStartImage(null);
                  setStartItem(null);
                },
              },
              {
                slot: 'start',
                use: (m) => {
                  setStartImage(m.url);
                  setStartItem(m.id);
                  setCharacter(null);
                },
              },
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
          </>
        )}
        {kind === 'video' && accepts.includes('endPhoto') && !restyling && (
          <>
            {photoRow(endImage, 'Ending photo', 'The video ends on this photo.', 'End on a photo', () => endInput.current?.click(), () => setEndImage(null), 'Remove the ending photo', undefined, {
              slot: 'end',
              use: async (m) => setEndImage(await dataOf(m)),
            })}
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
          </>
        )}
      </div>
    ),
  };

  /* ---------------------------------------------------------------- check & make */
  const kindLabel = KINDS.find((k) => k.id === kind)!.label;
  const words = noWords
    ? vTask === 'erase' || vTask === 'swap'
      ? target.trim()
        ? `${vTask === 'erase' ? 'Erase' : 'Replace'} ${target.trim()}`
        : ''
      : 'No words needed'
    : [wantsTarget && target.trim() ? `${target.trim()} →` : '', prompt.trim()].filter(Boolean).join(' ');
  const wordsMissing = (!promptOk && !noWords) || (wantsTarget && !target.trim());
  const extrasWords = (() => {
    const shape = kind === 'image' || kind === 'video' ? SIZES[kind].find((s) => s.value === size[kind])?.label : '';
    if (kind === 'image') return shape;
    if (kind === 'video') {
      if (restyling) return `Restyles your video · changes it ${change === 'lot' ? 'a lot' : 'a little'}`;
      if (talking) return `${startImage ? 'Photo added' : 'No photo yet'} · ${audio ? 'sound added' : 'no sound yet'}`;
      return [shape, `${seconds} s`, startImage ? 'starts from your photo' : '', endImage ? 'ends on a photo' : ''].filter(Boolean).join(' · ');
    }
    if (kind === 'edit') return editImages.length >= Math.max(1, needImages) ? (needImages === 2 ? 'The person and the outfit' : 'Your picture') : needImages === 2 ? `${editImages.length} of 2 pictures` : 'No picture yet';
    if (swapping) return charForJob ? `${charForJob.name}, a character` : [refPhoto ? 'A photo of them' : 'No photo yet', facePhoto ? 'a face close-up' : ''].filter(Boolean).join(' · ');
    return [video ? 'Your video' : 'No video yet', wantsRef ? (refPhoto ? 'a photo' : vTask === 'motion' ? 'no photo yet' : '') : ''].filter(Boolean).join(' · ');
  })();
  const thumbs = [charForJob ? thumbOf(charForJob) : null, startImage && kind === 'video' && !restyling ? startImage : null, endImage && kind === 'video' && !restyling ? endImage : null, ...(kind === 'edit' ? editImages.map((p) => p.src) : []), kind === 'vedit' && refPhoto ? refPhoto.src : null, swapping ? facePhoto : null].filter(Boolean) as string[];
  const rows: { id: StepId; key: string; value: ReactNode; missing?: boolean }[] = [
    { id: 'what', key: 'What', value: kindLabel },
    { id: 'maker', key: 'Maker', value: `${makerName}${styleName ? ` · ${styleName}` : ''}${kind === 'vedit' && tasks.length && vTask ? ` · ${TASKS[vTask as VideoTask].label}` : ''}`, missing: Boolean(makerNote) },
    ...(swapping ? [{ id: 'video' as StepId, key: 'Video', value: video ? 'Your video' : 'No video yet', missing: !video }] : []),
    ...(hasDescribe ? [{ id: 'describe' as StepId, key: swapping ? 'Who' : 'Words', value: words || (talking ? 'None (optional)' : 'Nothing yet'), missing: wordsMissing }] : []),
    ...(charForJob && !swapping && hasDescribe ? [{ id: 'describe' as StepId, key: 'Character', value: charForJob.name }] : []),
    { id: 'extras', key: swapping ? 'New person' : 'Extras', value: extrasWords, missing: swapping ? !refPhoto && !charForJob : !inputsOk },
  ];
  const cloudable = !machineOn && (kind === 'image' || kind === 'video') && Boolean(onCloud);

  const jobList = jobs.length > 0 && (
    <JobQueue
      jobs={jobs}
      line={jobLine}
      onStop={(id) => void ai.cancelStudioJob(id).then(() => setJobs((p) => p.filter((x) => x.id !== id)), () => {})}
      onDismiss={(id) => setJobs((p) => p.filter((x) => x.id !== id))}
      onReorder={async (ids) => {
        try {
          const list = await ai.reorderStudioJobs(ids);
          setJobs((prev) => [...list, ...prev.filter((j) => j.status === 'error' && !list.some((x) => x.id === j.id))]);
        } catch (err) {
          toast((err as Error).message, 'error');
        }
      }}
    />
  );

  const checkStep: DeckStep = {
    id: 'check',
    name: STEP_NAME.check,
    title: 'Check, then make it',
    body: (
      <div className="mk-check">
        <ul className="mk-summary" aria-label="Your choices">
          {rows.map((r) => (
            <li key={`${r.id}:${r.key}`}>
              <button type="button" className="mk-sum-row" data-missing={r.missing || undefined} onClick={() => go(r.id)} aria-label={`${r.key}: ${typeof r.value === 'string' ? r.value : ''}. Change it`}>
                <span className="o5-kicker">{r.key}</span>
                <span className="mk-sum-value">{r.value}</span>
                <span className="mk-sum-change" aria-hidden>
                  Change
                </span>
              </button>
            </li>
          ))}
        </ul>
        {thumbs.length > 0 && (
          <div className="mk-thumbs" aria-hidden>
            {thumbs.map((src, i) => (
              <img key={i} src={src} alt="" />
            ))}
          </div>
        )}
        <div className="mk-go">
          <button
            type="button"
            className="btn primary ai-make mk-make"
            data-assist-target
            data-launched={launched ? launched % 2 : undefined}
            disabled={!canMake}
            onClick={() => void make()}
          >
            <Icon name={kind === 'video' || kind === 'vedit' ? 'film' : kind === 'edit' ? 'pencil' : 'image'} size={18} /> {submitting ? 'Starting…' : verb}
            <span className="mk-burst" aria-hidden />
          </button>
          {cloudable && (
            <button type="button" className="mk-tool" onClick={() => onCloud?.({ prompt: prompt.trim(), kind: kind as 'image' | 'video' })}>
              <Icon name="sparkle" size={18} />
              <span className="mk-tool-word">Make it in the cloud</span>
            </button>
          )}
          <p className="ai-muted mk-status" role="status">
            {status}
          </p>
        </div>
        {!galleryOpen && jobList}
      </div>
    ),
  };

  const steps = [whatStep, makerStep, ...(swapping ? [videoStep] : []), ...(hasDescribe ? [describeStep] : []), extrasStep, checkStep];
  const shown = stepIds.includes(step) ? step : 'extras';

  return (
    <div className="ai-create mk" data-gallery={galleryOpen || undefined} inert={covered} aria-hidden={covered || undefined}>
      <header className="mk-top">
        <div className="mk-brand">
          {kicker && <p className="o5-kicker">{kicker}</p>}
          <h2 className="mk-brand-title">Make</h2>
        </div>
        <div className="mk-actions">
          {actions}
          <button type="button" className="mk-top-btn" aria-label={`Gallery: ${items.length === 1 ? '1 creation' : `${items.length} creations`}`} aria-expanded={galleryOpen} onClick={() => setGalleryOpen(true)}>
            <Icon name="image" size={18} />
            <span>Gallery</span>
            {items.length > 0 && (
              <span className="mk-count" key={items.length}>
                {items.length}
              </span>
            )}
            {running.length > 0 && <span className="mk-live" aria-hidden />}
          </button>
        </div>
      </header>
      {notice}
      <div className="mk-main" inert={galleryOpen} aria-hidden={galleryOpen || undefined}>
        <StepDeck steps={steps} current={shown} onGo={go} onActivePane={setPane} label="Make, step by step" />
      </div>

      <section className="mk-screen" aria-label="Gallery" hidden={!galleryOpen}>
        <header className="mk-screen-head">
          <div>
            <p className="o5-kicker">The gallery</p>
            <h3 className="o5-chapter-title">Your creations</h3>
          </div>
          <div className="mk-screen-acts">
            <button type="button" className="mk-top-btn" onClick={() => launch('gallery')}>
              <Icon name="image" size={18} />
              <span>Everything, in Gallery</span>
            </button>
            <button type="button" className="mk-top-btn" onClick={() => setGalleryOpen(false)}>
              <Icon name="back" size={18} />
              <span>Back to making</span>
            </button>
          </div>
        </header>
        <div className="mk-screen-scroll">
          {galleryOpen && jobList}
          {items.length === 0 ? (
            <EmptyState icon="image" title="Nothing here yet">
              Pictures and videos you make are kept on your AI machine and show up here on all your devices.
            </EmptyState>
          ) : (
            <GalleryGrid
              items={items.map(asMedia)}
              label="Your creations"
              onOpen={(m, from) => {
                viewFrom.current = from;
                setViewing(items.find((x) => x.id === m.id) ?? null);
              }}
            />
          )}
        </div>
      </section>

      {viewing && (
        <GalleryViewer
          media={asMedia(viewing)}
          title={viewing.kind === 'image' ? 'Image' : 'Video'}
          origin={viewFrom.current}
          onClose={() => setViewing(null)}
          onPrev={stepper.prev ? () => setViewing(items.find((x) => x.id === stepper.prev!.id) ?? null) : null}
          onNext={stepper.next ? () => setViewing(items.find((x) => x.id === stepper.next!.id) ?? null) : null}
          position={stepper.index >= 0 ? { index: stepper.index, count: stepper.count } : undefined}
          neighbours={[stepper.prev, stepper.next]}
          words={<p className="ai-viewer-prompt">{viewing.prompt}</p>}
        >
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
                leaveGallery('describe');
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
                  <button type="button" className="btn" onClick={() => workOnVideo(viewing, 'vace', 'Pick what to do, then describe the change.', 'maker')}>
                    <Icon name="pencil" size={16} /> Edit this video
                  </button>
                )}
                {installed('video-erase') && (
                  <button type="button" className="btn" onClick={() => workOnVideo(viewing, 'video-erase', 'Say what to erase, then tap Erase it.', 'describe')}>
                    <Icon name="close" size={16} /> Erase from video
                  </button>
                )}
                {installed('person-swap') && (
                  <button type="button" className="btn" onClick={() => workOnVideo(viewing, 'person-swap', 'Say who to replace, then add a photo of the new person.', 'describe')}>
                    <Icon name="refresh" size={16} /> Swap a person
                  </button>
                )}
                {installed('video-sharpen') && (
                  <button type="button" className="btn" onClick={() => workOnVideo(viewing, 'video-sharpen', 'Tap Sharpen video to make it twice as large and crisper.', 'check')}>
                    <Icon name="sparkle" size={16} /> Sharpen video
                  </button>
                )}
              </>
            )}
            <button type="button" className="btn danger" onClick={() => setConfirmDelete(viewing)}>
              <Icon name="trash" size={16} /> Delete
            </button>
          </div>
        </GalleryViewer>
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

/** A gallery item as the shared gallery shows it (Gallery.tsx). */
const asMedia = (it: StudioItem): GalleryMedia => ({ id: it.id, kind: it.kind, url: it.url, thumbUrl: it.thumbUrl, width: it.width, height: it.height, label: it.prompt, nsfw: it.nsfw === true || isNsfw(it.prompt), seconds: it.seconds });
