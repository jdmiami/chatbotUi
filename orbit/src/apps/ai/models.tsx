import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { ConfirmSheet, IconButton, Segmented, Sheet } from '../../ui/components';
import { useShell } from '../../state/shell';
import { useTilt } from '../../motion/useTilt';
import type { FeaturedModel, HubFile, HubModel, InstalledModel, LocalAi, ModelList, ModelPull } from '../../services/ai/LocalAi';

/** The standard GPU has 48 GB; bigger models need the Turbo machine (80 GB). */
const GPU_BYTES = 46e9;

export function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e11 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

const formatCount = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

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

function Storage({ list }: { list: ModelList }) {
  if (!list.disk) return null;
  const used = list.disk.total - list.disk.free;
  return (
    <div className="ai-storage">
      <div className="ai-storage-row">
        <span>Storage</span>
        <span className="ai-muted">
          {formatSize(used)} used of {formatSize(list.disk.total)} · <strong>{formatSize(list.disk.free)} free</strong>
        </span>
      </div>
      <div className="ai-bar ai-bar-storage" aria-hidden>
        <span style={{ width: `${Math.min(100, (used / list.disk.total) * 100)}%` }} />
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

type StoreTab = 'featured' | 'search' | 'installed';

/** Browse, install and delete chat models. */
export function ModelStore({ ai, list, refresh, onClose }: { ai: LocalAi; list: ModelList | null; refresh: () => Promise<void>; onClose: () => void }) {
  const toast = useShell((s) => s.toast);
  const [tab, setTab] = useState<StoreTab>('featured');
  const [featured, setFeatured] = useState<FeaturedModel[] | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HubModel[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [repo, setRepo] = useState<string | null>(null);
  const [files, setFiles] = useState<HubFile[] | null>(null);
  const [remove, setRemove] = useState<InstalledModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const tilt = useTilt(4);

  const installedNames = new Set(list?.installed.map((m) => m.name) ?? []);
  const pullFor = (name: string) => list?.pulls.find((p) => p.name === name);
  const free = list?.disk?.free ?? Infinity;

  useEffect(() => {
    ai.featuredModels()
      .then(setFeatured)
      .catch((err: Error) => setError(err.message));
  }, [ai, installedNames.size]);

  const install = async (req: Parameters<LocalAi['installModel']>[0], size: number) => {
    if (size > free) {
      toast(`Not enough free storage: needs ${formatSize(size)}, ${formatSize(free)} free. Delete a model first.`, 'error');
      return;
    }
    try {
      const name = await ai.installModel(req);
      toast(`Installing ${name}. You can keep chatting meanwhile.`, 'info');
      await refresh();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setRepo(null);
    setError(null);
    try {
      setResults(await ai.searchModels(q));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const openRepo = async (r: string) => {
    setRepo(r);
    setFiles(null);
    try {
      setFiles(await ai.modelFiles(r));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const fitNote = (size: number) => (size > free ? 'Not enough storage' : size > GPU_BYTES ? 'Needs the Turbo machine' : '');

  return (
    <>
    <Sheet title="Model store" onClose={onClose}>
      <div className="ai-store">
        {list && <Storage list={list} />}
        {list?.pulls
          .filter((p) => p.done || tab !== 'featured' || !featured?.some((m) => m.name === p.name))
          .map((p) => (
            <Progress key={p.name} pull={p} onDismiss={() => void ai.dismissPull(p.name).then(refresh)} />
          ))}
        <Segmented
          label="Store section"
          value={tab}
          onChange={(t) => {
            setTab(t);
            if (t === 'search') setTimeout(() => searchBox.current?.focus(), 0);
          }}
          options={[
            { value: 'featured', label: 'Featured' },
            { value: 'search', label: 'Search' },
            { value: 'installed', label: `Installed${list ? ` (${list.installed.length})` : ''}` },
          ]}
        />
        {error && <p className="ai-error">{error}</p>}

        {tab === 'featured' && (
          <ul className="ai-cards" role="list">
            {!featured && !error && <li className="ai-muted">Loading…</li>}
            {featured?.map((m) => {
              const pull = pullFor(m.name);
              const have = m.installed || installedNames.has(m.name);
              return (
                <li key={m.name} {...tilt} className={`ai-card ${tilt.className}`}>
                  <div className="ai-card-head">
                    <h3>{m.title}</h3>
                    <span className="ai-muted">{formatSize(m.size)}</span>
                  </div>
                  <p>{m.blurb}</p>
                  <span className="ai-pills">
                    {m.tags.map((t) => (
                      <span key={t} className={`ai-pill${t === 'uncensored' ? ' ai-pill-warn' : ''}`}>
                        {t}
                      </span>
                    ))}
                  </span>
                  {pull && !pull.done ? (
                    <Progress pull={pull} />
                  ) : have ? (
                    <span className="ai-installed">
                      <Icon name="check" size={16} /> Installed
                    </span>
                  ) : (
                    <button type="button" className="btn primary small" onClick={() => void install({ spec: m.spec }, m.size)}>
                      <Icon name="download" size={16} /> Install {m.title}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {tab === 'search' && (
          <>
            <form
              className="ai-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <input
                ref={searchBox}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Hugging Face, e.g. qwen, llama, uncensored"
                aria-label="Search models"
                enterKeyHint="search"
              />
              <button type="submit" className="btn primary" disabled={!query.trim() || searching}>
                {searching ? 'Searching…' : 'Search'}
              </button>
            </form>
            {repo ? (
              <div className="ai-repo">
                <button type="button" className="btn ghost small" onClick={() => setRepo(null)}>
                  <Icon name="back" size={16} /> Results
                </button>
                <h3 className="ai-repo-name">{repo}</h3>
                <p className="ai-muted">Smaller sizes are faster and use less memory; bigger ones answer a little better.</p>
                {!files && <p className="ai-muted">Loading sizes…</p>}
                {files?.length === 0 && <p className="ai-muted">No chat model files here.</p>}
                <ul className="ai-model-list" role="list">
                  {files?.map((f) => {
                    const note = fitNote(f.size);
                    return (
                      <li key={f.quant} className="ai-file-row">
                        <span className="ai-model-main">
                          <span className="ai-model-name">{f.quant}</span>
                          <span className="ai-muted">
                            {formatSize(f.size)}
                            {note ? ` · ${note}` : ''}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="btn small"
                          disabled={f.size > free}
                          onClick={() => void install({ repo, quant: f.quant }, f.size)}
                          aria-label={`Install ${f.quant}`}
                        >
                          Install
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <ul className="ai-model-list" role="list">
                {results?.length === 0 && <li className="ai-muted">Nothing found. Try a shorter word.</li>}
                {results?.map((r) => (
                  <li key={r.repo}>
                    <button type="button" className="ai-model-row" onClick={() => void openRepo(r.repo)}>
                      <span className="ai-model-main">
                        <span className="ai-model-name">{r.repo}</span>
                        <span className="ai-muted">
                          {formatCount(r.downloads)} downloads · {formatCount(r.likes)} likes
                        </span>
                      </span>
                      <Icon name="forward" size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 'installed' && (
          <ul className="ai-model-list" role="list">
            {list?.installed.map((m) => (
              <li key={m.name} className="ai-file-row">
                <span className="ai-model-main">
                  <span className="ai-model-name">{m.name}</span>
                  <span className="ai-muted">
                    {[m.params, m.quant, formatSize(m.size)].filter(Boolean).join(' · ')}
                    {m.loaded ? ' · in the GPU now' : ''}
                  </span>
                  <Abilities m={m} />
                </span>
                <IconButton icon="trash" label={`Delete ${m.name}`} onClick={() => setRemove(m)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
      {remove && (
        <ConfirmSheet
          title={`Delete ${remove.name}?`}
          message={`Frees ${formatSize(remove.size)} of storage. You can install it again later.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => {
            const name = remove.name;
            setRemove(null);
            ai.removeModel(name)
              .then(() => toast(`Deleted ${name}`, 'success'))
              .catch((err: Error) => toast(err.message, 'error'))
              .finally(() => void refresh());
          }}
          onCancel={() => setRemove(null)}
        />
      )}
    </>
  );
}
