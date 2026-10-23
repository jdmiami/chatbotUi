import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppId } from './shell';

/**
 * Cross-app plumbing:
 *  - `summaries`: one line per running app, shown in the App Switcher ("main.py — unsaved changes").
 *  - `recents`: recently opened files / sessions, shown on the home screen's Resume widget.
 *  - `intent`: a one-shot request from one app (or the home screen) to another, e.g. "open this file".
 *    The target app consumes it with `consumeIntent` once handled.
 */

export type Intent =
  | { seq: number; app: 'editor'; type: 'open-file'; path: string }
  | { seq: number; app: 'agent'; type: 'open-session'; sessionId: string }
  | { seq: number; app: 'agent'; type: 'compose'; text: string; /** project file it is about */ path?: string }
  /** Open the AI Store at a shelf (from the home, index, settings, the AI app…). */
  | { seq: number; app: 'store'; type: 'open'; shelf?: 'chat' | 'makers' | 'library' | 'downloads'; item?: string }
  /** Chat with this model in the AI app (from the store). */
  | { seq: number; app: 'ai'; type: 'use-model'; model: string }
  /** Open one chat (the orb's "find"). */
  | { seq: number; app: 'ai'; type: 'open-chat'; chatId: string };

type IntentInput = Intent extends infer I ? (I extends { seq: number } ? Omit<I, 'seq'> : never) : never;

export interface RecentFile {
  path: string;
  at: number;
}
export interface RecentSession {
  id: string;
  title: string;
  projectName: string;
  at: number;
}

interface WorkspaceState {
  summaries: Partial<Record<AppId, string>>;
  recentFiles: RecentFile[];
  recentSessions: RecentSession[];
  intent: Intent | null;

  setSummary(app: AppId, text: string | undefined): void;
  noteFile(path: string): void;
  forgetFile(path: string): void;
  noteSession(s: Omit<RecentSession, 'at'>): void;
  forgetSession(id: string): void;
  sendIntent(intent: IntentInput): void;
  consumeIntent(seq: number): void;
  clearRecents(): void;
}

let seq = 1;
const MAX_RECENTS = 6;

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      summaries: {},
      recentFiles: [],
      recentSessions: [],
      intent: null,

      setSummary(app, text) {
        if (get().summaries[app] === text) return;
        set({ summaries: { ...get().summaries, [app]: text } });
      },
      noteFile(path) {
        const rest = get().recentFiles.filter((f) => f.path !== path);
        set({ recentFiles: [{ path, at: Date.now() }, ...rest].slice(0, MAX_RECENTS) });
      },
      forgetFile(path) {
        set({ recentFiles: get().recentFiles.filter((f) => f.path !== path) });
      },
      noteSession(s) {
        const rest = get().recentSessions.filter((r) => r.id !== s.id);
        set({ recentSessions: [{ ...s, at: Date.now() }, ...rest].slice(0, MAX_RECENTS) });
      },
      forgetSession(id) {
        set({ recentSessions: get().recentSessions.filter((r) => r.id !== id) });
      },
      sendIntent(intent) {
        set({ intent: { ...intent, seq: seq++ } as Intent });
      },
      consumeIntent(s) {
        if (get().intent?.seq === s) set({ intent: null });
      },
      clearRecents() {
        set({ recentFiles: [], recentSessions: [] });
      },
    }),
    {
      name: 'orbit:workspace:v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ recentFiles: s.recentFiles, recentSessions: s.recentSessions }),
    },
  ),
);
