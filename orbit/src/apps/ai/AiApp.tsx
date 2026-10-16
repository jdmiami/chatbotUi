import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AppProps } from '../types';
import { useShell } from '../../state/shell';
import { useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';
import { AppHeader, ConfirmSheet, EmptyState, IconButton, Sheet } from '../../ui/components';
import { MessageBody } from '../agent/Transcript';
import { AiError, getLocalAi, type AiMachineStatus, type ChatMessage } from '../../services/ai/LocalAi';
import { loadChats, saveChats, newChat, titleFrom, type AiChat, type AiChatStore } from './chats';
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

  useEffect(() => {
    if (!ready) return;
    ai.listModels()
      .then((list) => setModels(list))
      .catch(() => {});
  }, [ready, ai]);

  useEffect(() => {
    setSummary('ai', busy ? 'Answering…' : status ? `AI machine: ${STATE_TEXT[status.state].toLowerCase()}` : '');
  }, [busy, status, setSummary]);

  // Keep the newest text in view while it streams, unless the reader scrolled up to read.
  const follow = useRef(true);
  const onScroll = () => {
    const el = scroller.current;
    if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    const el = scroller.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [chat?.messages]);
  useEffect(() => {
    follow.current = true;
  }, [store.activeId]);

  const model = chat?.model || store.model || models[0] || '';

  const power = async (action: 'start' | 'stop') => {
    setPowering(true);
    try {
      setStatus(await ai.power(action));
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
      chats: s.chats.map((c) => (c.id === chatId ? { ...c, messages: [...c.messages, { role: 'assistant', content: '', streaming: true }] } : c)),
    }));
    try {
      await ai.chat(
        useModel,
        history,
        {
          onText: (d) => patchLast((m) => ({ ...m, content: m.content + d })),
          onReasoning: (d) => patchLast((m) => ({ ...m, reasoning: (m.reasoning ?? '') + d })),
        },
        ctrl.signal,
      );
      patchLast((m) => ({ ...m, streaming: false }));
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
    follow.current = true;
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

  const machine = status ?? { state: 'off' as const, costPerHour: null };
  const cost = machine.costPerHour != null ? `$${machine.costPerHour.toFixed(2)}/h` : '$0.59/h';

  return (
    <div className="ag-root ai-root" data-placement={placement}>
      <AppHeader
        title="AI"
        subtitle={
          <span className="ai-status">
            <span className={`ai-dot ai-dot-${machine.state}`} aria-hidden />
            Your AI machine: {STATE_TEXT[machine.state]}
            {machine.state === 'on' && machine.idle && !compact ? ` · turns off after ${machine.idle.limitMinutes} min unused` : ''}
          </span>
        }
        leading={compact ? <IconButton icon="sidebar" label="Chats" onClick={() => setListOpen(true)} /> : undefined}
        actions={
          <>
            <IconButton icon="plus" label="New chat" onClick={startChat} disabled={busy} />
            <IconButton icon="external" label="Open the full AI playground" onClick={() => window.open('/ai', '_blank', 'noopener')} />
            <IconButton icon="code" label="Code with AI (VS Code)" onClick={() => window.open('/code', '_blank', 'noopener')} />
          </>
        }
      />

      {machine.state !== 'on' && (
        <div className={`ai-banner ai-banner-${machine.state}`} role="status">
          {machine.state === 'off' && (
            <>
              <p>
                Your AI machine is off. Turning it on takes 2–4 minutes and costs {cost} while on; it turns itself off after
                30 minutes unused.
              </p>
              <button type="button" className="btn primary" onClick={() => void power('start')} disabled={powering}>
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

      <div className="ag-layout ai-layout">
        {!compact && <aside className="ai-side">{list}</aside>}
        <section className="ai-main" aria-label={chat?.title ?? 'New chat'}>
          <div className="ai-scroll" ref={scroller} onScroll={onScroll}>
            {!chat || chat.messages.length === 0 ? (
              <EmptyState icon="sparkle" title="Chat with your own models">
                Private, open-weights models on your GPU machine. For documents, web search and voice, open the full
                playground (↗ in the header).
              </EmptyState>
            ) : (
              chat.messages.map((m, i) => (
                <article key={i} className={`ai-msg ai-msg-${m.role}`}>
                  {m.role === 'assistant' && m.reasoning && (
                    <details className="ai-think" open={m.streaming && !m.content}>
                      <summary>Thinking</summary>
                      <p>{m.reasoning}</p>
                    </details>
                  )}
                  {m.role === 'user' ? <p className="ai-user-text">{m.content}</p> : <MessageBody text={m.content || (m.streaming ? '…' : '')} onCopy={onCopy} />}
                  {m.error && <p className="ai-error">{m.error}</p>}
                  {m.stopped && <p className="ai-muted">Stopped.</p>}
                  {m.role === 'assistant' && !m.streaming && m.content && (
                    <div className="ai-msg-actions">
                      <button type="button" className="btn ghost small" onClick={() => onCopy(m.content, 'reply')}>
                        <Icon name="copy" size={16} /> Copy
                      </button>
                      {i === chat.messages.length - 1 && (
                        <button type="button" className="btn ghost small" onClick={() => void regenerate()} disabled={busy || !ready}>
                          <Icon name="refresh" size={16} /> Again
                        </button>
                      )}
                    </div>
                  )}
                </article>
              ))
            )}
          </div>

          <form
            className="ai-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className="ai-composer-row">
              <label className="ai-model">
                <span className="visually-hidden">Model</span>
                <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy || !models.length}>
                  {!models.length && <option value="">{ready ? 'Loading models…' : 'Models appear when the machine is on'}</option>}
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ai-composer-row">
              <textarea
                ref={input}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                rows={2}
                placeholder={ready ? 'Message your model…' : 'Turn on your AI machine to chat'}
                aria-label="Message"
                enterKeyHint="send"
              />
              {busy ? (
                <IconButton icon="stop" label="Stop" className="ai-send" onClick={() => abort.current?.abort()} />
              ) : (
                <IconButton icon="send" label="Send" className="ai-send" type="submit" disabled={!draft.trim() || !ready} />
              )}
            </div>
          </form>
        </section>
      </div>

      {compact && listOpen && (
        <Sheet title="Chats" onClose={() => setListOpen(false)}>
          {list}
        </Sheet>
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
