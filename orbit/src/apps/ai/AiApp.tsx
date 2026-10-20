import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AppProps } from '../types';
import { useShell } from '../../state/shell';
import { BANNER_KICKER } from './banner';
import { useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';
import { AppHeader, ConfirmSheet, IconButton, Segmented, Sheet } from '../../ui/components';
import { MessageBody } from '../agent/Transcript';
import { AiError, getLocalAi, type AiMachineStatus, type ChatMessage } from '../../services/ai/LocalAi';
import { loadChats, saveChats, newChat, titleFrom, toHistory, shown, branchChat, withWeb, type AiChat, type AiChatStore, type AiMessage } from './chats';
import { readAttachment, type Attachment } from './attach';
import { addFact, loadMemory, personaById, saveMemory, systemPrompt, type MemoryStore } from './memory';
import { Canvas } from './Canvas';
import { MemorySheet } from './MemorySheet';
import { VoiceMode } from './VoiceMode';
import { canSpeak, createSpeaker, unlockSpeech } from './speech';
import { cue } from '../../motion/feedback';
import { MemeLab } from './MemeLab';
import { CreateView } from './CreateView';
import { ModelPicker, useModelList } from './models';
import '../agent/agent.css';
import './ai.css';
import { AiOrb } from './AiOrb';
import { TextArea } from '../../ui/TextArea';
import { Censor } from '../../ui/Censor';
import { isNsfw } from '../../ui/nsfw';

const STATE_TEXT: Record<AiMachineStatus['state'], string> = {
  unconfigured: 'Not set up',
  off: 'Off',
  starting: 'Starting…',
  downloading: 'Downloading models…',
  on: 'Ready',
  error: 'Problem',
};

const SUGGESTIONS = [
  { icon: 'sparkle', label: 'Explain simply', prompt: 'Explain how large language models work, in simple words.' },
  { icon: 'code', label: 'Write code', prompt: 'Write a Python script that renames all photos in a folder by the date they were taken.' },
  { icon: 'bolt', label: 'Brainstorm', prompt: 'Give me 10 bold ideas for a weekend project.' },
  { icon: 'pencil', label: 'Tell a story', prompt: 'Write a short, gripping story that starts with a power cut.' },
] as const;

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function formatSecs(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** The message box grows with its text, up to a limit (then it scrolls). */
function grow(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, Math.max(120, window.innerHeight * 0.3))}px`;
}

function finePointer() {
  try {
    return window.matchMedia('(pointer: fine)').matches;
  } catch {
    return false;
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
}

/**
 * AI: chat with your own open-weights models on the AI machine (Open WebUI + Ollama on a GPU pod).
 * Chats are kept in this browser. The full playground (documents, web search, voice, images) and
 * the coding workspace open from the header.
 */
export default function AiApp({ isActive, compact, placement }: AppProps) {
  const ai = useMemo(() => getLocalAi(), []);
  const toast = useShell((s) => s.toast);
  // Orbit 0.5: no header or tabs, just "Talk · Make" and the orb; everything else is behind the orb.
  const o5 = useShell((s) => s.settings.skin === 'o5');
  // There is only ever one orb: with the orb on, it comes to rest where the AI's face was.
  const orbOn = useShell((s) => s.settings.orb !== false);
  const [orbMenu, setOrbMenu] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const setSummary = useWorkspace((s) => s.setSummary);
  const [status, setStatus] = useState<AiMachineStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [store, setStore] = useState<AiChatStore>(() => loadChats());
  const [models, setModels] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [powering, setPowering] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [mode, setMode] = useState<'chat' | 'create' | 'lab'>(() => {
    try {
      const m = sessionStorage.getItem('orbit:ai:mode');
      return m === 'create' || m === 'lab' ? m : 'chat';
    } catch {
      return 'chat';
    }
  });
  const [memory, setMemoryState] = useState<MemoryStore>(() => loadMemory());
  const setMemory = useCallback((fn: (m: MemoryStore) => MemoryStore) => {
    setMemoryState((prev) => {
      const next = fn(prev);
      saveMemory(next);
      return next;
    });
  }, []);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pictureMode, setPictureMode] = useState(false);
  const [webMode, setWebMode] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [listening, setListening] = useState<number | null>(null);
  const reader = useRef<ReturnType<typeof createSpeaker> | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [canvasFor, setCanvasFor] = useState<number | null>(null);
  const [compareFor, setCompareFor] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const chat = store.chats.find((c) => c.id === store.activeId) ?? null;
  const ready = status?.state === 'on';

  const update = useCallback((fn: (s: AiChatStore) => AiChatStore) => {
    setStore((prev) => {
      const next = fn(prev);
      saveChats(next);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      setStatus(await ai.status());
      setStatusError(null);
    } catch (err) {
      setStatusError((err as Error).message);
    }
  }, [ai]);

  useEffect(() => {
    if (!isActive) return;
    void refresh();
    const busyMachine = status && status.state !== 'on' && status.state !== 'off' && status.state !== 'unconfigured';
    const t = setInterval(refresh, busyMachine ? 5000 : 30000);
    return () => clearInterval(t);
  }, [isActive, refresh, status?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const modelStore = useModelList(ai, ready && isActive);
  // The Store is its own app now: models and makers are added there.
  const launchApp = useShell((s) => s.launch);
  const openStore = (shelf: 'chat' | 'makers') => {
    useWorkspace.getState().sendIntent({ app: 'store', type: 'open', shelf });
    launchApp('store');
  };
  // "Open Create" / "chat with this model" / "open this chat" from anywhere in Orbit (home, store, orb).
  const intent = useWorkspace((s) => s.intent);
  useEffect(() => {
    if (intent?.app !== 'ai') return;
    useWorkspace.getState().consumeIntent(intent.seq);
    if (intent.type === 'use-model') {
      chooseMode('chat');
      setModel(intent.model);
      if (ready) ai.loadModel(intent.model).catch(() => {});
    } else if (intent.type === 'open-chat') {
      const id = intent.chatId;
      chooseMode('chat');
      update((s) => (s.chats.some((c) => c.id === id) ? { ...s, activeId: id } : s));
    } else if (intent.type === 'open-lab') {
      chooseMode('lab');
    } else {
      chooseMode('create');
    }
  }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps
  const installed = modelStore.list?.installed;
  useEffect(() => {
    if (!ready) return;
    ai.listModels()
      .then((list) => setModels(list))
      .catch(() => {});
  }, [ready, ai, installed?.length]);

  useEffect(() => {
    setSummary('ai', busy ? 'Answering…' : status ? `AI machine: ${(STATE_TEXT[status.state] ?? '').toLowerCase()}` : '');
  }, [busy, status, setSummary]);

  // Keep the newest text in view while it streams, unless the reader scrolled up to read.
  const follow = useRef(true);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(follow.current);
  };
  const toBottom = () => {
    const el = scroller.current;
    follow.current = true;
    setAtBottom(true);
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };
  // A clock for "loading the model… 12 s" while a reply hasn't started.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busy]);
  const [startedAt, setStartedAt] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [chat?.messages]);
  useEffect(() => {
    follow.current = true;
  }, [store.activeId]);

  const model = chat?.model || store.model || models[0] || '';
  const modelInfo = installed?.find((m) => m.name === model);

  const [speed, setSpeed] = useState<string | null>(null);
  const chooseMode = (m: 'chat' | 'create' | 'lab') => {
    setMode(m);
    try {
      sessionStorage.setItem('orbit:ai:mode', m);
    } catch {
      /* private mode */
    }
  };
  const power = async (action: 'start' | 'stop', tier?: string) => {
    setPowering(true);
    try {
      setStatus(await ai.power(action, tier));
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPowering(false);
    }
  };

  const startChat = () => {
    if (busy) return;
    update((s) => {
      const c = newChat(s.model || models[0] || '');
      return { ...s, chats: [c, ...s.chats], activeId: c.id };
    });
    setListOpen(false);
    setTimeout(() => input.current?.focus(), 0);
  };

  /**
   * Stream a reply. By default it is a new message at the end; with `alt` it is another model's
   * answer to message `alt.index` (Compare), shown next to the first one.
   */
  const run = async (
    chatId: string,
    history: ChatMessage[],
    useModel: string,
    alt?: { index: number },
    opts: { web?: string; onDelta?: (d: string) => void } = {},
  ) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    let altSlot = -1;
    const patchLast = (fn: (m: AiMessage) => AiMessage) =>
      update((s) => ({
        ...s,
        chats: s.chats.map((c) => {
          if (c.id !== chatId) return c;
          if (!alt) return { ...c, messages: [...c.messages.slice(0, -1), fn(c.messages[c.messages.length - 1])], updatedAt: Date.now() };
          return {
            ...c,
            updatedAt: Date.now(),
            messages: c.messages.map((m, i) => (i === alt.index ? { ...m, alts: (m.alts ?? []).map((a, j) => (j === altSlot ? fn(a) : a)) } : m)),
          };
        }),
      }));
    const fresh: AiMessage = { role: 'assistant', content: '', streaming: true, model: useModel, ...(opts.web ? { searching: true } : {}) };
    if (alt) {
      const target = store.chats.find((c) => c.id === chatId)?.messages[alt.index];
      altSlot = target?.alts?.length ?? 0;
      update((s) => ({
        ...s,
        chats: s.chats.map((c) =>
          c.id === chatId
            ? { ...c, messages: c.messages.map((m, i) => (i === alt.index ? { ...m, alts: [...(m.alts ?? []), fresh], pick: altSlot + 1 } : m)) }
            : c,
        ),
      }));
    } else
      update((s) => ({
        ...s,
        chats: s.chats.map((c) => (c.id === chatId ? { ...c, messages: [...c.messages, fresh] } : c)),
      }));
    const t0 = Date.now();
    setStartedAt(t0);
    setNow(t0);
    let firstToken = 0;
    let thinkStart = 0;
    let usage: { completionTokens: number } | null = null;
    try {
      if (opts.web) {
        // Web search first: the top pages go with the question, and the reply lists them as sources.
        try {
          const found = await ai.webSearch(opts.web, ctrl.signal);
          history = withWeb(history, found.results);
          patchLast((m) => ({ ...m, searching: false, sources: found.results.map((r) => ({ title: r.title, url: r.url })) }));
        } catch (err) {
          if (ctrl.signal.aborted) throw err;
          patchLast((m) => ({ ...m, searching: false, sources: [] }));
          toast(`Web search didn't work (${(err as Error).message}). Answering without it.`, 'info');
        }
      }
      await ai.chat(
        useModel,
        history,
        {
          onText: (d) => {
            opts.onDelta?.(d);
            const first = !firstToken;
            firstToken ||= Date.now();
            patchLast((m) => ({ ...m, content: m.content + d, ...(first && thinkStart ? { thinkMs: Date.now() - thinkStart } : {}) }));
          },
          onReasoning: (d) => {
            thinkStart ||= Date.now();
            firstToken ||= Date.now();
            patchLast((m) => ({ ...m, reasoning: (m.reasoning ?? '') + d }));
          },
          onUsage: (u) => (usage = u),
        },
        ctrl.signal,
      );
      const secs = firstToken ? (Date.now() - firstToken) / 1000 : 0;
      const u = usage as { completionTokens: number } | null;
      cue('done');
      patchLast((m) => ({
        ...m,
        streaming: false,
        ...(thinkStart && !m.thinkMs ? { thinkMs: Date.now() - thinkStart } : {}),
        ...(u && u.completionTokens && firstToken ? { stats: { tokens: u.completionTokens, perSecond: u.completionTokens / Math.max(secs, 0.05) } } : {}),
      }));
    } catch (err) {
      const stopped = ctrl.signal.aborted;
      if (!stopped) cue('error');
      patchLast((m) => ({
        ...m,
        streaming: false,
        error: stopped ? undefined : err instanceof AiError ? err.message : `Something went wrong: ${(err as Error).message}`,
        stopped,
      }));
      if (!stopped) void refresh();
    } finally {
      abort.current = null;
      setBusy(false);
    }
  };

  const attachmentsNow = attachments;
  const pictureNow = pictureMode;
  const editingNow = editing;
  const instructions = (c: AiChat | null) => systemPrompt(memory, c?.persona ?? memory.defaultPersona, c?.system);

  /** Create from chat: the message becomes a picture made by the image maker, shown in the chat. */
  const makePicture = async (chatId: string, prompt: string) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    const patchLast = (fn: (m: AiMessage) => AiMessage) =>
      update((s) => ({
        ...s,
        chats: s.chats.map((c) => (c.id === chatId ? { ...c, messages: [...c.messages.slice(0, -1), fn(c.messages[c.messages.length - 1])], updatedAt: Date.now() } : c)),
      }));
    update((s) => ({
      ...s,
      chats: s.chats.map((c) =>
        c.id === chatId ? { ...c, messages: [...c.messages, { role: 'assistant', content: '', streaming: true, model: 'Image maker', picture: { url: '', prompt, progress: 0 } }] } : c,
      ),
    }));
    let jobId = '';
    try {
      let job = await ai.createStudioJob({ kind: 'image', prompt, size: 'square' });
      jobId = job.id;
      const onAbort = () => void ai.cancelStudioJob(jobId).catch(() => {});
      ctrl.signal.addEventListener('abort', onAbort);
      while (job.status === 'queued' || job.status === 'running') {
        patchLast((m) => ({ ...m, picture: { ...m.picture!, jobId, progress: job.progress } }));
        await new Promise((r) => setTimeout(r, 2000));
        if (ctrl.signal.aborted) throw new Error('stopped');
        job = await ai.studioJob(jobId);
      }
      if (job.status !== 'done' || !job.item) throw new AiError(job.error || 'The picture could not be made.');
      const url = job.item.url;
      cue('done');
      patchLast((m) => ({ ...m, streaming: false, picture: { url, prompt, jobId, progress: 100 } }));
    } catch (err) {
      const stopped = ctrl.signal.aborted;
      if (!stopped) cue('error');
      patchLast((m) => ({ ...m, streaming: false, stopped, error: stopped ? undefined : (err as Error).message }));
    } finally {
      abort.current = null;
      setBusy(false);
    }
  };

  /** Send the message box (or, from a voice chat, the words you said). */
  const send = async (spoken?: { text: string; onDelta: (d: string) => void }) => {
    const text = spoken ? spoken.text.trim() : draft.trim();
    const attachments = spoken ? [] : attachmentsNow;
    const pictureMode = spoken ? false : pictureNow;
    const editing = spoken ? null : editingNow;
    if ((!text && !attachments.length) || busy) return;
    if (!ready) {
      toast('Turn on your AI machine first.', 'info');
      return;
    }
    if (!model && !pictureMode) {
      toast('No model yet: the AI machine is still downloading them.', 'info');
      return;
    }
    const images = attachments.flatMap((a) => (a.kind === 'image' ? [a.dataUrl] : []));
    const files = attachments.flatMap((a) => (a.kind === 'file' ? [{ name: a.name, text: a.text }] : []));
    if (images.length && !pictureMode && modelInfo && !modelInfo.vision) {
      const seeing = installed?.find((m) => m.vision)?.name;
      toast(`${model} can't see photos. ${seeing ? `Switch to ${seeing}` : 'Add a model that sees pictures from the model store'} to ask about them.`, 'info');
      return;
    }
    let target = chat;
    if (!target) {
      target = { ...newChat(model), persona: memory.defaultPersona };
      const created = target;
      update((s) => ({ ...s, chats: [created, ...s.chats], activeId: created.id }));
    }
    const chatId = target.id;
    // Editing a message: everything from it onwards is replaced by the new version.
    const before = editing != null ? target.messages.slice(0, editing) : target.messages;
    const userMsg: AiMessage = { role: 'user', content: text, ...(images.length ? { images } : {}), ...(files.length ? { files } : {}) };
    update((s) => ({
      ...s,
      model: model || s.model,
      chats: s.chats.map((c) =>
        c.id === chatId
          ? { ...c, model: model || c.model, title: before.length ? c.title : titleFrom(text || attachments[0]?.name || 'Photo'), messages: [...before, userMsg], updatedAt: Date.now() }
          : c,
      ),
    }));
    if (!spoken) {
      setDraft('');
      setAttachments([]);
      setEditing(null);
    }
    cue('send');
    const sendBtn = input.current?.closest('form')?.querySelector<HTMLElement>('.ai-send');
    if (sendBtn) {
      sendBtn.dataset.launch = 'true';
      setTimeout(() => delete sendBtn.dataset.launch, 600);
    }
    if (input.current) input.current.style.height = '';
    follow.current = true;
    setAtBottom(true);
    if (pictureMode) return makePicture(chatId, text);
    await run(chatId, toHistory([...before, userMsg], instructions(target)), model, undefined, { web: webMode && text ? text : undefined, onDelta: spoken?.onDelta });
  };

  const addFiles = async (list: FileList | File[] | null) => {
    const picked = Array.from(list ?? []).slice(0, 6);
    for (const f of picked) {
      try {
        const a = await readAttachment(f);
        setAttachments((prev) => [...prev, a].slice(0, 6));
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    }
  };

  // Voice chat: what you say is sent as a message and the reply streams back to be spoken.
  const sendRef = useRef(send);
  sendRef.current = send;
  const askByVoice = useCallback((text: string, onDelta: (d: string) => void) => sendRef.current({ text, onDelta }), []);

  /** Read one reply aloud (tap again to stop). */
  const listen = (index: number, text: string) => {
    reader.current?.stop();
    if (listening === index) return setListening(null);
    const sp = createSpeaker({ onDone: () => setListening((l) => (l === index ? null : l)) });
    reader.current = sp;
    setListening(index);
    sp.push(text);
    sp.end();
  };
  useEffect(() => () => reader.current?.stop(), []);

  const compareWith = async (other: string) => {
    if (!chat || compareFor == null || busy) return;
    const index = compareFor;
    setCompareFor(null);
    await run(chat.id, toHistory(chat.messages.slice(0, index), instructions(chat)), other, { index });
  };

  const pickAnswer = (index: number, pick: number) =>
    update((s) => ({ ...s, chats: s.chats.map((c) => (c.id === s.activeId ? { ...c, messages: c.messages.map((m, i) => (i === index ? { ...m, pick } : m)) } : c)) }));

  const branchFrom = (index: number) => {
    if (!chat || busy) return;
    const b = branchChat(chat, index);
    update((s) => ({ ...s, chats: [b, ...s.chats], activeId: b.id }));
    toast('Branched into a new chat. The original is unchanged.', 'success');
  };

  const editMessage = (index: number) => {
    if (!chat || busy) return;
    const m = chat.messages[index];
    setEditing(index);
    setDraft(m.content);
    setAttachments([
      ...(m.images ?? []).map((dataUrl, i) => ({ kind: 'image' as const, name: `photo ${i + 1}`, dataUrl })),
      ...(m.files ?? []).map((f) => ({ kind: 'file' as const, ...f })),
    ]);
    setTimeout(() => {
      if (input.current) {
        input.current.focus();
        grow(input.current);
      }
    }, 0);
  };

  const saveCanvas = (index: number, text: string) => {
    update((s) => ({
      ...s,
      chats: s.chats.map((c) =>
        c.id === s.activeId
          ? {
              ...c,
              messages: c.messages.map((m, i) => {
                if (i !== index) return m;
                if (m.pick && m.alts?.[m.pick - 1]) return { ...m, alts: m.alts.map((a, j) => (j === m.pick! - 1 ? { ...a, content: text } : a)) };
                return { ...m, content: text };
              }),
            }
          : c,
      ),
    }));
    setCanvasFor(null);
    toast('Updated in the chat.', 'success');
  };

  const regenerate = async () => {
    if (!chat || busy) return;
    const last = chat.messages[chat.messages.length - 1];
    const msgs = last?.role === 'assistant' ? chat.messages.slice(0, -1) : chat.messages;
    update((s) => ({ ...s, chats: s.chats.map((c) => (c.id === chat.id ? { ...c, messages: msgs } : c)) }));
    const prompt = msgs[msgs.length - 1];
    if (last?.picture && prompt?.role === 'user') return makePicture(chat.id, prompt.content);
    await run(chat.id, toHistory(msgs, instructions(chat)), model);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && finePointer()) {
      e.preventDefault();
      void send();
    }
  };

  const setModel = (m: string) =>
    update((s) => ({ ...s, model: m, chats: s.chats.map((c) => (c.id === s.activeId ? { ...c, model: m } : c)) }));

  const onCopy = (text: string, what: string) =>
    void copyText(text).then(() => toast(`Copied ${what}`, 'success'));

  const list = (
    <nav className="ai-list" aria-label="Chats">
      <button type="button" className="ai-new" onClick={startChat} disabled={busy}>
        <Icon name="plus" size={18} /> New chat
      </button>
      {store.chats.length === 0 && <p className="ai-muted">Your chats stay in this browser.</p>}
      <ul>
        {store.chats.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="ai-list-item"
              aria-current={c.id === store.activeId || undefined}
              onClick={() => {
                update((s) => ({ ...s, activeId: c.id }));
                setListOpen(false);
              }}
            >
              <span className="ai-list-title">{c.title}</span>
              <span className="ai-muted">{c.model || 'model'} · {new Date(c.updatedAt).toLocaleDateString()}</span>
            </button>
            <IconButton icon="trash" label={`Delete ${c.title}`} onClick={() => setConfirmDelete(c.id)} disabled={busy && c.id === store.activeId} />
          </li>
        ))}
      </ul>
    </nav>
  );

  const machine: AiMachineStatus = status ?? { state: 'off', costPerHour: null };
  const tiers = machine.tiers ?? [];
  const currentTier = tiers.find((t) => t.id === machine.tier) ?? tiers[0];
  const chosenTier = tiers.find((t) => t.id === speed) ?? currentTier;
  const cost = machine.costPerHour != null ? `$${machine.costPerHour.toFixed(2)}/h` : `$${(chosenTier?.pricePerHour ?? 0.59).toFixed(2)}/h`;

  return (
    <div className="ag-root ai-root" data-placement={placement}>
      {o5 ? (
        <div className="o5-ai-bar">
          <div className="o5-ai-modes" role="group" aria-label="Talk or make">
            {(['chat', 'create'] as const).map((m) => (
              <button key={m} type="button" className="o5-ai-mode" aria-pressed={mode === m} onClick={() => chooseMode(m)}>
                {m === 'chat' ? 'Talk' : 'Make'}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="o5-orb-btn"
            data-state={machine.state}
            data-busy={busy}
            aria-label={`Your AI: ${STATE_TEXT[machine.state]}${busy ? ', answering' : ''}. Open its menu.`}
            onClick={() => setOrbMenu(true)}
          >
            <span className={`ai-dot ai-dot-${machine.state}`} aria-hidden />
            <span className="o5-ai-menu-label">Menu</span>
          </button>
        </div>
      ) : (
        <>
      <AppHeader
          title="AI"
          subtitle={
            <span className="ai-status">
              <span className={`ai-dot ai-dot-${machine.state}`} aria-hidden />
              Your AI machine: {STATE_TEXT[machine.state]}
              {currentTier && tiers.length > 1 && machine.state !== 'off' ? ` · ${currentTier.label}` : ''}
              {machine.state === 'on' && machine.idle && !compact ? ` · turns off after ${machine.idle.limitMinutes} min unused` : ''}
            </span>
          }
          leading={compact && mode === 'chat' ? <IconButton icon="sidebar" label="Chats" onClick={() => setListOpen(true)} /> : undefined}
          actions={
            <>
              {mode === 'chat' && <IconButton icon="plus" label="New chat" onClick={startChat} disabled={busy} />}
              {mode === 'chat' && <IconButton icon="user" label="Personas & memory" onClick={() => setMemoryOpen(true)} />}
              <IconButton icon="download" label="Store" onClick={() => openStore('chat')} />
              <IconButton icon="external" label="Open the full AI playground" onClick={() => window.open('/ai', '_blank', 'noopener')} />
              <IconButton icon="code" label="Code with AI (VS Code)" onClick={() => window.open('/code', '_blank', 'noopener')} />
            </>
          }
        />
  
        <div className="ai-tabs">
          <Segmented
            label="Chat, create or lab"
            value={mode}
            onChange={(m) => {
              setMode(m);
              try {
                sessionStorage.setItem('orbit:ai:mode', m);
              } catch {
                /* private mode */
              }
            }}
            options={[
              { value: 'chat', label: 'Chat' },
              { value: 'create', label: 'Create' },
              { value: 'lab', label: 'Lab' },
            ]}
          />
        </div>
        </>
      )}

      {machine.state !== 'on' && (
        <div className={`ai-banner ai-banner-${machine.state}`} role="status">
          <p className="ai-banner-kicker">{BANNER_KICKER[machine.state] ?? 'Your AI machine'}</p>
          {machine.state === 'off' && (
            <>
              <p>
                Your AI machine is off. Turning it on takes 2–4 minutes and costs {cost} while on; it turns itself off after{' '}
                {chosenTier?.idleMinutes ?? 30} minutes unused.
              </p>
              {tiers.length > 1 && (
                <Segmented
                  label="Speed"
                  value={chosenTier?.id ?? tiers[0].id}
                  onChange={setSpeed}
                  options={tiers.map((t) => ({ value: t.id, label: `${t.label} · $${t.pricePerHour.toFixed(2)}/h` }))}
                />
              )}
              <button type="button" className="btn primary" onClick={() => void power('start', chosenTier?.id)} disabled={powering}>
                {powering ? 'Turning on…' : 'Turn on'}
              </button>
            </>
          )}
          {(machine.state === 'starting' || machine.state === 'downloading') && (
            <>
              <p>
                {machine.state === 'starting'
                  ? 'Starting your AI machine… usually 2–4 minutes.'
                  : 'First start: downloading the models (once).'}
                {machine.pulling ? ` ${machine.pulling.model}: ${machine.pulling.percent}%` : ''}
              </p>
              {machine.pulling && (
                <div className="ai-bar" aria-hidden>
                  <span style={{ width: `${machine.pulling.percent}%` }} />
                </div>
              )}
            </>
          )}
          {machine.state === 'unconfigured' && <p>{machine.detail ?? 'The AI machine is not set up yet.'}</p>}
          {machine.state === 'error' && (
            <>
              <p>{machine.detail ?? 'The AI machine has a problem.'}</p>
              <button type="button" className="btn" onClick={() => void power('start')} disabled={powering}>
                Try again
              </button>
            </>
          )}
          {statusError && <p className="ai-error">{statusError}</p>}
        </div>
      )}

      {mode === 'lab' && (
        <div className="ai-create lab-tab">
          <MemeLab ai={ai} machineOn={ready} isActive={isActive} />
        </div>
      )}

      {mode === 'create' && (
        <CreateView
          ai={ai}
          machineOn={ready}
          isActive={isActive}
          onOpenMakers={() => openStore('makers')}
        />
      )}

      <div className="ag-layout ai-layout" hidden={mode !== 'chat'}>
        {!compact && !o5 && <aside className="ai-side">{list}</aside>}
        <section className="ai-main" aria-label={chat?.title ?? 'New chat'}>
          <div
            className="ai-scroll"
            ref={scroller}
            onScroll={onScroll}
            onClick={
              o5
                ? (e) => {
                    // Orbit 0.5 keeps a message's actions out of sight until you tap that message.
                    const msg = (e.target as HTMLElement).closest<HTMLElement>('.ai-msg');
                    if (!msg || (e.target as HTMLElement).closest('button, a, textarea, input, summary')) return;
                    msg.dataset.open = msg.dataset.open === 'true' ? 'false' : 'true';
                  }
                : undefined
            }
          >
            {!chat || chat.messages.length === 0 ? (
              <div className="ai-hello" data-typing={draft.trim().length > 0}>
                {orbOn ? (
                  <div className="ai-hello-spot" data-orb-spot="hello" data-orb-size="76" />
                ) : (
                  <AiOrb typing={draft.trim().length > 0} />
                )}
                <h2>What can I help with?</h2>
                {personaById(memory, chat?.persona ?? memory.defaultPersona).id !== 'default' && (
                  <button type="button" className="ai-persona-badge" onClick={() => setMemoryOpen(true)}>
                    <Icon name="user" size={14} /> {personaById(memory, chat?.persona ?? memory.defaultPersona).name}
                  </button>
                )}
                <p className="ai-muted">
                  Private chat with your own models on your GPU machine. Nothing leaves it.
                </p>
                <div className="ai-suggest">
                  {SUGGESTIONS.map((sg) => (
                    <button
                      key={sg.label}
                      type="button"
                      className="ai-suggest-btn"
                      onClick={() => {
                        setDraft(sg.prompt);
                        setTimeout(() => input.current?.focus(), 0);
                      }}
                    >
                      <Icon name={sg.icon} size={18} />
                      <span>{sg.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              chat.messages.map((orig, i) => {
                const m = shown(orig);
                const last = i === chat.messages.length - 1;
                const waiting = m.streaming && !m.content && !m.reasoning && !m.picture;
                const waited = last && waiting ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
                const answers = orig.alts?.length ? [orig, ...orig.alts] : null;
                return (
                  <article key={i} className={`ai-msg ai-msg-${m.role}`} data-editing={editing === i || undefined}>
                    {m.role === 'assistant' && (
                      <div className="ai-msg-from">
                        <span className={`ai-avatar${m.streaming ? ' ai-avatar-live' : ''}`} aria-hidden>
                          <Icon name={m.picture ? 'image' : 'sparkle'} size={14} />
                        </span>
                        <span>{m.model || chat.model || 'AI'}</span>
                      </div>
                    )}
                    {answers && (
                      <div className="ai-compare" role="tablist" aria-label="Answers from different models">
                        {answers.map((a, j) => (
                          <button
                            key={j}
                            type="button"
                            role="tab"
                            aria-selected={(orig.pick ?? 0) === j}
                            className="ai-compare-tab"
                            onClick={() => pickAnswer(i, j)}
                          >
                            {a.model || `Answer ${j + 1}`}
                            {a.streaming && <span className="ai-dot ai-dot-starting" aria-hidden />}
                          </button>
                        ))}
                      </div>
                    )}
                    {m.role === 'assistant' && m.reasoning && (
                      <details className="ai-think" open={m.streaming && !m.content}>
                        <summary>
                          <span className={m.streaming && !m.content ? 'ai-shimmer' : undefined}>
                            {m.streaming && !m.content ? 'Thinking…' : m.thinkMs ? `Thought for ${formatSecs(m.thinkMs)}` : 'Thinking'}
                          </span>
                        </summary>
                        <p>{m.reasoning}</p>
                      </details>
                    )}
                    {m.role === 'user' ? (
                      <>
                        {(m.images?.length || m.files?.length) && (
                          <div className="ai-attached">
                            {m.images?.map((src, j) => <img key={j} src={src} alt={`Photo ${j + 1} you sent`} className="ai-attached-img" />)}
                            {m.files?.map((f) => (
                              <span key={f.name} className="ai-file-chip">
                                <Icon name="file" size={14} /> {f.name}
                              </span>
                            ))}
                          </div>
                        )}
                        {m.content && (
                          <Censor as="div" text nsfw={isNsfw(m.content)}>
                            <p className="ai-user-text">{m.content}</p>
                          </Censor>
                        )}
                      </>
                    ) : m.picture ? (
                      <figure className="ai-picture">
                        {m.picture.url ? (
                          <Censor as="div" nsfw={isNsfw(m.picture.prompt)}>
                            <img src={m.picture.url} alt={m.picture.prompt} />
                          </Censor>
                        ) : (
                          <div className="ai-picture-wait" role="status">
                            <span className="ai-shimmer">Making your picture… {Math.round(m.picture.progress ?? 0)}%</span>
                          </div>
                        )}
                        <figcaption className="ai-muted">{m.picture.prompt}</figcaption>
                      </figure>
                    ) : waiting ? (
                      <div className="ai-waiting" role="status">
                        <span className="ai-dots" aria-hidden>
                          <i />
                          <i />
                          <i />
                        </span>
                        {waited >= 4 && <span className="ai-muted">Loading the model into the GPU… {waited} s</span>}
                      </div>
                    ) : (
                      <Censor as="div" text nsfw={!m.streaming && isNsfw(m.content)} className={m.streaming ? 'ai-streaming' : undefined}>
                        <MessageBody text={m.content} onCopy={onCopy} />
                      </Censor>
                    )}
                    {m.searching && (
                      <p className="ai-searching ai-shimmer" role="status">
                        <Icon name="globe" size={14} /> Searching the web…
                      </p>
                    )}
                    {m.sources && m.sources.length > 0 && (
                      <ol className="ai-sources" aria-label="Sources">
                        {m.sources.map((src, j) => (
                          <li key={src.url}>
                            <a href={src.url} target="_blank" rel="noopener noreferrer" title={src.title}>
                              <span className="ai-source-n">{j + 1}</span>
                              <span className="ai-source-host">{hostOf(src.url)}</span>
                            </a>
                          </li>
                        ))}
                      </ol>
                    )}
                    {m.error && <p className="ai-error">{m.error}</p>}
                    {m.stopped && <p className="ai-muted">Stopped.</p>}
                    {m.role === 'user' && !busy && (
                      <div className="ai-msg-actions ai-msg-actions-user">
                        <button type="button" className="btn ghost small" onClick={() => editMessage(i)}>
                          <Icon name="pencil" size={16} /> Edit
                        </button>
                        <button type="button" className="btn ghost small" onClick={() => branchFrom(i)}>
                          <Icon name="split" size={16} /> Branch
                        </button>
                        {m.content && (
                          <button
                            type="button"
                            className="btn ghost small"
                            onClick={() => {
                              setMemory((mem) => addFact(mem, m.content));
                              toast('Remembered for future chats.', 'success');
                            }}
                          >
                            <Icon name="history" size={16} /> Remember
                          </button>
                        )}
                      </div>
                    )}
                    {m.role === 'assistant' && !m.streaming && (m.content || m.picture?.url) && (
                      <div className="ai-msg-actions">
                        {m.picture?.url ? (
                          <a className="btn ghost small" href={`${m.picture.url}${m.picture.url.includes('?') ? '&' : '?'}download=1`} download>
                            <Icon name="download" size={16} /> Save
                          </a>
                        ) : (
                          <button type="button" className="btn ghost small" onClick={() => onCopy(m.content, 'reply')}>
                            <Icon name="copy" size={16} /> Copy
                          </button>
                        )}
                        {last && !orig.alts?.length && (
                          <button type="button" className="btn ghost small" onClick={() => void regenerate()} disabled={busy || !ready}>
                            <Icon name="refresh" size={16} /> Again
                          </button>
                        )}
                        {!m.picture && canSpeak() && (
                          <button type="button" className="btn ghost small" onClick={() => listen(i, m.content)} aria-pressed={listening === i}>
                            <Icon name={listening === i ? 'stop' : 'speaker'} size={16} /> {listening === i ? 'Stop' : 'Listen'}
                          </button>
                        )}
                        {!m.picture && (
                          <>
                            <button type="button" className="btn ghost small" onClick={() => setCompareFor(i)} disabled={busy || !ready}>
                              <Icon name="switcher" size={16} /> Compare
                            </button>
                            <button type="button" className="btn ghost small" onClick={() => setCanvasFor(i)}>
                              <Icon name="text" size={16} /> Canvas
                            </button>
                          </>
                        )}
                        <button type="button" className="btn ghost small" onClick={() => branchFrom(i)} disabled={busy}>
                          <Icon name="split" size={16} /> Branch
                        </button>
                        {m.stats && (
                          <span className="ai-stats" title={`${m.stats.tokens} tokens`}>
                            <Icon name="bolt" size={14} /> {Math.round(m.stats.perSecond)} tokens/s
                          </span>
                        )}
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>

          <form
            className="ai-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            {!atBottom && chat && chat.messages.length > 0 && (
              <button type="button" className="ai-to-bottom" onClick={toBottom} aria-label="Jump to latest">
                <Icon name="down" size={20} />
              </button>
            )}
            <div
              className="ai-composer-card"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) e.preventDefault();
              }}
              onDrop={(e) => {
                if (!e.dataTransfer.files.length) return;
                e.preventDefault();
                void addFiles(e.dataTransfer.files);
              }}
            >
              {editing != null && (
                <div className="ai-editing" role="status">
                  <Icon name="pencil" size={14} /> Editing your message. Sending replaces it and the replies after it.
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => {
                      setEditing(null);
                      setDraft('');
                      setAttachments([]);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {attachments.length > 0 && (
                <ul className="ai-attachments" aria-label="Attached">
                  {attachments.map((a, j) => (
                    <li key={j} className="ai-attachment">
                      {a.kind === 'image' ? <img src={a.dataUrl} alt={a.name} /> : <span className="ai-file-chip"><Icon name="file" size={14} /> {a.name}</span>}
                      <button type="button" className="ai-attachment-x" aria-label={`Remove ${a.name}`} onClick={() => setAttachments((prev) => prev.filter((_, k) => k !== j))}>
                        <Icon name="close" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                accept="image/*,text/*,.md,.csv,.json,.yaml,.yml,.toml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.cs,.php,.sh,.sql,.log"
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <TextArea
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData.files);
                  if (files.length) {
                    e.preventDefault();
                    void addFiles(files);
                  }
                }}
                ref={input}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  grow(e.target);
                }}
                onKeyDown={onKey}
                rows={1}
                placeholder={!ready ? 'Turn on your AI machine to chat' : pictureMode ? 'Describe the picture to make…' : 'Message your model…'}
                aria-label="Message"
                enterKeyHint="send"
              />
              <div className="ai-composer-bar" data-tools={o5 ? (toolsOpen || webMode || pictureMode ? 'open' : 'folded') : undefined}>
                {o5 && (
                  <IconButton icon={toolsOpen ? 'close' : 'plus'} label={toolsOpen ? 'Hide tools' : 'Tools: photos, web, picture'} className="o5-tools-btn" aria-expanded={toolsOpen} onClick={() => setToolsOpen((v) => !v)} />
                )}
                <IconButton icon={o5 ? "upload" : "plus"} label="Add photos or files" className="o5-tool" onClick={() => fileInput.current?.click()} disabled={pictureMode} />
                <button
                  type="button"
                  className="ai-pill-toggle ai-pill-icon o5-tool"
                  aria-pressed={webMode}
                  aria-label="Search the web"
                  onClick={() => setWebMode((v) => !v)}
                  disabled={pictureMode}
                  title="Search the web before answering"
                >
                  <Icon name="globe" size={16} />
                </button>
                <button
                  type="button"
                  className="ai-pill-toggle o5-tool"
                  aria-pressed={pictureMode}
                  onClick={() => setPictureMode((v) => !v)}
                  title="Make a picture from your message"
                >
                  <Icon name="image" size={16} /> <span>Picture</span>
                </button>
                <button
                  type="button"
                  className="ai-model-chip o5-hide"
                  onClick={() => setPickerOpen(true)}
                  disabled={!ready}
                  aria-label={`Model: ${model || 'none'}. Change model`}
                >
                  <span className={`ai-live${modelInfo?.loaded ? '' : ' ai-live-off'}`} aria-hidden />
                  <span className="ai-model-chip-name">{model || (ready ? 'Choose a model' : 'Models appear when on')}</span>
                  <Icon name="down" size={14} />
                </button>
                {!busy && !draft.trim() && !attachments.length && !pictureMode ? (
                  <IconButton
                    icon="mic"
                    label="Talk"
                    className="ai-send ai-talk"
                    onClick={() => {
                      if (!ready || !model) return toast(ready ? 'No model yet.' : 'Turn on your AI machine first.', 'info');
                      unlockSpeech();
                      setVoiceOpen(true);
                    }}
                    disabled={!ready}
                  />
                ) : busy ? (
                  <IconButton icon="stop" label="Stop" className="ai-send ai-send-stop" onClick={() => abort.current?.abort()} />
                ) : (
                  <IconButton icon="send" label={pictureMode ? 'Make picture' : 'Send'} className="ai-send" type="submit" disabled={(!draft.trim() && (!attachments.length || pictureMode)) || !ready} />
                )}
              </div>
            </div>
          </form>
        </section>
      </div>

      {(compact || o5) && listOpen && mode === 'chat' && (
        <Sheet title="Chats" onClose={() => setListOpen(false)}>
          {list}
        </Sheet>
      )}
      {pickerOpen && (
        <ModelPicker
          ai={ai}
          list={modelStore.list}
          fallback={models}
          current={model}
          onPick={setModel}
          onOpenStore={() => {
            setPickerOpen(false);
            openStore('chat');
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {compareFor != null && (
        <ModelPicker
          ai={ai}
          list={modelStore.list}
          fallback={models}
          current={shown(chat?.messages[compareFor] ?? { role: 'assistant', content: '' }).model ?? model}
          onPick={(m) => void compareWith(m)}
          onOpenStore={() => {
            setCompareFor(null);
            openStore('chat');
          }}
          onClose={() => setCompareFor(null)}
        />
      )}
      {canvasFor != null && chat?.messages[canvasFor] && (
        <Canvas
          ai={ai}
          model={model}
          initial={shown(chat.messages[canvasFor]).content}
          onCopy={(t) => onCopy(t, 'document')}
          onSave={(t) => saveCanvas(canvasFor, t)}
          onClose={() => setCanvasFor(null)}
        />
      )}
      {orbMenu && (
        <Sheet title="Your AI" onClose={() => setOrbMenu(false)}>
          <div className="o5-orb-menu">
            <p className="o5-orb-status">
              <span className={`ai-dot ai-dot-${machine.state}`} aria-hidden /> {STATE_TEXT[machine.state]}
              {machine.state === 'on' && machine.costPerHour ? ` · $${machine.costPerHour.toFixed(2)}/h` : ''}
              {machine.state === 'on' && machine.idle ? ` · rests after ${machine.idle.limitMinutes} min unused` : ''}
            </p>
            <ul className="o5-orb-list">
              {(
                [
                  ['New conversation', 'A clean page', startChat, busy],
                  ['Conversations', `${store.chats.length} kept in this browser`, () => setListOpen(true), false],
                  ['Model', model || (ready ? 'Choose one' : 'Appears when the machine is on'), () => setPickerOpen(true), !ready],
                  ['Talk out loud', 'A voice conversation', () => { unlockSpeech(); setVoiceOpen(true); }, !ready || !model],
                  ['Personas & memory', 'Who it is, what it remembers', () => setMemoryOpen(true), false],
                  ['Store', 'Chat models, with every detail', () => openStore('chat'), false],
                  ['Makers', 'Picture and video makers, in the Store', () => openStore('makers'), false],
                  ['Full playground', 'Opens in a new tab', () => window.open('/ai', '_blank', 'noopener'), false],
                  ['Code with AI', 'VS Code in a new tab', () => window.open('/code', '_blank', 'noopener'), false],
                ] as const
              ).map(([label, hint, run, off]) => (
                <li key={label}>
                  <button
                    type="button"
                    className="o5-go"
                    disabled={off}
                    onClick={() => {
                      setOrbMenu(false);
                      if (label === 'New conversation' || label === 'Conversations') chooseMode('chat');
                      run();
                    }}
                  >
                    <span className="o5-go-label">{label}</span>
                    <span className="o5-go-hint">{hint}</span>
                    <Icon name="forward" size={20} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Sheet>
      )}

      {voiceOpen && <VoiceMode ai={ai} onAsk={askByVoice} onClose={() => setVoiceOpen(false)} />}
      {memoryOpen && (
        <MemorySheet
          memory={memory}
          setMemory={setMemory}
          chatPersona={chat ? (chat.persona ?? memory.defaultPersona) : null}
          setChatPersona={
            chat
              ? (id) => update((s) => ({ ...s, chats: s.chats.map((c) => (c.id === chat.id ? { ...c, persona: id } : c)) }))
              : null
          }
          onClose={() => setMemoryOpen(false)}
        />
      )}
      {confirmDelete && (
        <ConfirmSheet
          title="Delete this chat?"
          message="It is removed from this browser."
          confirmLabel="Delete"
          destructive
          onConfirm={() => {
            update((s) => {
              const chats = s.chats.filter((c) => c.id !== confirmDelete);
              return { ...s, chats, activeId: s.activeId === confirmDelete ? (chats[0]?.id ?? null) : s.activeId };
            });
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
