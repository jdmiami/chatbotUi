import { useState } from 'react';
import { Icon } from '../../ui/Icon';
import { IconButton, Sheet, Toggle } from '../../ui/components';
import { addFact, allPersonas, type MemoryStore } from './memory';

/** Personas (how the AI behaves) and memory (what it always knows about you), in one place. */
export function MemorySheet({
  memory,
  setMemory,
  chatPersona,
  setChatPersona,
  onClose,
}: {
  memory: MemoryStore;
  setMemory: (fn: (m: MemoryStore) => MemoryStore) => void;
  chatPersona: string | null;
  setChatPersona: ((id: string) => void) | null;
  onClose: () => void;
}) {
  const [fact, setFact] = useState('');
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const personas = allPersonas(memory);
  const current = chatPersona ?? memory.defaultPersona;

  return (
    <Sheet title="Personas & memory" onClose={onClose}>
      <div className="ai-mem">
        <section aria-labelledby="ai-persona-h">
          <h3 id="ai-persona-h">Persona {setChatPersona ? 'for this chat' : 'for new chats'}</h3>
          <div className="ai-persona-list" role="radiogroup" aria-label="Persona">
            {personas.map((p) => (
              <div key={p.id} className="ai-persona-row">
                <button
                  type="button"
                  role="radio"
                  aria-checked={current === p.id}
                  className="ai-persona"
                  onClick={() => {
                    if (setChatPersona) setChatPersona(p.id);
                    setMemory((m) => ({ ...m, defaultPersona: p.id }));
                  }}
                >
                  <span className="ai-persona-name">{p.name}</span>
                  <span className="ai-muted">{p.prompt || 'Friendly and balanced.'}</span>
                </button>
                {!p.builtIn && (
                  <IconButton
                    icon="trash"
                    label={`Delete persona ${p.name}`}
                    onClick={() =>
                      setMemory((m) => ({ ...m, personas: m.personas.filter((x) => x.id !== p.id), defaultPersona: m.defaultPersona === p.id ? 'default' : m.defaultPersona }))
                    }
                  />
                )}
              </div>
            ))}
          </div>
          <details className="ai-persona-new">
            <summary>
              <Icon name="plus" size={16} /> Make your own persona
            </summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newName.trim() || !newPrompt.trim()) return;
                const id = `p${Date.now().toString(36)}`;
                setMemory((m) => ({ ...m, personas: [...m.personas, { id, name: newName.trim().slice(0, 40), prompt: newPrompt.trim().slice(0, 2000) }] }));
                setNewName('');
                setNewPrompt('');
              }}
            >
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name, e.g. Chef" aria-label="Persona name" />
              <textarea value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} placeholder="How should it behave? e.g. “You are a friendly chef who suggests quick recipes.”" aria-label="Persona instructions" rows={3} />
              <button type="submit" className="btn primary" disabled={!newName.trim() || !newPrompt.trim()}>
                Add persona
              </button>
            </form>
          </details>
        </section>

        <section aria-labelledby="ai-memory-h">
          <div className="ai-mem-head">
            <h3 id="ai-memory-h">Memory</h3>
            <label className="ai-mem-toggle">
              Use memory <Toggle checked={memory.enabled} onChange={(v) => setMemory((m) => ({ ...m, enabled: v }))} label="Use memory in chats" />
            </label>
          </div>
          <p className="ai-muted">Things every chat should know about you. Kept in this browser; sent only to your own AI machine.</p>
          <form
            className="ai-mem-add"
            onSubmit={(e) => {
              e.preventDefault();
              setMemory((m) => addFact(m, fact));
              setFact('');
            }}
          >
            <input value={fact} onChange={(e) => setFact(e.target.value)} placeholder="e.g. I live in Miami and prefer metric units" aria-label="Something to remember" />
            <button type="submit" className="btn primary" disabled={!fact.trim()}>
              Remember
            </button>
          </form>
          {memory.facts.length === 0 ? (
            <p className="ai-muted">Nothing yet. You can also tap “Remember” on any of your messages.</p>
          ) : (
            <ul className="ai-mem-list">
              {memory.facts.map((f) => (
                <li key={f.id}>
                  <span>{f.text}</span>
                  <IconButton icon="trash" label={`Forget: ${f.text}`} onClick={() => setMemory((m) => ({ ...m, facts: m.facts.filter((x) => x.id !== f.id) }))} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Sheet>
  );
}
