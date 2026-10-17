import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AppProps } from '../types';
import { useShell } from '../../state/shell';
import { useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';
import { AppHeader, ConfirmSheet, IconButton, Segmented, Sheet } from '../../ui/components';
import { MessageBody } from '../agent/Transcript';
import { AiError, getLocalAi, type AiMachineStatus, type ChatMessage } from '../../services/ai/LocalAi';
import { loadChats, saveChats, newChat, titleFrom, type AiChat, type AiChatStore } from './chats';
import { CreateView } from './CreateView';
import { ModelPicker, ModelStore, useModelList } from './models';
import '../agent/agent.css';
import './ai.css';

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
  const [storeOpen, setStoreOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [mode, setMode] = useState<'chat' | 'create'>(() => {
    try {
      return sessionStorage.getItem('orbit:ai:mode') === 'create' ? 'create' : 'chat';
    } catch {
      return 'chat';
    }
  });
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
  const installed = modelStore.list?.installed;
  useEffect(() => {
    if (!ready) return;
    ai.listModels()
      .then((list) => setModels(list))
      .catch(() => {});
  }, [ready, ai, installed?.length]);

  useEffect(() => {
    setSummary('ai', busy ? 'Answering…' : status ? `AI machine: ${STATE_TEXT[status.state].toLowerCase()}` : '');
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

  const run = async (chatId: string, history: ChatMessage[], useModel: string) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    const patchLast = (fn: (m: AiChat['messages'][number]) => AiChat['messages'][number]) =>
      update((s) => ({
        ...s,
        chats: s.chats.map((c) => (c.id === chatId ? { ...c, messages: [...c.messages.slice(0, -1), fn(c.messages[c.messages.length - 1])], updatedAt: Date.now() } : c)),
      }));
    update((s) => ({
      ...s,
      chats: s.chats.map((c) =>
        c.id === chatId ? { ...c, messages: [...c.messages, { role: 'assistant', content: '', streaming: true, model: useModel }] } : c,
      ),
    }));
    const t0 = Date.now();
    setStartedAt(t0);
    setNow(t0);
    let firstToken = 0;
    let thinkStart = 0;
    let usage: { completionTokens: number } | null = null;
    try {
      await ai.chat(
        useModel,
        history,
        {
          onText: (d) => {
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
      patchLast((m) => ({
        ...m,
        streaming: false,
        ...(thinkStart && !m.thinkMs ? { thinkMs: Date.now() - thinkStart } : {}),
        ...(u && u.completionTokens && firstToken ? { stats: { tokens: u.completionTokens, perSecond: u.completionTokens / Math.max(secs, 0.05) } } : {}),
      }));
    } catch (err) {
      const stopped = ctrl.signal.aborted;
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

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (!ready) {
      toast('Turn on your AI machine first.', 'info');
      return;
    }
    if (!model) {
      toast('No model yet: the AI machine is still downloading them.', 'info');
      return;
    }
    let target = chat;
    if (!target) {
      target = newChat(model);
      const created = target;
      update((s) => ({ ...s, chats: [created, ...s.chats], activeId: created.id }));
    }
    const chatId = target.id;
    const history: ChatMessage[] = [
      ...(target.system ? [{ role: 'system' as const, content: target.system }] : []),
      ...target.messages.filter((m) => !m.error && m.content).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ];
    update((s) => ({
      ...s,
      model,
      chats: s.chats.map((c) =>
        c.id === chatId
          ? { ...c, model, title: c.messages.length ? c.title : titleFrom(text), messages: [...c.messages, { role: 'user', content: text }], updatedAt: Date.now() }
          : c,
      ),
    }));
    setDraft('');
    if (input.current) input.current.style.height = '';
    follow.current = true;
    setAtBottom(true);
    await run(chatId, history, model);
  };

  const regenerate = async () => {
    if (!chat || busy) return;
    const msgs = chat.messages[chat.messages.length - 1]?.role === 'assistant' ? chat.messages.slice(0, -1) : chat.messages;
    update((s) => ({ ...s, chats: s.chats.map((c) => (c.id === chat.id ? { ...c, messages: msgs } : c)) }));
    const history: ChatMessage[] = [
      ...(chat.system ? [{ role: 'system' as const, content: chat.system }] : []),
      ...msgs.filter((m) => !m.error && m.content).map((m) => ({ role: m.role, content: m.content })),
    ];
    await run(chat.id, history, model);
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
            {mode === 'chat' && <IconButton icon="download" label="Model store" onClick={() => setStoreOpen(true)} disabled={!ready} />}
            <IconButton icon="external" label="Open the full AI playground" onClick={() => window.open('/ai', '_blank', 'noopener')} />
            <IconButton icon="code" label="Code with AI (VS Code)" onClick={() => window.open('/code', '_blank', 'noopener')} />
          </>
        }
      />

      <div className="ai-tabs">
        <Segmented
          label="Chat or create"
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
          ]}
        />
      </div>

      {machine.state !== 'on' && (
        <div className={`ai-banner ai-banner-${machine.state}`} role="status">
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

      {mode === 'create' && <CreateView ai={ai} machineOn={ready} isActive={isActive} />}

      <div className="ag-layout ai-layout" hidden={mode !== 'chat'}>
        {!compact && <aside className="ai-side">{list}</aside>}
        <section className="ai-main" aria-label={chat?.title ?? 'New chat'}>
          <div className="ai-scroll" ref={scroller} onScroll={onScroll}>
            {!chat || chat.messages.length === 0 ? (
              <div className="ai-hello">
                <div className="ai-orb" aria-hidden />
                <h2>What can I help with?</h2>
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
              chat.messages.map((m, i) => {
                const last = i === chat.messages.length - 1;
                const waiting = m.streaming && !m.content && !m.reasoning;
                const waited = last && waiting ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
                return (
                  <article key={i} className={`ai-msg ai-msg-${m.role}`}>
                    {m.role === 'assistant' && (
                      <div className="ai-msg-from">
                        <span className={`ai-avatar${m.streaming ? ' ai-avatar-live' : ''}`} aria-hidden>
                          <Icon name="sparkle" size={14} />
                        </span>
                        <span>{m.model || chat.model || 'AI'}</span>
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
                      <p className="ai-user-text">{m.content}</p>
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
                      <div className={m.streaming ? 'ai-streaming' : undefined}>
                        <MessageBody text={m.content} onCopy={onCopy} />
                      </div>
                    )}
                    {m.error && <p className="ai-error">{m.error}</p>}
                    {m.stopped && <p className="ai-muted">Stopped.</p>}
                    {m.role === 'assistant' && !m.streaming && m.content && (
                      <div className="ai-msg-actions">
                        <button type="button" className="btn ghost small" onClick={() => onCopy(m.content, 'reply')}>
                          <Icon name="copy" size={16} /> Copy
                        </button>
                        {last && (
                          <button type="button" className="btn ghost small" onClick={() => void regenerate()} disabled={busy || !ready}>
                            <Icon name="refresh" size={16} /> Again
                          </button>
                        )}
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
            <div className="ai-composer-card">
              <textarea
                ref={input}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  grow(e.target);
                }}
                onKeyDown={onKey}
                rows={1}
                placeholder={ready ? 'Message your model…' : 'Turn on your AI machine to chat'}
                aria-label="Message"
                enterKeyHint="send"
              />
              <div className="ai-composer-bar">
                <button
                  type="button"
                  className="ai-model-chip"
                  onClick={() => setPickerOpen(true)}
                  disabled={!ready}
                  aria-label={`Model: ${model || 'none'}. Change model`}
                >
                  <span className={`ai-live${modelInfo?.loaded ? '' : ' ai-live-off'}`} aria-hidden />
                  <span className="ai-model-chip-name">{model || (ready ? 'Choose a model' : 'Models appear when on')}</span>
                  <Icon name="down" size={14} />
                </button>
                {busy ? (
                  <IconButton icon="stop" label="Stop" className="ai-send ai-send-stop" onClick={() => abort.current?.abort()} />
                ) : (
                  <IconButton icon="send" label="Send" className="ai-send" type="submit" disabled={!draft.trim() || !ready} />
                )}
              </div>
            </div>
          </form>
        </section>
      </div>

      {compact && listOpen && mode === 'chat' && (
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
            setStoreOpen(true);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {storeOpen && <ModelStore ai={ai} list={modelStore.list} refresh={modelStore.refresh} onClose={() => setStoreOpen(false)} />}
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
