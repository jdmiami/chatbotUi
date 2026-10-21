import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type AppId =
  | 'terminal'
  | 'editor'
  | 'agent'
  | 'ai'
  | 'store'
  | 'soreal'
  | 'lab'
  | 'settings'
  // Full-screen apps that live on the site (Orbit shows their page and opens them).
  | 'playground'
  | 'vscode'
  | 'desktop'
  | 'windows';
export type Overlay = null | 'switcher' | 'control-center' | 'index';
export type ThemePref = 'system' | 'dark' | 'light';
export type AccentId = 'indigo' | 'teal' | 'amber' | 'rose' | 'sky';
export type WallpaperId = 'orbit' | 'dusk' | 'aurora' | 'graphite';
/** classic = the original Orbit look; o5 = Orbit 0.5 (editorial, full screen, chrome hides away). */
export type SkinId = 'classic' | 'o5';
/** system = Auto, reduce = Off. */
export type MotionPref = 'system' | 'reduce' | 'full' | 'lite';

export interface Settings {
  theme: ThemePref;
  accent: AccentId;
  wallpaper: WallpaperId;
  /** 0.9 – 1.3 */
  textScale: number;
  motion: MotionPref;
  /** The person chose a Motion level themselves (older saved "Auto" settings are moved to Full once). */
  motionPicked?: boolean;
  terminalFontSize: number;
  /** Show the touch key row above the keyboard in Terminal. */
  terminalKeys: boolean;
  /**
   * Type into a visible text box above the keys (sent on Return) instead of straight into the
   * terminal. Unset = on for phones, off elsewhere.
   */
  terminalTypingBox?: boolean;
  /**
   * Terminal width in columns. Unset/0 = fit the screen. A fixed width (80, 100…) can be wider
   * than the screen: swipe sideways to pan, pinch or "Fit width" to zoom out.
   */
  terminalColumns?: number;
  /** Light and depth follow the phone's tilt (or the mouse). */
  tilt: boolean;
  /** The iPhone motion-sensor permission was given once (it is asked again silently on each visit). */
  tiltGranted?: boolean;
  /** Soft sounds for key moments. Off until you turn it on. */
  sound: boolean;
  /** A short vibration for key moments, where the device allows it. */
  haptics: boolean;
  /** The look. Orbit 0.5 (MagStyle) is the only look; classic stays only for the test suite. */
  skin?: SkinId;
  /** The orb on every screen (tap to talk, hold to ask it to do something). Unset = on. */
  orb?: boolean;
  /** The orb drifts to what matters on screen; false = it stays where you put it. Unset = follows. */
  orbFollow?: boolean;
  /**
   * Quick AI jobs (the orb, writing help, reading the screen) use NVIDIA's free cloud models; heavy
   * work stays on the AI machine. Sends on-screen text and screenshots, never passwords. Unset = on.
   */
  cloudAi?: boolean;
  /** Ghost text and rewrites in text boxes (needs cloud AI). Unset = on. */
  writeHelp?: boolean;
  /** Retired (the old NSFW blur switch). Nothing reads it. */
  censor?: boolean;
  /** NSFW pictures and videos: hidden everywhere (unset, 'hide'), or shown blurred until held ('show', "Show NSFW"). Never saved: every visit starts hidden. */
  nsfwView?: 'hide' | 'show';
  /** Seen the first-run "what is simulated" sheet. */
  introSeen: boolean;
}

export interface SplitState {
  /** The user wants code + chat side by side (only honoured where space allows). */
  enabled: boolean;
  left: AppId;
  right: AppId;
  /** Fraction of width given to the left pane, 0.3 – 0.7. */
  ratio: number;
}

interface ShellState {
  /** Apps that are running (mounted). Order = most recent first. Not persisted across reloads. */
  openApps: AppId[];
  /** null = home screen */
  activeApp: AppId | null;
  overlay: Overlay;
  split: SplitState;
  settings: Settings;
  toasts: { id: number; text: string; tone: 'info' | 'error' | 'success' }[];

  launch(app: AppId): void;
  goHome(): void;
  closeApp(app: AppId): void;
  setOverlay(overlay: Overlay): void;
  toggleOverlay(overlay: Exclude<Overlay, null>): void;
  setSplit(patch: Partial<SplitState>): void;
  /** Open code + chat side by side and focus it. */
  openSplit(): void;
  updateSettings(patch: Partial<Settings>): void;
  toast(text: string, tone?: 'info' | 'error' | 'success'): void;
  dismissToast(id: number): void;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: 'indigo',
  wallpaper: 'orbit',
  textScale: 1,
  // Full by default: Auto quietly turned animation down on phones in Low Power Mode.
  motion: 'full',
  terminalFontSize: 14,
  terminalKeys: true,
  tilt: true,
  sound: false,
  haptics: false,
  introSeen: false,
  skin: classicAllowed() ? 'classic' : 'o5',
};

/**
 * Orbit 0.5 (MagStyle) is the only look. The classic one is kept only where the test suite asks for
 * it (a flag set in its browser storage), until its tests move over; nobody else can land in it.
 */
export function classicAllowed(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('orbit:classic') === '1';
  } catch {
    return false;
  }
}

const DEFAULT_SPLIT: SplitState = { enabled: false, left: 'editor', right: 'agent', ratio: 0.55 };

let toastSeq = 1;

export const useShell = create<ShellState>()(
  persist(
    (set, get) => ({
      openApps: [],
      activeApp: null,
      overlay: null,
      split: DEFAULT_SPLIT,
      settings: DEFAULT_SETTINGS,
      toasts: [],

      launch(app) {
        const { openApps, split } = get();
        // Launching an app that isn't part of the split leaves split view (it stays enabled for later).
        const inSplit = split.enabled && (app === split.left || app === split.right);
        set({
          openApps: [app, ...openApps.filter((a) => a !== app)],
          activeApp: app,
          overlay: null,
          split: inSplit ? split : { ...split, enabled: false },
        });
      },
      goHome() {
        set({ activeApp: null, overlay: null });
      },
      closeApp(app) {
        const { openApps, activeApp, split } = get();
        const rest = openApps.filter((a) => a !== app);
        const splitBroken = split.enabled && (app === split.left || app === split.right);
        set({
          openApps: rest,
          activeApp: activeApp === app ? null : activeApp,
          split: splitBroken ? { ...split, enabled: false } : split,
        });
      },
      setOverlay(overlay) {
        set({ overlay });
      },
      toggleOverlay(overlay) {
        set({ overlay: get().overlay === overlay ? null : overlay });
      },
      setSplit(patch) {
        set({ split: { ...get().split, ...patch } });
      },
      openSplit() {
        const { split, openApps } = get();
        const apps = [split.left, split.right, ...openApps.filter((a) => a !== split.left && a !== split.right)];
        set({ split: { ...split, enabled: true }, openApps: apps, activeApp: split.left, overlay: null });
      },
      updateSettings(patch) {
        const next = patch.skin === 'classic' && !classicAllowed() ? { ...patch, skin: 'o5' as const } : patch;
        set({ settings: { ...get().settings, ...next } });
      },
      toast(text, tone = 'info') {
        const id = toastSeq++;
        set({ toasts: [...get().toasts, { id, text, tone }] });
        setTimeout(() => get().dismissToast(id), 3200);
      },
      dismissToast(id) {
        set({ toasts: get().toasts.filter((t) => t.id !== id) });
      },
    }),
    {
      name: 'orbit:shell:v1',
      storage: createJSONStorage(() => localStorage),
      // Only preferences persist. Running apps start fresh after a reload.
      // "Show NSFW" never outlives the visit: every time Orbit opens, NSFW is hidden again (a fail-safe).
      partialize: (s) => ({ settings: { ...s.settings, nsfwView: undefined }, split: { ...s.split, enabled: false } }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ShellState>;
        return {
          ...current,
          settings: migrate({ ...DEFAULT_SETTINGS, ...(p.settings ?? {}) }),
          split: { ...DEFAULT_SPLIT, ...(p.split ?? {}), enabled: false },
        };
      },
    },
  ),
);

function migrate(s: Settings): Settings {
  const m = s.motion === 'system' && !s.motionPicked ? { ...s, motion: 'full' as const } : s;
  // Everyone is on MagStyle (a saved "classic" moves over), except the test suite's classic runs.
  if (classicAllowed()) return { ...m, skin: s.skin === 'o5' ? 'o5' : 'classic' };
  return { ...m, skin: 'o5' };
}

export const APP_ORDER: AppId[] = ['terminal', 'editor', 'agent', 'ai', 'store', 'soreal', 'lab', 'playground', 'vscode', 'desktop', 'windows', 'settings'];
