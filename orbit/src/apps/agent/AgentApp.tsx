import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppProps } from '../types';
import { connection, getRunner } from '../../services';
import type {
  Project,
  RunHandle,
  RunnerAdapter,
  RunnerCapabilities,
  RunnerMode,
  SendHandlers,
  SessionSummary,
  TranscriptItem,
} from '../../services/runner/types';
import { useShell } from '../../state/shell';
import { useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';
import { AppHeader, ConfirmSheet, DemoChip, EmptyState, IconButton, PromptSheet } from '../../ui/components';
import { Composer, type ModelsState } from './Composer';
import { ErrorBanner, Sidebar, type Loadable } from './Sidebar';
import { SignInHint, Transcript } from './Transcript';
import { CapabilitiesSheet, NewSessionSheet, SessionInfoSheet, type NewSessionValues } from './sheets';
import { agentSummary, errorMessage, isSignInError, mergeItem, statusLabel, titleFromText } from './model';
import './agent.css';

/** HostRunner can follow a turn that was started elsewhere (other device, or before a reload). */
type WatchFn = (
  sessionId: string,
  handlers: Pick<SendHandlers, 'onItem' | 'onUpdate' | 'onDone'>,
  signal?: AbortSignal,
) => Promise<void>;
type Watchable = RunnerAdapter & { watch: WatchFn };
/** Optional: stop a turn by session id (needed to stop a turn this page only watches). */
type StoppableBySession = RunnerAdapter & { stopSession: (sessionId: string) => Promise<unknown> };

const canWatch = (r: RunnerAdapter): r is Watchable => typeof (r as Partial<Watchable>).watch === 'function';
const canStopBySession = (r: RunnerAdapter): r is StoppableBySession =>
  typeof (r as Partial<StoppableBySession>).stopSession === 'function';

interface Conv {
  status: 'loading' | 'ready' | 'error';
  items: TranscriptItem[];
  error?: string;
}

interface SendError {
  message: string;
  /** The text to send again; null when the message reached the runner (only a refresh makes sense). */
  text: string | null;
}

type Dialog =
  | { kind: 'caps' }
  | { kind: 'new' }
  | { kind: 'info'; session: SessionSummary }
  | { kind: 'rename'; session: SessionSummary }
  | { kind: 'delete'; session: SessionSummary }
  | null;

const PREFS_KEY = 'orbit:agent:ui:v1';

function readPrefs(): Record<string, { projectId?: string }> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}
function writePrefs(mode: string, projectId: string) {
  try {
    const all = readPrefs();
    all[mode] = { ...all[mode], projectId };
    localStorage.setItem(PREFS_KEY, JSON.stringify(all));
  } catch {
    /* storage blocked: the choice just isn't remembered */
  }
}

const byUpdated = (a: SessionSummary, b: SessionSummary) => b.updatedAt - a.updatedAt;

function without<T>(rec: Record<string, T>, key: string): Record<string, T> {
  if (!(key in rec)) return rec;
  const next = { ...rec };
  delete next[key];
  return next;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall back to a hidden textarea (older Safari, or no clipboard permission).
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand?.('copy');
  ta.remove();
  if (!ok) throw new Error('Copy is not available here.');
}

const SUGGESTIONS = [
  'Explain how this project is laid out',
  'Plan how to add a /health endpoint',
  'Why might the tests be failing?',
  'What does src/app.py do?',
];

/**
 * Antigravity: chat and session manager for the Antigravity CLI (agy), through getRunner():
 * the real CLI on the Linux machine (host mode) or canned, labelled replies (demo mode).
 *
 * Stays mounted while open, so drafts, transcripts and in-flight turns survive app switching.
 */
export default function AgentApp({ placement, compact }: AppProps) {
  const runner = useMemo(() => getRunner(), []);
  const demo = connection.mode === 'demo';
  const hostMode = connection.mode === 'host';
  const visible = placement !== 'hidden';
  const toast = useShell((s) => s.toast);
  const intent = useWorkspace((s) => s.intent);
  const modelsNote = (runner as { modelsNote?: string }).modelsNote;

  const [caps, setCaps] = useState<RunnerCapabilities>(runner.capabilities);
  const [projects, setProjects] = useState<Loadable<Project[]>>({ status: 'loading' });
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Loadable<SessionSummary[]>>({ status: 'loading' });
  const [selected, setSelected] = useState<SessionSummary | null>(null);
  const [view, setView] = useState<'list' | 'chat'>('list');
  const [convs, setConvs] = useState<Record<string, Conv>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendErrors, setSendErrors] = useState<Record<string, SendError>>({});
  const [watchErrors, setWatchErrors] = useState<Record<string, string>>({});
  const [models, setModels] = useState<ModelsState>({ status: 'idle' });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [now, setNow] = useState(() => Date.now());
  const [scrollSignal, setScrollSignal] = useState(0);
  const [focusSignal, setFocusSignal] = useState(0);
  /** Sessions whose turn this page started (so it holds a RunHandle and can Stop). */
  const [ownRuns, setOwnRuns] = useState<ReadonlySet<string>>(() => new Set());
  const [stopping, setStopping] = useState<ReadonlySet<string>>(() => new Set());

  const runsRef = useRef(new Map<string, RunHandle>());
  const watchRef = useRef(new Map<string, AbortController>());
  const selectedRef = useRef<SessionSummary | null>(null);
  selectedRef.current = selected;
  const projectIdRef = useRef<string | null>(null);
  projectIdRef.current = projectId;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const convsRef = useRef(convs);
  convsRef.current = convs;
  const sessionsSeq = useRef(0);
  const handledIntent = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);

  const showChat = compact ? view === 'chat' && !!selected : true;
  /** The session whose conversation is on screen (watches follow only this one). */
  const openId = selected && showChat ? selected.id : null;
  const projectList = useMemo(() => (projects.status === 'ready' ? projects.data : []), [projects]);
  const projectsRef = useRef(projectList);
  projectsRef.current = projectList;
  /** Project name for a session (reads the latest list, so callbacks never see a stale one). */
  const projectName = useCallback(
    (id: string | null | undefined) => projectsRef.current.find((p) => p.id === id)?.name ?? id ?? '',
    [],
  );
  const openTerminal = useCallback(() => useShell.getState().launch('terminal'), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  useEffect(() => {
    mounted.current = true;
    const watches = watchRef.current;
    return () => {
      mounted.current = false;
      // Leaving for good: stop following turns. Turns this page started keep running in the runner.
      watches.forEach((ac) => ac.abort());
      watches.clear();
    };
  }, []);

  /* ------------------------------------------------------------------ state helpers */

  const syncOwnRuns = () => setOwnRuns(new Set(runsRef.current.keys()));

  /** A newer summary for a session: update the list (re-sorted) and the open session. */
  const patchSession = useCallback((s: SessionSummary) => {
    setSessions((prev) => {
      if (prev.status !== 'ready') return prev;
      const i = prev.data.findIndex((x) => x.id === s.id);
      if (i < 0) {
        return s.projectId === projectIdRef.current ? { status: 'ready', data: [s, ...prev.data].sort(byUpdated) } : prev;
      }
      const copy = prev.data.slice();
      copy[i] = s;
      return { status: 'ready', data: copy.sort(byUpdated) };
    });
    setSelected((cur) => (cur && cur.id === s.id ? s : cur));
  }, []);

  const applyItem = useCallback((sessionId: string, item: TranscriptItem) => {
    setConvs((c) => ({ ...c, [sessionId]: { status: 'ready', items: mergeItem(c[sessionId]?.items ?? [], item) } }));
  }, []);

  const setDraft = useCallback((sessionId: string, text: string) => {
    setDrafts((d) => (text ? { ...d, [sessionId]: text } : without(d, sessionId)));
  }, []);

  /* ------------------------------------------------------------------ loading */

  const loadProjects = useCallback(async () => {
    setProjects({ status: 'loading' });
    try {
      const list = await runner.listProjects();
      if (!mounted.current) return;
      setProjects({ status: 'ready', data: list });
      const remembered = readPrefs()[connection.mode]?.projectId;
      setProjectId((cur) => {
        if (cur && list.some((p) => p.id === cur)) return cur;
        if (remembered && list.some((p) => p.id === remembered)) return remembered;
        return list[0]?.id ?? null;
      });
    } catch (err) {
      if (mounted.current) setProjects({ status: 'error', message: errorMessage(err) });
    }
  }, [runner]);

  const loadTranscript = useCallback(
    async (id: string, silent: boolean) => {
      if (!silent) setConvs((c) => ({ ...c, [id]: { status: 'loading', items: c[id]?.items ?? [] } }));
      try {
        const items = await runner.getTranscript(id);
        // A live turn (started here or followed) owns the transcript now; its events are newer.
        if (!mounted.current || runsRef.current.has(id)) return;
        setConvs((c) => ({ ...c, [id]: { status: 'ready', items } }));
      } catch (err) {
        if (!mounted.current) return;
        setConvs((c) =>
          silent && c[id]?.status === 'ready'
            ? c
            : { ...c, [id]: { status: 'error', items: c[id]?.items ?? [], error: errorMessage(err) } },
        );
      }
    },
    [runner],
  );

  /** Re-read one session and its transcript from the runner (after an error or a finished watch). */
  const refreshOne = useCallback(
    async (id: string) => {
      try {
        const s = await runner.getSession(id);
        if (s && mounted.current) patchSession(s);
      } catch {
        /* keep what we have */
      }
      if (!runsRef.current.has(id)) await loadTranscript(id, true);
    },
    [runner, patchSession, loadTranscript],
  );

  const loadSessions = useCallback(
    async (pid: string, silent: boolean) => {
      const seq = ++sessionsSeq.current;
      if (!silent) setSessions({ status: 'loading' });
      try {
        const list = await runner.listSessions(pid);
        if (!mounted.current || seq !== sessionsSeq.current) return;
        setSessions({ status: 'ready', data: [...list].sort(byUpdated) });
        const cur = selectedRef.current;
        const fresh = cur && list.find((s) => s.id === cur.id);
        if (cur && fresh && (fresh.updatedAt !== cur.updatedAt || fresh.status !== cur.status)) {
          setSelected(fresh);
          // Changed elsewhere (another device): reload unless a live turn here owns the transcript.
          if (!runsRef.current.has(fresh.id) && !watchRef.current.has(fresh.id) && convsRef.current[fresh.id]) {
            void loadTranscript(fresh.id, true);
          }
        }
      } catch (err) {
        if (!mounted.current || seq !== sessionsSeq.current) return;
        if (!silent) setSessions({ status: 'error', message: errorMessage(err) });
      }
    },
    [runner, loadTranscript],
  );

  const loadModels = useCallback(async () => {
    if (runner.capabilities.models.status !== 'supported') return;
    setModels({ status: 'loading' });
    try {
      const list = await runner.listModels();
      if (mounted.current) setModels({ status: 'ready', list });
    } catch (err) {
      if (mounted.current) setModels({ status: 'error', message: errorMessage(err) });
    }
  }, [runner]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!projectId) return;
    writePrefs(connection.mode, projectId);
    void loadSessions(projectId, false);
  }, [projectId, loadSessions]);

  // Runner changes (this page, another app instance, or the other device via polling).
  useEffect(
    () =>
      runner.subscribe(() => {
        setCaps(runner.capabilities);
        const pid = projectIdRef.current;
        if (pid) void loadSessions(pid, true);
      }),
    [runner, loadSessions],
  );

  // Relative times ("5 min ago") stay current while visible.
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [visible]);

  // Wide layouts always show a conversation: open the most recent session if none is open.
  useEffect(() => {
    if (compact || selected || sessions.status !== 'ready' || sessions.data.length === 0) return;
    // The list may still be the previous project's for one render after switching.
    if (sessions.data[0].projectId !== projectId) return;
    setSelected(sessions.data[0]);
  }, [compact, selected, sessions, projectId]);

  // Opening a conversation: (re)load its transcript unless a live turn here owns it.
  useEffect(() => {
    if (!openId || runsRef.current.has(openId) || watchRef.current.has(openId)) return;
    void loadTranscript(openId, !!convsRef.current[openId]);
  }, [openId, loadTranscript]);

  // The model list is needed once a conversation (with its Model picker) is on screen.
  useEffect(() => {
    if (openId && models.status === 'idle') void loadModels();
  }, [openId, models.status, loadModels]);

  // Leaving a conversation stops following it.
  useEffect(() => {
    for (const [id, ac] of watchRef.current) {
      if (id !== openId) {
        ac.abort();
        watchRef.current.delete(id);
      }
    }
  }, [openId]);

  const startWatch = useCallback(
    (id: string) => {
      if (!canWatch(runner)) return;
      const ac = new AbortController();
      watchRef.current.set(id, ac);
      setWatchErrors((e) => without(e, id));
      const finish = () => {
        if (watchRef.current.get(id) !== ac) return false;
        watchRef.current.delete(id);
        return true;
      };
      runner
        .watch(
          id,
          {
            onItem: (item) => applyItem(id, item),
            onUpdate: (item) => applyItem(id, item),
            onDone: (summary) => {
              if (summary && typeof summary === 'object' && 'id' in summary) patchSession(summary);
            },
          },
          ac.signal,
        )
        .then(() => {
          // Finished (or nothing was running any more): load the final transcript.
          if (finish() && mounted.current) void refreshOne(id);
        })
        .catch((err: unknown) => {
          if (ac.signal.aborted || !finish() || !mounted.current) return;
          setWatchErrors((e) => ({ ...e, [id]: errorMessage(err) }));
        });
    },
    [runner, applyItem, patchSession, refreshOne],
  );

  // A conversation that is running but not started by this page: follow it (host runner's watch()).
  const openStatus = selected && selected.id === openId ? selected.status : null;
  const openConvStatus = openId ? convs[openId]?.status : undefined;
  useEffect(() => {
    if (!openId || openStatus !== 'running' || openConvStatus !== 'ready') return;
    if (runsRef.current.has(openId) || watchRef.current.has(openId) || watchErrors[openId]) return;
    startWatch(openId);
  }, [openId, openStatus, openConvStatus, watchErrors, startWatch]);

  /* ------------------------------------------------------------------ actions */

  const openSession = useCallback((s: SessionSummary) => {
    setSelected(s);
    setView('chat');
    setScrollSignal((n) => n + 1);
  }, []);

  // Every conversation that is opened goes to the home screen's "Recent sessions".
  useEffect(() => {
    const s = selectedRef.current;
    if (!openId || !s || s.id !== openId) return;
    useWorkspace.getState().noteSession({ id: s.id, title: s.title, projectName: projectName(s.projectId) });
  }, [openId, projectName, projects]);

  const chooseProject = (id: string) => {
    if (id === projectId) return;
    setProjectId(id);
    if (selected && selected.projectId !== id) {
      setSelected(null);
      setView('list');
    }
  };

  const goBack = () => {
    setView('list');
  };

  const send = useCallback(
    (sessionId: string, override?: string) => {
      const s = selectedRef.current;
      const text = (override ?? draftsRef.current[sessionId] ?? '').trim();
      if (!s || s.id !== sessionId || !text) return;
      if (s.status === 'running' || runsRef.current.has(sessionId)) return;
      setSendErrors((e) => without(e, sessionId));
      if (override === undefined) setDraft(sessionId, '');
      setScrollSignal((n) => n + 1);
      patchSession({ ...s, status: 'running' });

      let finished = false;
      let delivered = false;
      const end = () => {
        finished = true;
        runsRef.current.delete(sessionId);
        syncOwnRuns();
        setStopping((st) => {
          if (!st.has(sessionId)) return st;
          const next = new Set(st);
          next.delete(sessionId);
          return next;
        });
      };
      const handle = runner.send(sessionId, text, {
        onItem: (item) => {
          delivered = true;
          applyItem(sessionId, item);
        },
        onUpdate: (item) => applyItem(sessionId, item),
        onDone: (summary) => {
          end();
          patchSession(summary);
        },
        onError: (err) => {
          end();
          const message = errorMessage(err);
          setSendErrors((e) => ({ ...e, [sessionId]: { message, text: delivered ? null : text } }));
          // Nothing reached the runner: give the text back so it isn't lost.
          if (!delivered) setDrafts((d) => (d[sessionId]?.trim() ? d : { ...d, [sessionId]: text }));
          void refreshOne(sessionId);
        },
      });
      if (!finished) {
        runsRef.current.set(sessionId, handle);
        syncOwnRuns();
      }
    },
    [runner, applyItem, patchSession, refreshOne, setDraft],
  );

  const stop = useCallback(
    (sessionId: string) => {
      const handle = runsRef.current.get(sessionId);
      setStopping((st) => new Set(st).add(sessionId));
      if (handle) {
        handle.stop();
        return;
      }
      if (canStopBySession(runner)) {
        runner.stopSession(sessionId).catch((err: unknown) => {
          toast(`Couldn’t stop: ${errorMessage(err)}`, 'error');
          setStopping((st) => {
            const next = new Set(st);
            next.delete(sessionId);
            return next;
          });
        });
      }
    },
    [runner, toast],
  );

  // Clear "Stopping…" once the session is no longer running (e.g. a watched turn ended).
  useEffect(() => {
    if (selected && selected.status !== 'running' && stopping.has(selected.id)) {
      setStopping((st) => {
        const next = new Set(st);
        next.delete(selected.id);
        return next;
      });
    }
  }, [selected, stopping]);

  const changeSession = useCallback(
    async (id: string, patch: Partial<Pick<SessionSummary, 'title' | 'model' | 'mode'>>, what: string) => {
      try {
        const s = await runner.updateSession(id, patch);
        if (mounted.current) patchSession(s);
      } catch (err) {
        toast(`Couldn’t change the ${what}: ${errorMessage(err)}`, 'error');
      }
    },
    [runner, patchSession, toast],
  );

  const createSession = useCallback(
    async (v: NewSessionValues) => {
      const s = await runner.createSession(v.projectId, {
        title: v.title || undefined,
        mode: v.mode,
        model: v.model || undefined,
      });
      if (!mounted.current) return;
      setDialog(null);
      if (v.projectId !== projectIdRef.current) setProjectId(v.projectId);
      patchSession(s);
      openSession(s);
      setFocusSignal((n) => n + 1);
    },
    [runner, patchSession, openSession],
  );

  const deleteSession = useCallback(
    async (s: SessionSummary) => {
      setDialog(null);
      try {
        await runner.deleteSession(s.id);
      } catch (err) {
        toast(`Couldn’t delete “${s.title}”: ${errorMessage(err)}`, 'error');
        return;
      }
      runsRef.current.delete(s.id);
      syncOwnRuns();
      watchRef.current.get(s.id)?.abort();
      watchRef.current.delete(s.id);
      useWorkspace.getState().forgetSession(s.id);
      setDrafts((d) => without(d, s.id));
      setConvs((c) => without(c, s.id));
      setSendErrors((e) => without(e, s.id));
      setSessions((prev) => (prev.status === 'ready' ? { status: 'ready', data: prev.data.filter((x) => x.id !== s.id) } : prev));
      if (selectedRef.current?.id === s.id) {
        setSelected(null);
        setView('list');
      }
      toast(`Deleted “${s.title}”`, 'success');
    },
    [runner, toast],
  );

  const renameSession = useCallback(
    async (s: SessionSummary, title: string) => {
      const updated = await runner.updateSession(s.id, { title: title.trim() });
      if (!mounted.current) return;
      patchSession(updated);
      const ws = useWorkspace.getState();
      if (ws.recentSessions.some((r) => r.id === s.id)) {
        ws.noteSession({ id: s.id, title: updated.title, projectName: projectName(updated.projectId) });
      }
      setDialog(null);
    },
    [runner, patchSession, projectName],
  );

  const onCopy = useCallback(
    (text: string, what: string) => {
      copyText(text).then(
        () => toast(`${what} copied`, 'success'),
        (err: unknown) => toast(`Couldn’t copy: ${errorMessage(err)}`, 'error'),
      );
    },
    [toast],
  );

  /* ------------------------------------------------------------------ cross-app intents */

  useEffect(() => {
    if (!intent || intent.app !== 'agent' || handledIntent.current === intent.seq) return;
    handledIntent.current = intent.seq;
    const seq = intent.seq;
    void (async () => {
      try {
        if (intent.type === 'open-session') {
          const s = await runner.getSession(intent.sessionId);
          if (!mounted.current) return;
          if (!s) {
            useWorkspace.getState().forgetSession(intent.sessionId);
            toast('That Antigravity session no longer exists.', 'info');
            return;
          }
          if (s.projectId !== projectIdRef.current) setProjectId(s.projectId);
          openSession(s);
        } else if (intent.type === 'compose') {
          // Most recent session of the first project; start one if there is none.
          const list = await runner.listProjects();
          const first = list[0];
          if (!first) throw new Error('No project found for Antigravity.');
          const existing = (await runner.listSessions(first.id)).sort(byUpdated)[0];
          const target =
            existing ??
            (runner.capabilities.newConversation.status === 'supported'
              ? await runner.createSession(first.id, { title: titleFromText(intent.text) })
              : null);
          if (!target) throw new Error('New sessions aren’t available.');
          if (!mounted.current) return;
          if (first.id !== projectIdRef.current) setProjectId(first.id);
          setDrafts((d) => {
            const cur = d[target.id]?.trim() ? d[target.id] : '';
            return { ...d, [target.id]: cur ? `${cur}\n\n${intent.text}` : intent.text };
          });
          if (!existing) patchSession(target);
          openSession(target);
          setFocusSignal((n) => n + 1);
        }
      } catch (err) {
        toast(errorMessage(err), 'error');
      } finally {
        useWorkspace.getState().consumeIntent(seq);
      }
    })();
  }, [intent, runner, toast, openSession, patchSession]);

  // Focus the composer when asked (new session, compose intent), once it is on screen.
  useEffect(() => {
    if (!focusSignal) return;
    const t = setTimeout(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 50);
    return () => clearTimeout(t);
  }, [focusSignal]);

  // Phones: entering a conversation moves focus to Back (keyboard / VoiceOver users).
  const prevView = useRef(view);
  useEffect(() => {
    if (compact && view === 'chat' && prevView.current === 'list' && !focusSignal) backRef.current?.focus();
    prevView.current = view;
  }, [view, compact, focusSignal]);

  /* ------------------------------------------------------------------ App Switcher summary */

  useEffect(() => {
    const list = sessions.status === 'ready' ? sessions.data : [];
    const running = list.filter((s) => s.status === 'running');
    if (selected?.status === 'running' && !running.some((s) => s.id === selected.id)) running.unshift(selected);
    useWorkspace.getState().setSummary(
      'agent',
      agentSummary({
        sessionCount: sessions.status === 'ready' ? list.length : null,
        selected,
        running,
        drafts,
      }),
    );
  }, [sessions, selected, drafts]);

  /* ------------------------------------------------------------------ render */

  const conv = selected ? convs[selected.id] : undefined;
  const running = selected?.status === 'running';
  const sendError = selected ? sendErrors[selected.id] : undefined;
  const watchError = selected ? watchErrors[selected.id] : undefined;
  const ownsRun = selected ? ownRuns.has(selected.id) : false;
  const canStop = ownsRun || canStopBySession(runner);
  const sessionsEmpty = sessions.status === 'ready' && sessions.data.length === 0;
  const currentProject = projectList.find((p) => p.id === projectId);

  const title = showChat && selected ? selected.title : 'Antigravity';
  const subtitle =
    showChat && selected
      ? `${projectName(selected.projectId)} · ${running ? 'Running…' : statusLabel(selected)}`
      : currentProject
        ? `${currentProject.name}${sessions.status === 'ready' ? ` · ${sessions.data.length} session${sessions.data.length === 1 ? '' : 's'}` : ''}`
        : undefined;
  const chip = demo ? (
    <DemoChip text="Simulated" title="Replies are canned demo text. The Antigravity CLI is not called." />
  ) : !compact ? (
    <span className="chip ok">
      <span className="dot" aria-hidden />
      Linux machine
    </span>
  ) : null;

  const leading =
    compact && view === 'chat' && selected ? (
      <button
        type="button"
        ref={backRef}
        className="icon-btn ag-back"
        aria-label="Back to sessions"
        title="Back to sessions"
        onClick={goBack}
      >
        <Icon name="back" />
      </button>
    ) : undefined;

  const actions = (
    <>
      <IconButton icon="info" label="What's supported" onClick={() => setDialog({ kind: 'caps' })} />
      {showChat && selected && (
        <IconButton
          icon="more"
          label="Session info and actions"
          onClick={() => setDialog({ kind: 'info', session: selected })}
        />
      )}
    </>
  );

  const emptyConversation = selected ? (
    <div className="ag-start">
      <div className="state-icon" aria-hidden>
        <Icon name="sparkle" size={28} />
      </div>
      <h2 className="ag-start-title">Start the conversation</h2>
      <p className="ag-start-text">
        {demo
          ? 'Your first message starts a new conversation. Replies here are simulated: the Antigravity CLI is not called.'
          : `Your first message starts a new Antigravity conversation in ${projectName(selected.projectId)}.`}
      </p>
      <div className="ag-suggest" role="group" aria-label="Suggestions">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className="ag-suggestion"
            onClick={() => {
              setDraft(selected.id, s);
              setFocusSignal((n) => n + 1);
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  const transcriptHeader =
    conv?.status === 'error' ? (
      <ErrorBanner
        title="Couldn’t load this conversation"
        message={conv.error ?? ''}
        onRetry={() => selected && void loadTranscript(selected.id, false)}
      />
    ) : conv?.status === 'loading' && conv.items.length === 0 ? (
      <div className="ag-skel-convo" aria-busy="true" aria-label="Loading conversation">
        <span className="ag-skel ag-skel-bubble ag-skel-right" />
        <span className="ag-skel ag-skel-bubble ag-skel-tall" />
        <span className="ag-skel ag-skel-bubble ag-skel-right ag-skel-short" />
        <span className="ag-skel ag-skel-bubble" />
      </div>
    ) : null;

  const conversation = selected ? (
    <section className="ag-main" aria-label="Conversation">
      {watchError && (
        <div className="ag-banner-wrap">
          <ErrorBanner
            title="Lost track of the running turn"
            message={watchError}
            onRetry={() => {
              setWatchErrors((e) => without(e, selected.id));
              void refreshOne(selected.id);
            }}
          />
        </div>
      )}
      <Transcript
        sessionId={selected.id}
        items={conv?.items ?? []}
        demo={demo}
        hostMode={hostMode}
        visible={visible}
        now={now}
        onCopy={onCopy}
        onOpenTerminal={openTerminal}
        scrollSignal={scrollSignal}
        header={transcriptHeader}
        empty={conv?.status === 'ready' ? emptyConversation : null}
      />
      {sendError && (
        <div className="ag-banner-wrap">
          <ErrorBanner
            title={sendError.text === null ? 'The turn was interrupted' : 'Message not sent'}
            message={sendError.message}
            retryLabel={sendError.text === null ? 'Refresh' : 'Try again'}
            onRetry={() => {
              if (sendError.text === null) {
                setSendErrors((e) => without(e, selected.id));
                void refreshOne(selected.id);
              } else {
                setDraft(selected.id, '');
                send(selected.id, sendError.text);
              }
            }}
          />
          {hostMode && isSignInError(sendError.message) && <SignInHint onOpenTerminal={openTerminal} />}
        </div>
      )}
      <Composer
        session={selected}
        caps={caps}
        draft={drafts[selected.id] ?? ''}
        onDraft={(t) => setDraft(selected.id, t)}
        onSend={() => send(selected.id)}
        onStop={() => stop(selected.id)}
        running={running}
        canStop={canStop}
        stopping={stopping.has(selected.id)}
        models={models}
        modelsNote={modelsNote}
        onMode={(m: RunnerMode) => void changeSession(selected.id, { mode: m }, 'mode')}
        onModel={(m) => void changeSession(selected.id, { model: m }, 'model')}
        onRetryModels={() => void loadModels()}
        hostMode={hostMode}
        demo={demo}
        onOpenTerminal={openTerminal}
        textareaRef={textareaRef}
        visible={visible}
      />
    </section>
  ) : (
    <section className="ag-main ag-main-empty" aria-label="Conversation">
      {sessionsEmpty ? (
        <EmptyState
          icon="sparkle"
          title="Start a session"
          action={
            caps.newConversation.status === 'supported' ? (
              <button type="button" className="btn primary" onClick={() => setDialog({ kind: 'new' })}>
                <Icon name="plus" size={18} />
                New session
              </button>
            ) : undefined
          }
        >
          {`No sessions in ${currentProject?.name ?? 'this project'} yet. Each session is one Antigravity conversation.`}
        </EmptyState>
      ) : (
        <EmptyState icon="sparkle" title="No session open">
          Pick a session from the list, or start a new one.
        </EmptyState>
      )}
    </section>
  );

  return (
    <div className="ag-root" data-compact={compact} data-placement={placement}>
      <AppHeader title={title} subtitle={subtitle} leading={leading} chip={chip} actions={actions} />
      <div className="ag-layout">
        {(!compact || !showChat) && (
          <Sidebar
            projects={projects}
            projectId={projectId}
            onProject={chooseProject}
            onRetryProjects={() => void loadProjects()}
            sessions={sessions}
            onRetrySessions={() => projectId && void loadSessions(projectId, false)}
            selectedId={compact ? null : (selected?.id ?? null)}
            onOpen={openSession}
            onOptions={(s) => setDialog({ kind: 'info', session: s })}
            onNew={() => setDialog({ kind: 'new' })}
            newCap={caps.newConversation}
            drafts={drafts}
            now={now}
            demo={demo}
          />
        )}
        {showChat && conversation}
      </div>

      {dialog?.kind === 'caps' && (
        <CapabilitiesSheet caps={caps} runnerLabel={runner.label} demo={demo} onClose={closeDialog} />
      )}
      {dialog?.kind === 'new' && (
        <NewSessionSheet
          projects={projectList}
          initialProjectId={projectId}
          caps={caps}
          models={models}
          modelsNote={modelsNote}
          hostMode={hostMode}
          onLoadModels={loadModels}
          onOpenTerminal={openTerminal}
          onCreate={createSession}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'info' && (
        <SessionInfoSheet
          session={sessionById(dialog.session, sessions, selected)}
          projectName={projectName(dialog.session.projectId)}
          caps={caps}
          demo={demo}
          now={now}
          onRename={() => setDialog({ kind: 'rename', session: dialog.session })}
          onDelete={() => setDialog({ kind: 'delete', session: dialog.session })}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'rename' && (
        <PromptSheet
          title="Rename session"
          label="Title"
          initial={dialog.session.title}
          confirmLabel="Rename"
          validate={(v) => (v.trim() ? (v.trim().length > 120 ? 'Use 120 characters or fewer.' : null) : 'Enter a title.')}
          onSubmit={(v) => renameSession(dialog.session, v)}
          onCancel={closeDialog}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmSheet
          title="Delete session?"
          message={
            <>
              “{dialog.session.title}” and its transcript will be removed from{' '}
              {demo ? 'this browser' : 'your Linux machine (for all your devices)'}.
              {dialog.session.status === 'running' ? ' Its running turn will be stopped.' : ''} This can’t be undone.
            </>
          }
          confirmLabel="Delete"
          destructive
          onConfirm={() => void deleteSession(dialog.session)}
          onCancel={closeDialog}
        />
      )}
    </div>
  );
}

/** The freshest summary we hold for a session shown in a sheet. */
function sessionById(
  s: SessionSummary,
  sessions: Loadable<SessionSummary[]>,
  selected: SessionSummary | null,
): SessionSummary {
  if (selected?.id === s.id) return selected;
  if (sessions.status === 'ready') return sessions.data.find((x) => x.id === s.id) ?? s;
  return s;
}
