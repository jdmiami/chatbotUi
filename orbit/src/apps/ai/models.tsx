import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { IconButton, Sheet } from '../../ui/components';
import { useShell } from '../../state/shell';
import type { InstalledModel, LocalAi, ModelList, ModelPull } from '../../services/ai/LocalAi';

export function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e11 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/** Installed models and downloads; polls quickly while something is downloading. */
export function useModelList(ai: LocalAi, enabled: boolean) {
  const [list, setList] = useState<ModelList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setList(await ai.modelList());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [ai]);
  const pulling = !!list?.pulls.some((p) => !p.done);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const t = setInterval(refresh, pulling ? 2000 : 20000);
    return () => clearInterval(t);
  }, [enabled, pulling, refresh]);
  return { list, error, refresh };
}

function Abilities({ m }: { m: Pick<InstalledModel, 'vision' | 'tools' | 'thinking'> }) {
  return (
    <span className="ai-pills">
      {m.vision && <span className="ai-pill">Sees images</span>}
      {m.tools && <span className="ai-pill">Uses tools</span>}
      {m.thinking && <span className="ai-pill">Thinks</span>}
    </span>
  );
}

function Progress({ pull, onDismiss }: { pull: ModelPull; onDismiss?: () => void }) {
  if (pull.done) {
    return (
      <div className="ai-pull ai-pull-failed" role="alert">
        <span>
          {pull.name} didn't install: {pull.error}
        </span>
        {onDismiss && <IconButton icon="close" label={`Dismiss ${pull.name}`} onClick={onDismiss} />}
      </div>
    );
  }
  return (
    <div className="ai-pull" role="status" aria-label={`Installing ${pull.name}`}>
      <span className="ai-pull-text">
        {pull.name} · {pull.percent > 0 ? `${pull.percent}%` : pull.status === 'starting' ? 'starting…' : pull.status}
      </span>
      <div className="ai-bar" aria-hidden>
        <span style={{ width: `${Math.max(3, pull.percent)}%` }} />
      </div>
    </div>
  );
}

/** Pick the model for this chat. Choosing one starts loading it into the GPU so the reply is quick. */
export function ModelPicker({
  ai,
  list,
  fallback,
  current,
  onPick,
  onOpenStore,
  onClose,
}: {
  ai: LocalAi;
  list: ModelList | null;
  /** Model names to show if the store can't be reached. */
  fallback: string[];
  current: string;
  onPick: (name: string) => void;
  onOpenStore: () => void;
  onClose: () => void;
}) {
  const toast = useShell((s) => s.toast);
  const rows: InstalledModel[] =
    list?.installed ??
    fallback.map((name) => ({ name, size: 0, loaded: false, vision: false, tools: false, thinking: false, family: '', params: '', quant: '' }));
  const pick = (m: InstalledModel) => {
    onPick(m.name);
    onClose();
    if (list && !m.loaded) {
      ai.loadModel(m.name).catch((err: Error) => toast(`Couldn't load ${m.name}: ${err.message}`, 'error'));
    }
  };
  return (
    <Sheet
      title="Choose a model"
      onClose={onClose}
      footer={
        <button type="button" className="btn block" onClick={onOpenStore}>
          <Icon name="download" size={18} /> Get more models
        </button>
      }
    >
      <p className="ai-muted ai-sheet-note">
        Models are saved on your storage. Only the one you use sits in the GPU, so extra models cost nothing until you chat
        with them. Switching takes about 20–60 seconds.
      </p>
      {!rows.length && <p className="ai-muted">Loading…</p>}
      <ul className="ai-model-list" role="list">
        {rows.map((m) => (
          <li key={m.name}>
            <button type="button" className="ai-model-row" aria-pressed={m.name === current} onClick={() => pick(m)}>
              <span className="ai-model-main">
                <span className="ai-model-name">{m.name}</span>
                <span className="ai-muted">
                  {[m.params, m.quant, formatSize(m.size)].filter(Boolean).join(' · ')}
                  {m.loaded ? ' · in the GPU now' : ''}
                </span>
                <Abilities m={m} />
              </span>
              {m.loaded && <span className="ai-live" aria-hidden />}
              {m.name === current && <Icon name="check" size={20} />}
            </button>
          </li>
        ))}
      </ul>
      {list?.pulls.map((p) => <Progress key={p.name} pull={p} />)}
    </Sheet>
  );
}
