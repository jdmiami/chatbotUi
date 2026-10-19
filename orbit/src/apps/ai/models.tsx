import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { ConfirmSheet, IconButton, Sheet } from '../../ui/components';
import { MagChapter, MagContents, MagCover } from '../../ui/Magazine';
import { useShell } from '../../state/shell';
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

// The store's shelf when the machine is resting (or can't be reached): what it last showed, or this
// copy of the machine's own featured list (ai/gate/src/store.js), so the store opens from anywhere.
const OFFLINE_FEATURED: FeaturedModel[] = [
  { spec: 'qwen3.8:27b', name: 'qwen3.8:27b', title: 'Qwen 3.8 27B', blurb: 'Best all-rounder. Sees images, uses tools, thinks step by step.', tags: ['general', 'vision', 'tools'], size: 17.7e9, installed: false },
  { spec: 'qwen3.6:35b', name: 'qwen3.6:35b', title: 'Qwen 3.6 35B (coder)', blurb: 'Fast mixture-of-experts model, strongest for code and agents.', tags: ['coding', 'tools', 'fast'], size: 22.6e9, installed: false },
  { spec: '', name: 'qwen3.8-obliterated:27b', title: 'Qwen 3.8 27B OBLITERATED', blurb: 'Uncensored (refusals removed) Qwen 3.8, high-quality 6-bit.', tags: ['uncensored', 'tools'], size: 23.4e9, installed: false },
  { spec: '', name: 'qwen3.8-abliterated:27b', title: 'Qwen 3.8 27B abliterated (huihui)', blurb: 'Popular uncensored Qwen 3.8 that keeps image understanding. Smaller 4-bit.', tags: ['uncensored', 'vision'], size: 18.3e9, installed: false },
  { spec: '', name: 'defiant-fable:9b', title: 'Defiant Fable 9B', blurb: 'Small, very fast uncensored storyteller. Good for role-play and quick chats.', tags: ['uncensored', 'fast', 'creative'], size: 9.5e9, installed: false },
];
const SHELF_KEY = 'orbit:ai:store';
type Shelf = { featured: FeaturedModel[]; installed: InstalledModel[] };
function rememberedShelf(): Shelf | null {
  try {
    const v = JSON.parse(localStorage.getItem(SHELF_KEY) || 'null') as Shelf | null;
    return v && Array.isArray(v.featured) && Array.isArray(v.installed) ? v : null;
  } catch {
    return null;
  }
}
function rememberShelf(patch: Partial<Shelf>) {
  try {
    const prev = rememberedShelf() ?? { featured: [], installed: [] };
    localStorage.setItem(SHELF_KEY, JSON.stringify({ ...prev, ...patch }));
  } catch {
    /* private mode */
  }
}

const tagLine = (tags: string[]) => tags.join(' · ');

/** Browse, install and delete chat models: one page, three chapters, like the home screen. */
export function ModelStore({
  ai,
  list,
  refresh,
  onClose,
  machineOn = true,
  onTurnOn,
}: {
  ai: LocalAi;
  list: ModelList | null;
  refresh: () => Promise<void>;
  onClose: () => void;
  /** Off: shows what the machine last had; adding, deleting and searching wait for it. */
  machineOn?: boolean;
  onTurnOn?: () => void;
}) {
  const toast = useShell((s) => s.toast);
  const [shelf] = useState(rememberedShelf);
  const [featured, setFeatured] = useState<FeaturedModel[] | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HubModel[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [repo, setRepo] = useState<string | null>(null);
  const [files, setFiles] = useState<HubFile[] | null>(null);
  const [remove, setRemove] = useState<InstalledModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const installed = list?.installed ?? shelf?.installed ?? [];
  const installedNames = new Set(installed.map((m) => m.name));
  const pullFor = (name: string) => list?.pulls.find((p) => p.name === name);
  const free = list?.disk?.free ?? Infinity;
  const shown = featured ?? (machineOn ? null : shelf?.featured?.length ? shelf.featured : OFFLINE_FEATURED);

  useEffect(() => {
    if (!machineOn) return;
    let live = true;
    ai.featuredModels()
      .then((f) => {
        if (!live) return;
        setFeatured(f);
        setError(null);
        rememberShelf({ featured: f });
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [ai, machineOn, installedNames.size]);
  useEffect(() => {
    if (list) rememberShelf({ installed: list.installed });
  }, [list]);

  const install = async (req: Parameters<LocalAi['installModel']>[0], size: number, key: string) => {
    if (size > free) {
      toast(`Not enough free storage: needs ${formatSize(size)}, ${formatSize(free)} free. Delete a model first.`, 'error');
      return;
    }
    setBusy(key);
    try {
      const name = await ai.installModel(req);
      toast(`Installing ${name}. You can keep chatting meanwhile.`, 'info');
      await refresh();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const search = async () => {
    const q = query.trim();
    if (!q || !machineOn) return;
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
  const offNote = 'When the machine is on';
  const chapters = [
    { id: 'store-featured', title: 'Featured' },
    { id: 'store-yours', title: 'On your machine' },
    { id: 'store-find', title: 'Find more' },
  ];
  const otherPulls = (list?.pulls ?? []).filter((p) => p.done || !shown?.some((m) => m.name === p.name));

  return (
    <>
      <Sheet title="Model store" onClose={onClose} page>
        <div className="ai-store mag">
          <MagCover
            kicker={
              <>
                The store · {installed.length} on your machine
                {list?.disk ? ` · ${formatSize(list.disk.free)} free` : ''}
              </>
            }
            title="Models"
            dek="Open models that run on your own GPU. Add one once and it is there on every start."
          >
            <MagContents chapters={chapters} />
            {list && <Storage list={list} />}
            {!machineOn && (
              <div className="ai-banner ai-banner-off" role="status">
                <p className="ai-banner-kicker">The machine is resting</p>
                <p>Models live on your AI machine. Turn it on to add, delete or search; this is what it had last time.</p>
                {onTurnOn && (
                  <button type="button" className="btn primary" onClick={onTurnOn}>
                    Turn on
                  </button>
                )}
              </div>
            )}
            {error && machineOn && (
              <div className="ai-banner ai-banner-error" role="alert">
                <p className="ai-banner-kicker">A problem</p>
                <p>{error}</p>
                <button type="button" className="btn" onClick={() => void refresh().then(() => setError(null))}>
                  Try again
                </button>
              </div>
            )}
            {otherPulls.map((p) => (
              <Progress key={p.name} pull={p} onDismiss={() => void ai.dismissPull(p.name).then(refresh)} />
            ))}
          </MagCover>

          <MagChapter n={1} id="store-featured" title="Featured" dek="Picked for this machine: they fit its GPU and do something well.">
            <ul className="ai-store-list" role="list">
              {!shown && <li className="ai-muted">Loading…</li>}
              {shown?.map((m) => {
                const pull = pullFor(m.name);
                const have = m.installed || installedNames.has(m.name);
                return (
                  <li key={m.name} className="ai-maker-row" data-installed={have}>
                    <div className="ai-maker-text">
                      <span className="ai-maker-name">
                        {m.title}
                        <span className="ai-maker-tag">{formatSize(m.size)}</span>
                      </span>
                      <span className="ai-muted">{m.blurb}</span>
                      <span className={`ai-store-tags${m.tags.includes('uncensored') ? ' ai-store-tags-warn' : ''}`}>{tagLine(m.tags)}</span>
                      {pull && !pull.done && <Progress pull={pull} />}
                    </div>
                    {pull && !pull.done ? (
                      <span className="ai-maker-ok" aria-live="polite">
                        {pull.percent > 0 ? `${pull.percent}%` : 'Starting'}
                      </span>
                    ) : have ? (
                      <span className="ai-maker-ok">
                        <Icon name="check" size={16} /> Installed
                      </span>
                    ) : !machineOn || !m.spec ? (
                      <span className="ai-maker-ok">{machineOn ? 'Not added' : offNote}</span>
                    ) : (
                      <button
                        type="button"
                        className="btn small primary"
                        disabled={busy === m.name}
                        onClick={() => void install({ spec: m.spec }, m.size, m.name)}
                        aria-label={`Install ${m.title}, ${formatSize(m.size)}`}
                      >
                        <Icon name="download" size={14} /> Add · {formatSize(m.size)}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </MagChapter>

          <MagChapter n={2} id="store-yours" title="On your machine" dek="Saved on its storage. Only the one you chat with sits in the GPU.">
            <ul className="ai-store-list" role="list">
              {!installed.length && <li className="ai-muted">{list || !machineOn ? 'Nothing yet. Add one from the featured page.' : 'Loading…'}</li>}
              {installed.map((m) => (
                <li key={m.name} className="ai-maker-row" data-installed>
                  <div className="ai-maker-text">
                    <span className="ai-maker-name">{m.name}</span>
                    <span className="ai-muted">
                      {[m.params, m.quant, formatSize(m.size)].filter(Boolean).join(' · ')}
                      {m.loaded ? ' · in the GPU now' : ''}
                    </span>
                    <Abilities m={m} />
                  </div>
                  <button type="button" className="btn small" disabled={!machineOn} onClick={() => setRemove(m)} aria-label={`Delete ${m.name}`}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </MagChapter>

          <MagChapter n={3} id="store-find" title="Find more" dek="Any chat model on Hugging Face, in the size that fits.">
            <form
              className="ai-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={machineOn ? 'Search, e.g. qwen, llama, uncensored' : 'Turn the machine on to search'}
                aria-label="Search models"
                enterKeyHint="search"
                disabled={!machineOn}
              />
              <button type="submit" className="btn primary" disabled={!machineOn || !query.trim() || searching}>
                {searching ? 'Searching…' : 'Search'}
              </button>
            </form>
            {repo ? (
              <div className="ai-repo">
                <button type="button" className="btn ghost small" onClick={() => setRepo(null)}>
                  <Icon name="back" size={16} /> Results
                </button>
                <h4 className="ai-repo-name">{repo}</h4>
                <p className="ai-muted">Smaller sizes are faster and use less memory; bigger ones answer a little better.</p>
                {!files && <p className="ai-muted">Loading sizes…</p>}
                {files?.length === 0 && <p className="ai-muted">No chat model files here.</p>}
                <ul className="ai-store-list" role="list">
                  {files?.map((f) => {
                    const note = fitNote(f.size);
                    return (
                      <li key={f.quant} className="ai-maker-row">
                        <div className="ai-maker-text">
                          <span className="ai-maker-name">{f.quant}</span>
                          <span className="ai-muted">
                            {formatSize(f.size)}
                            {note ? ` · ${note}` : ''}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn small primary"
                          disabled={f.size > free || busy === f.quant}
                          onClick={() => void install({ repo, quant: f.quant }, f.size, f.quant)}
                          aria-label={`Install ${f.quant}`}
                        >
                          Add
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <ul className="ai-store-list" role="list">
                {results?.length === 0 && <li className="ai-muted">Nothing found. Try a shorter word.</li>}
                {results?.map((r) => (
                  <li key={r.repo}>
                    <button type="button" className="o5-go ai-store-go" onClick={() => void openRepo(r.repo)}>
                      <span className="o5-go-label">{r.repo}</span>
                      <span className="o5-go-hint">
                        {formatCount(r.downloads)} downloads · {formatCount(r.likes)} likes
                      </span>
                      <Icon name="forward" size={20} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </MagChapter>
          <p className="mag-colophon">That is the whole store. Pull down or tap close to go back.</p>
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
