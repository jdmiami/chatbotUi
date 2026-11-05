import { useEffect, useRef, useState } from 'react';
import { useShell } from '../../state/shell';
import type { LocalAi, StudioMakerInfo } from '../../services/ai/LocalAi';
import { cloudText } from '../../services/ai/CloudAi';
import { Icon } from '../../ui/Icon';
import { TextArea } from '../../ui/TextArea';
import { BATCH_COUNTS, MAX_BATCH, batchMessages, parsePrompts, type BatchKind } from './batch';

/**
 * Batch making: describe an idea, a small cloud model (the NVIDIA one, unfiltered writing) writes as
 * many prompts as you ask for, you change or drop any of them, and Make all puts every one in the AI
 * machine's queue with the maker you pick. What is made lands in the gallery as usual.
 */
interface Row {
  id: number;
  text: string;
  /** After Make all: in the queue, or why it wasn't taken. */
  sent?: 'queued' | string;
}

let nextId = 1;

export function BatchMake({ ai, machineOn, isActive }: { ai: LocalAi; machineOn: boolean; isActive: boolean }) {
  const toast = useShell((s) => s.toast);
  const [idea, setIdea] = useState('');
  const [count, setCount] = useState<number>(8);
  const [kind, setKind] = useState<BatchKind>('image');
  const [makers, setMakers] = useState<StudioMakerInfo[]>([]);
  const [maker, setMaker] = useState<string>('');
  const [rows, setRows] = useState<Row[]>([]);
  const [writing, setWriting] = useState(false);
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const stop = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isActive || !machineOn) return;
    ai.studioMakers().then(setMakers, () => {});
  }, [ai, isActive, machineOn]);
  // Only makers that are here and make this kind of thing.
  const usable = makers.filter((m) => m.installed && (kind === 'video' ? m.kind === 'video' : m.kind === 'image'));
  useEffect(() => {
    if (!usable.some((m) => m.id === maker)) setMaker(usable[0]?.id ?? '');
  }, [usable.map((m) => m.id).join(','), maker]); // eslint-disable-line react-hooks/exhaustive-deps

  const write = async (more = false) => {
    if (!idea.trim() || writing) return;
    setWriting(true);
    stop.current = new AbortController();
    try {
      const have = more ? rows.map((r) => r.text) : [];
      const want = Math.min(count, MAX_BATCH - have.length);
      if (want <= 0) throw new Error(`That's the most at once (${MAX_BATCH}).`);
      const reply = await cloudText({ task: 'free', messages: batchMessages(idea.trim(), want, kind, have), maxTokens: Math.min(8192, 200 + want * 140), temperature: 0.9, signal: stop.current.signal });
      const list = parsePrompts(reply, want);
      if (list === null) throw new Error("That idea can't be made.");
      if (!list.length) throw new Error('The writer sent nothing usable. Try again, or say the idea another way.');
      const fresh = list.map((text) => ({ id: nextId++, text }));
      setRows((r) => (more ? [...r, ...fresh] : fresh));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast((err as Error).message, 'error');
    } finally {
      setWriting(false);
      stop.current = null;
    }
  };

  const edit = (id: number, text: string) => setRows((r) => r.map((x) => (x.id === id ? { ...x, text, sent: undefined } : x)));
  const drop = (id: number) => setRows((r) => r.filter((x) => x.id !== id));
  const add = () => setRows((r) => [...r, { id: nextId++, text: '' }]);

  const ready = rows.filter((r) => r.text.trim() && r.sent !== 'queued');
  const makeAll = async () => {
    if (!machineOn || !maker || !ready.length || sending) return;
    setSending({ done: 0, total: ready.length });
    let ok = 0;
    for (const row of ready) {
      try {
        await ai.createStudioJob({ kind, maker, prompt: row.text.trim(), ...(kind === 'video' ? { seconds: 5 } : { size: 'square' }) });
        ok += 1;
        setRows((r) => r.map((x) => (x.id === row.id ? { ...x, sent: 'queued' } : x)));
      } catch (err) {
        const why = (err as Error).message;
        setRows((r) => r.map((x) => (x.id === row.id ? { ...x, sent: why } : x)));
      }
      setSending((s) => (s ? { ...s, done: s.done + 1 } : s));
    }
    setSending(null);
    toast(ok === ready.length ? `All ${ok} are in the queue. They land in your gallery as they finish.` : `${ok} of ${ready.length} are in the queue. The rest say why.`, ok ? 'success' : 'error');
  };

  return (
    <div className="mk-batch">
      <p className="o5-kicker">Batch</p>
      <h2 className="o5-step-title">Many at once</h2>
      <p className="mk-batch-lead">Describe an idea. A small cloud model writes the prompts; change any of them, then make them all on your AI machine.</p>

      <TextArea value={idea} onChange={(e) => setIdea(e.target.value)} rows={3} placeholder="Neon city streets in the rain, film noir, different characters" aria-label="Your idea" />

      <div className="mk-batch-opts">
        <div className="mk-batch-group" role="group" aria-label="What to make">
          {(['image', 'video'] as const).map((k) => (
            <button key={k} type="button" className="make-pick-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
              <Icon name={k === 'video' ? 'film' : 'image'} size={16} /> {k === 'video' ? 'Videos' : 'Pictures'}
            </button>
          ))}
        </div>
        <div className="mk-batch-group" role="group" aria-label="How many">
          {BATCH_COUNTS.map((n) => (
            <button key={n} type="button" className="make-pick-chip" aria-pressed={count === n} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="mk-batch-acts">
        <button type="button" className="btn primary" disabled={!idea.trim() || writing} onClick={() => void write(false)}>
          <Icon name="sparkle" size={16} /> {writing ? 'Writing…' : rows.length ? `Write ${count} new prompts` : `Write ${count} prompts`}
        </button>
        {writing && (
          <button type="button" className="btn ghost" onClick={() => stop.current?.abort()}>
            Stop
          </button>
        )}
      </div>

      {rows.length > 0 && (
        <>
          <ol className="mk-batch-list" aria-label="Prompts">
            {rows.map((r, i) => (
              <li key={r.id} className={r.sent === 'queued' ? 'is-queued' : r.sent ? 'is-refused' : undefined}>
                <span className="mk-batch-n" aria-hidden>
                  {i + 1}
                </span>
                <TextArea value={r.text} onChange={(e) => edit(r.id, e.target.value)} rows={3} aria-label={`Prompt ${i + 1}`} />
                <button type="button" className="icon-btn" aria-label={`Remove prompt ${i + 1}`} onClick={() => drop(r.id)}>
                  <Icon name="close" size={16} />
                </button>
                {r.sent && <p className="mk-batch-sent">{r.sent === 'queued' ? 'In the queue' : r.sent}</p>}
              </li>
            ))}
          </ol>
          <div className="mk-batch-acts">
            <button type="button" className="btn ghost" onClick={add}>
              <Icon name="plus" size={16} /> Add one
            </button>
            <button type="button" className="btn ghost" disabled={!idea.trim() || writing || rows.length >= MAX_BATCH} onClick={() => void write(true)}>
              Write {count} more
            </button>
          </div>

          <div className="mk-batch-go">
            {!machineOn ? (
              <p className="mk-batch-lead">Turn your AI machine on to make them (the prompts stay here).</p>
            ) : usable.length ? (
              <label className="mk-batch-maker">
                <span>Maker</span>
                <select value={maker} onChange={(e) => setMaker(e.target.value)}>
                  {usable.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="mk-batch-lead">No {kind === 'video' ? 'video' : 'picture'} maker is loaded yet. Pick one in the bar at the top of Make.</p>
            )}
            <button type="button" className="btn primary" disabled={!machineOn || !maker || !ready.length || Boolean(sending)} onClick={() => void makeAll()}>
              {sending ? `Sending ${sending.done} of ${sending.total}…` : `Make all ${ready.length}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
