import type { StudioMakerInfo } from '../../services/ai/LocalAi';
import { CATALOG_MAKERS } from '../store/catalog';

const KEY = 'orbit:studio:makers';

type Entry = [id: string, kind: StudioMakerInfo['kind'], name: string, blurb: string, extra?: Partial<StudioMakerInfo>];

/** What the AI machine offers (mirrors the gate's MAKERS), for when it is off and has not been asked yet. */
const ENTRIES: Entry[] = [
  ['qwen', 'image', 'Qwen Uncensored', 'All-rounder, great with text in pictures.', { builtIn: true }],
  ['qwen-real', 'image', 'Qwen Real', 'Photoreal people and places (Noct-Q v4), uncensored.'],
  ['anime', 'image', 'Anime', 'Anime and illustration (Noct-Q Anime), uncensored.'],
  ['krea-real', 'image', 'Krea Real', 'Krea 2 photoreal (Noct), fast 8 steps, uncensored.'],
  ['ltx', 'video', 'LTX 10Eros', 'Video with sound, uncensored.', { builtIn: true }],
  ['h3-max', 'video', 'H3 Max', 'MiniMax H3 (10Eros Max): best motion, with sound, uncensored.'],
  ['edit', 'edit', 'Edit with words', 'Change a picture by describing it. Uses Qwen, no extra download.', { builtIn: true }],
  ['outfit', 'edit', 'Outfit swap', 'Dress the person in picture 1 in the outfit from picture 2.', { twoImages: true }],
  ['angles', 'edit', 'New angle', 'The same subject from another camera angle.'],
  ['sharpen', 'upscale', 'Sharpen 4×', 'Makes a picture four times larger and crisper.'],
  // Video makers that take a video, a voice or song, or words naming a thing (ai/gate/catalog.json).
  ['ltx-25', 'video', 'LTX-2.5', 'Lightricks’ newest: video with sound, first and last frame, and video to video. Needs a Hugging Face token.', { accepts: ['photo', 'endPhoto', 'video'], gated: true }],
  ['s2v', 'video', 'Talking photo', 'A photo and a voice or song become a talking or singing video (Wan 2.2 S2V).', { needs: ['photo', 'audio'] }],
  ['vace', 'videoedit', 'Wan VACE', 'Edit a video: replace something by naming it, restyle it, extend it, or move a photo like it.', { needs: ['video'], tasks: ['replace', 'restyle', 'extend', 'motion'] }],
  ['video-erase', 'videoedit', 'Erase from video', 'Name what to remove (a person, a sign, a watermark) and it is gone from every frame.', { needs: ['video', 'target'] }],
  ['video-sharpen', 'videoedit', 'Sharpen video', 'Makes a finished video twice as large and crisper (SeedVR2).', { needs: ['video'] }],
];

export const MAKER_CATALOG: StudioMakerInfo[] = ENTRIES.map(([id, kind, name, blurb, extra]) => {
  const builtIn = Boolean(extra?.builtIn);
  return { id, kind, name, blurb, for: null, twoImages: false, builtIn, wanted: builtIn, installed: builtIn, size: 0, percent: builtIn ? 100 : 0, ...extra };
});

/** Every maker Orbit knows: the built-in list and the catalog's extra makers (ai/gate/catalog.json). */
const ALL: StudioMakerInfo[] = [
  ...MAKER_CATALOG,
  ...CATALOG_MAKERS.filter((m) => !MAKER_CATALOG.some((b) => b.id === m.id)).map((m) => ({ ...m, builtIn: false, wanted: false, installed: false, percent: 0 })),
];

/**
 * The machine's list, plus every maker in the catalog it doesn't know yet (it runs older code):
 * those show as `pending`, "Arrives when your AI machine restarts", and can't be added until then.
 */
export function withCatalog(list: StudioMakerInfo[]): StudioMakerInfo[] {
  const have = new Set(list.map((m) => m.id));
  return [...list, ...ALL.filter((m) => !have.has(m.id)).map((m) => ({ ...m, builtIn: false, wanted: false, installed: false, percent: 0, pending: true }))];
}
export const PENDING_TEXT = 'Arrives when your AI machine restarts';

/** Makers to show while the machine is off: what it last reported, plus every newer one in the catalog. */
export function offlineMakers(): StudioMakerInfo[] {
  const base = rememberedMakers() ?? MAKER_CATALOG;
  const have = new Set(base.map((m) => m.id));
  return [...base, ...ALL.filter((m) => !have.has(m.id))];
}

/** The list the machine last reported, so its makers stay pickable while it is off. */
export function rememberedMakers(): StudioMakerInfo[] | null {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || 'null');
    return Array.isArray(list) && list.length ? list : null;
  } catch {
    return null;
  }
}

export function rememberMakers(list: StudioMakerInfo[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode */
  }
}
