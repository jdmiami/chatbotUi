import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type AppId = 'terminal' | 'editor' | 'agent' | 'settings';
export type Overlay = null | 'switcher' | 'control-center';
export type ThemePref = 'system' | 'dark' | 'light';
export type AccentId = 'indigo' | 'teal' | 'amber' | 'rose' | 'sky';
export type WallpaperId = 'orbit' | 'dusk' | 'aurora' | 'graphite';
export type MotionPref = 'system' | 'reduce' | 'full';

export interface Settings {
  theme: ThemePref;
  accent: AccentId;
  wallpaper: WallpaperId;
  /** 0.9 – 1.3 */
  textScale: number;
  motion: MotionPref;
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
  motion: 'system',
  terminalFontSize: 14,
  terminalKeys: true,
  introSeen: false,
};

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
        set({ settings: { ...get().settings, ...patch } });
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
      partialize: (s) => ({ settings: s.settings, split: { ...s.split, enabled: false } }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ShellState>;
        return {
          ...current,
          settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
          split: { ...DEFAULT_SPLIT, ...(p.split ?? {}), enabled: false },
        };
      },
    },
  ),
);

export const APP_ORDER: AppId[] = ['terminal', 'editor', 'agent', 'settings'];
