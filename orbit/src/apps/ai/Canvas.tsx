import { useRef, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/components';
import type { LocalAi } from '../../services/ai/LocalAi';

const QUICK = [
  { label: 'Shorter', ask: 'Make it about half as long. Keep every important point.' },
  { label: 'Longer', ask: 'Expand it with more detail and examples.' },
  { label: 'Simpler', ask: 'Rewrite it in simpler words for a beginner.' },
  { label: 'More formal', ask: 'Rewrite it in a polished, professional tone.' },
  { label: 'Fix & improve', ask: 'Fix any mistakes (spelling, grammar, bugs) and improve clarity. Keep the meaning and the format.' },
];

const SYSTEM =
  'You edit a document for the user. Apply their instruction to the whole document and reply with only the complete new document: no introduction, no explanation, no code fences around the whole thing.';

/**
 * Canvas: open a reply as an editable document, edit it by hand, or ask the model to rework it
 * (shorter, simpler, fix…). The new version streams in; Undo brings the previous one back.
 */
export function Canvas({
  ai,
  model,
  initial,
  onSave,
  onClose,
  onCopy,
}: {
  ai: LocalAi;
  model: string;
  initial: string;
  onSave: (text: string) => void;
  onClose: () => void;
  onCopy: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  const [history, setHistory] = useState<string[]>([]);
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const rework = async (instruction: string, label: string) => {
    if (busy || !instruction.trim() || !model) return;
    const before = text;
    setHistory((h) => [...h, before].slice(-20));
    setBusy(label);
    setError(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    let out = '';
    try {
      await ai.chat(
        model,
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Instruction: ${instruction}\n\nDocument:\n${before}` },
        ],
        { onText: (d) => setText((out += d)) },
        ctrl.signal,
      );
      if (!out.trim()) setText(before);
      setAsk('');
    } catch (err) {
      if (!ctrl.signal.aborted) setError((err as Error).message);
      if (!out.trim()) setText(before);
    } finally {
      abort.current = null;
      setBusy(null);
    }
  };

  const undo = () => {
    const prev = history[history.length - 1];
    if (prev == null) return;
    setHistory((h) => h.slice(0, -1));
    setText(prev);
  };

  return (
    <Sheet
      title="Canvas"
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
      footer={
        <div className="ai-canvas-foot">
          <button type="button" className="btn" onClick={undo} disabled={!history.length || Boolean(busy)}>
            <Icon name="undo" size={16} /> Undo
          </button>
          <button type="button" className="btn" onClick={() => onCopy(text)}>
            <Icon name="copy" size={16} /> Copy
          </button>
          <button type="button" className="btn primary" onClick={() => onSave(text)} disabled={Boolean(busy) || text === initial}>
            <Icon name="check" size={16} /> Put back in chat
          </button>
        </div>
      }
    >
      <div className="ai-canvas">
        <div className="ai-canvas-quick" role="group" aria-label="Rework the whole document">
          {QUICK.map((q) => (
            <button key={q.label} type="button" className="btn small" onClick={() => void rework(q.ask, q.label)} disabled={Boolean(busy) || !model}>
              {busy === q.label ? 'Working…' : q.label}
            </button>
          ))}
        </div>
        <textarea
          className="ai-canvas-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          readOnly={Boolean(busy)}
          aria-label="Document"
          aria-busy={Boolean(busy)}
        />
        <form
          className="ai-canvas-ask"
          onSubmit={(e) => {
            e.preventDefault();
            void rework(ask, 'custom');
          }}
        >
          <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask for a change… e.g. “add a table of prices”" aria-label="Change to make" />
          {busy ? (
            <button type="button" className="btn" onClick={() => abort.current?.abort()}>
              Stop
            </button>
          ) : (
            <button type="submit" className="btn primary" disabled={!ask.trim() || !model}>
              Apply
            </button>
          )}
        </form>
        {error && <p className="ai-error">{error}</p>}
      </div>
    </Sheet>
  );
}
