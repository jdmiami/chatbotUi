import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppProps } from '../types';
import { ConfirmSheet } from '../../ui/components';
import { MagChapter, MagContents, MagCover } from '../../ui/Magazine';
import { useShell } from '../../state/shell';
import { useScrollDepth } from '../../shell/o5/depth';
import { getLocalAi, type StorageReport, type StudioItem } from '../../services/ai/LocalAi';
import { Censor, shows, useNsfwView } from '../../ui/Censor';
import { isNsfw } from '../../ui/nsfw';
import { nsfwFor, rememberItems, useNsfwFlags } from '../../ui/nsfwFlags';
import '../store/store.css';
import './stats.css';

/**
 * Stats & Storage: every number that matters in one place. Each machine's CPU, memory, GPU (and
 * its memory, heat and power), network and disks, live with a short history; the money (balance,
 * spending now, today, this month, each day of the last month and what it went on, how long the
 * balance lasts); and what is kept where (cloud storage by folder, the machines' disks, the saved
 * storage drives), with the biggest pictures and videos first so space can be freed.
 */

interface Gpu {
  name: string;
  percent: number | null;
  memoryUsed: number | null;
  memoryTotal: number | null;
  temperature: number | null;
  watts: number | null;
}
interface MachineStats {
  cpu?: { percent: number | null; cores: number };
  memory?: { used: number; total: number };
  disks?: { label: string; total: number; free: number }[];
  network?: { rxPerSec: number | null; txPerSec: number | null };
  processes?: { name: string; cpu: number | null; memory: number; count: number }[];
  gpus?: Gpu[];
  users?: { kind: string; name: string; label: string; memory: number }[];
}
interface Machine {
  id: 'ai' | 'linux';
  name: string;
  state: string;
  costPerHour: number | null;
  uptimeSeconds: number | null;
  gpuName?: string | null;
  live: { cpu: number | null; memory: number | null; gpu: number | null; gpuMemory: number | null } | null;
  stats?: MachineStats | null;
}
interface Status {
  at?: string;
  money: { balance: number | null; spendPerHour: number | null; today: number | null; spendLimit: number | null } | null;
  machines: Machine[];
}
interface SpendDay {
  date: string;
  amount: number;
  gpu: number;
  cpu: number;
  disk: number;
  storage: number;
}
interface Spend {
  days: SpendDay[];
  total: number | null;
  volumes: { id: string; name: string; sizeGb: number; dataCenter: string | null; costPerMonth: number }[];
}
/** One reading per machine, for the little history lines. */
interface Sample {
  cpu: number | null;
  memory: number | null;
  gpu: number | null;
  vram: number | null;
  rx: number | null;
  tx: number | null;
}

const HISTORY = 60;
const usd = (n: number | null | undefined, digits = 2) => (typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(digits)}` : '—');
const pct = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);

export function bytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
const rate = (n: number | null | undefined) => (n == null ? '—' : `${bytes(n)}/s`);

function duration(seconds: number) {
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

const STATE: Record<string, string> = { on: 'On', off: 'Off', starting: 'Starting', downloading: 'Getting models', error: 'Problem', unknown: 'Unknown' };

/** A short history line (0–100, or scaled to its own top for rates). */
function Spark({ values, label, max }: { values: (number | null)[]; label: string; max?: number }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null);
  if (pts.length < 2) return <span className="sx-spark sx-spark-empty" aria-hidden />;
  const top = max ?? Math.max(1, ...pts.map((p) => p[1]));
  const w = HISTORY - 1;
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${((i / w) * 100).toFixed(1)},${(30 - Math.min(1, v / top) * 28).toFixed(1)}`).join(' ');
  return (
    <svg className="sx-spark" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={`${label}, last ${pts.length} readings`}>
      <path d={d} />
    </svg>
  );
}

/** One number with its bar and history. */
function Gauge({ label, value, text, sub, history, max }: { label: string; value: number | null; text: string; sub?: string; history?: (number | null)[]; max?: number }) {
  const level = value == null ? undefined : value >= 90 ? 'high' : value >= 70 ? 'mid' : 'low';
  return (
    <div className="sx-gauge" data-level={level}>
      <div className="sx-gauge-top">
        <span className="sx-gauge-label">{label}</span>
        <span className="sx-gauge-value">{text}</span>
      </div>
      {value != null && <meter min={0} max={100} low={70} high={90} optimum={0} value={Math.min(100, Math.max(0, value))} aria-label={label} />}
      {(sub || history) && (
        <div className="sx-gauge-foot">
          {sub && <span className="sx-gauge-sub">{sub}</span>}
          {history && <Spark values={history} label={label} max={max} />}
        </div>
      )}
    </div>
  );
}

function MachineNow({ m, history }: { m: Machine; history: Sample[] }) {
  const on = m.state === 'on' || m.state === 'downloading';
  const s = m.stats ?? null;
  const live = m.live;
  const cpu = s?.cpu?.percent ?? live?.cpu ?? null;
  const memPct = s?.memory ? pct(s.memory.used, s.memory.total) : live?.memory ?? null;
  const col = (k: keyof Sample) => history.map((h) => h[k]);
  return (
    <article className="sx-machine" data-state={m.state} aria-label={m.name}>
      <header className="sx-machine-head">
        <h4>{m.name}</h4>
        <span className="sx-chip" data-state={m.state}>
          {STATE[m.state] ?? m.state}
        </span>
      </header>
      <p className="sx-machine-sub">
        {[on && m.costPerHour ? `${usd(m.costPerHour)}/h` : null, on && m.uptimeSeconds ? `on for ${duration(m.uptimeSeconds)}` : null, on && m.costPerHour && m.uptimeSeconds ? `${usd((m.costPerHour * m.uptimeSeconds) / 3600)} this time` : null, m.gpuName]
          .filter(Boolean)
          .join(' · ') || (m.state === 'off' ? 'Resting: costs nothing per hour' : STATE[m.state] ?? m.state)}
      </p>
      {on && (
        <div className="sx-gauges">
          <Gauge label="CPU" value={cpu} text={cpu == null ? '—' : `${Math.round(cpu)}%`} sub={s?.cpu ? `${s.cpu.cores} cores` : undefined} history={col('cpu')} max={100} />
          <Gauge
            label="Memory (RAM)"
            value={memPct}
            text={memPct == null ? '—' : `${Math.round(memPct)}%`}
            sub={s?.memory ? `${bytes(s.memory.used)} of ${bytes(s.memory.total)}` : undefined}
            history={col('memory')}
            max={100}
          />
          {(s?.gpus?.length ? s.gpus : live?.gpu != null ? [{ name: 'GPU', percent: live.gpu, memoryUsed: null, memoryTotal: null, temperature: null, watts: null }] : []).map((g, i) => {
            const vram = g.memoryUsed != null && g.memoryTotal ? pct(g.memoryUsed, g.memoryTotal) : i === 0 ? live?.gpuMemory ?? null : null;
            return (
              <div key={i} className="sx-gauge-pair">
                <Gauge
                  label={s?.gpus && s.gpus.length > 1 ? `GPU ${i + 1}` : 'GPU'}
                  value={g.percent}
                  text={g.percent == null ? '—' : `${Math.round(g.percent)}%`}
                  sub={[g.temperature != null ? `${Math.round(g.temperature)}°C` : null, g.watts != null ? `${Math.round(g.watts)} W` : null, g.name !== 'GPU' ? g.name : null].filter(Boolean).join(' · ') || undefined}
                  history={i === 0 ? col('gpu') : undefined}
                  max={100}
                />
                <Gauge
                  label="GPU memory (VRAM)"
                  value={vram}
                  text={vram == null ? '—' : `${Math.round(vram)}%`}
                  sub={g.memoryUsed != null && g.memoryTotal ? `${bytes(g.memoryUsed)} of ${bytes(g.memoryTotal)}` : undefined}
                  history={i === 0 ? col('vram') : undefined}
                  max={100}
                />
              </div>
            );
          })}
          {s?.network && (
            <div className="sx-gauge-pair">
              <Gauge label="Network in" value={null} text={rate(s.network.rxPerSec)} history={col('rx')} />
              <Gauge label="Network out" value={null} text={rate(s.network.txPerSec)} history={col('tx')} />
            </div>
          )}
          {s?.disks?.map((d) => (
            <Gauge key={d.label} label={d.label} value={pct(d.total - d.free, d.total)} text={`${bytes(d.free)} free`} sub={`${bytes(d.total - d.free)} of ${bytes(d.total)} used`} />
          ))}
        </div>
      )}
      {on && s?.users && s.users.length > 0 && (
        <div className="sx-table">
          <p className="o5-kicker">In GPU memory</p>
          <ul>
            {s.users.map((u) => (
              <li key={`${u.kind}:${u.name}`}>
                <span>{u.label}</span>
                <span>{bytes(u.memory)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {on && s?.processes && s.processes.length > 0 && (
        <div className="sx-table">
          <p className="o5-kicker">Busiest programs</p>
          <ul aria-label={`${m.name}: busiest programs`}>
            {s.processes.slice(0, 6).map((p) => (
              <li key={p.name}>
                <span>
                  {p.name}
                  {p.count > 1 ? ` ×${p.count}` : ''}
                </span>
                <span>
                  {p.cpu == null ? '' : `${p.cpu}% CPU · `}
                  {bytes(p.memory)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

/** The last 30 days as bars, each split by what the money went on. */
function SpendChart({ days }: { days: SpendDay[] }) {
  const top = Math.max(0.01, ...days.map((d) => d.amount));
  const parts = [
    ['gpu', 'GPU'],
    ['cpu', 'CPU'],
    ['disk', 'Machine disks'],
    ['storage', 'Saved storage'],
  ] as const;
  return (
    <figure className="sx-chart">
      <div className="sx-bars" role="list" aria-label="Spending per day">
        {days.map((d) => {
          const other = Math.max(0, d.amount - d.gpu - d.cpu - d.disk - d.storage);
          return (
            <div key={d.date} className="sx-bar" role="listitem" aria-label={`${d.date}: ${usd(d.amount)}`} title={`${d.date}: ${usd(d.amount)}`}>
              <div className="sx-bar-stack" style={{ height: `${(d.amount / top) * 100}%` }}>
                {parts.map(([k]) => (d[k] > 0 ? <span key={k} data-part={k} style={{ flexGrow: d[k] }} /> : null))}
                {other > 0.0001 && <span data-part="other" style={{ flexGrow: other }} />}
              </div>
            </div>
          );
        })}
      </div>
      <figcaption className="sx-legend">
        {parts.map(([k, label]) => (
          <span key={k}>
            <i data-part={k} aria-hidden /> {label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export default function StatsApp({ isActive }: AppProps) {
  const ai = useMemo(() => getLocalAi(), []);
  const toast = useShell((s) => s.toast);
  const scroller = useRef<HTMLDivElement>(null);
  useScrollDepth(scroller, isActive, 'edges');

  const [status, setStatus] = useState<Status | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [spend, setSpend] = useState<Spend | null>(null);
  const [storage, setStorage] = useState<StorageReport | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [items, setItems] = useState<StudioItem[]>([]);
  const [deleting, setDeleting] = useState<StudioItem | null>(null);
  const [history, setHistory] = useState<Record<string, Sample[]>>({});

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status?detail=1', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error(String(res.status));
      const next = (await res.json()) as Status;
      setStatus(next);
      setUnavailable(false);
      setHistory((prev) => {
        const out: Record<string, Sample[]> = {};
        for (const m of next.machines) {
          const s = m.stats;
          const g = s?.gpus?.[0];
          const sample: Sample = {
            cpu: s?.cpu?.percent ?? m.live?.cpu ?? null,
            memory: s?.memory ? pct(s.memory.used, s.memory.total) : m.live?.memory ?? null,
            gpu: g?.percent ?? m.live?.gpu ?? null,
            vram: g?.memoryUsed != null && g.memoryTotal ? pct(g.memoryUsed, g.memoryTotal) : m.live?.gpuMemory ?? null,
            rx: s?.network?.rxPerSec ?? null,
            tx: s?.network?.txPerSec ?? null,
          };
          out[m.id] = m.state === 'on' || m.state === 'downloading' ? [...(prev[m.id] ?? []), sample].slice(-HISTORY) : [];
        }
        return out;
      });
    } catch {
      setUnavailable(true);
    }
  }, []);

  const loadSpend = useCallback(async () => {
    try {
      const res = await fetch('/api/spend?days=30', { credentials: 'same-origin', cache: 'no-store' });
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) setSpend((await res.json()) as Spend);
    } catch {
      /* not behind the site (preview, tests) */
    }
  }, []);

  const aiOn = status?.machines.some((m) => m.id === 'ai' && m.state === 'on') ?? false;
  const loadStorage = useCallback(
    async (fresh = false) => {
      try {
        const [report, list] = await Promise.all([ai.storage(fresh), ai.studioItems().catch(() => [] as StudioItem[])]);
        setStorage(report);
        rememberItems(list);
        setItems(list);
        setStorageError(null);
      } catch (err) {
        setStorageError((err as Error).message);
      }
    },
    [ai],
  );

  // Live numbers every 5 s while open; money and storage change slowly.
  useEffect(() => {
    if (!isActive) return;
    void loadStatus();
    void loadSpend();
    const t = setInterval(() => document.visibilityState === 'visible' && void loadStatus(), 5000);
    const t2 = setInterval(() => document.visibilityState === 'visible' && void loadSpend(), 5 * 60_000);
    return () => {
      clearInterval(t);
      clearInterval(t2);
    };
  }, [isActive, loadStatus, loadSpend]);
  useEffect(() => {
    if (isActive && aiOn) void loadStorage();
  }, [isActive, aiOn, loadStorage]);

  const money = status?.money ?? null;
  const month = useMemo(() => {
    const key = new Date().toISOString().slice(0, 7);
    const days = spend?.days.filter((d) => d.date.startsWith(key)) ?? [];
    return days.length ? days.reduce((t, d) => t + d.amount, 0) : null;
  }, [spend]);
  const avgDay = useMemo(() => {
    const done = (spend?.days ?? []).slice(0, -1).slice(-7); // the last 7 whole days
    return done.length ? done.reduce((t, d) => t + d.amount, 0) / done.length : null;
  }, [spend]);
  const lasts = money?.balance != null && avgDay ? money.balance / avgDay : null;
  const storageMonth = (storage?.cloud?.costPerMonth ?? 0) + (spend?.volumes.reduce((t, v) => t + v.costPerMonth, 0) ?? 0);
  useNsfwFlags();
  const nsfwView = useNsfwView();
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const biggest = (storage?.items ?? []).filter((i) => itemById.has(i.id)).slice(0, 12);
  const cloudTop = Math.max(1, ...(storage?.cloud?.folders.map((f) => f.bytes) ?? [1]));

  const remove = async (it: StudioItem) => {
    try {
      await ai.deleteStudioItem(it.id);
      toast(it.kind === 'video' ? 'Video deleted.' : 'Picture deleted.', 'success');
      setItems((list) => list.filter((x) => x.id !== it.id));
      setStorage((s) => (s ? { ...s, items: s.items.filter((x) => x.id !== it.id) } : s));
      void loadStorage(true);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const chapters = [
    { id: 'sx-now', title: 'Right now' },
    { id: 'sx-money', title: 'Money' },
    { id: 'sx-storage', title: 'Storage' },
  ];

  return (
    <div className="st-app sx-app" data-testid="stats">
      <div className="st-scroll mag" ref={scroller}>
        <MagCover
          kicker={<>Stats &amp; Storage{money?.spendPerHour != null ? ` · spending ${usd(money.spendPerHour, 2)}/h` : ''}</>}
          title="Stats"
          dek="Every number that matters: how hard each machine works, what it costs, and what is kept where."
        >
          {unavailable && (
            <div className="st-off" role="status">
              <p>Numbers show here when Orbit is opened from your workspace site.</p>
            </div>
          )}
          <MagContents chapters={chapters} />
        </MagCover>

        <MagChapter n={1} id="sx-now" title="Right now" dek="Live, every 5 seconds. The little lines are the last few minutes.">
          {!status && !unavailable && <p className="ai-muted">Loading…</p>}
          <div className="sx-machines">
            {status?.machines.map((m) => <MachineNow key={m.id} m={m} history={history[m.id] ?? []} />)}
          </div>
        </MagChapter>

        <MagChapter n={2} id="sx-money" title="Money" dek="What your Runpod balance pays for, day by day.">
          <dl className="sx-figures">
            <div>
              <dt>Balance</dt>
              <dd>{usd(money?.balance)}</dd>
            </div>
            <div>
              <dt>Spending now</dt>
              <dd>{money?.spendPerHour == null ? '—' : `${usd(money.spendPerHour)}/h`}</dd>
            </div>
            <div>
              <dt>Today</dt>
              <dd>{usd(money?.today)}</dd>
            </div>
            <div>
              <dt>This month</dt>
              <dd>{usd(month)}</dd>
            </div>
            <div>
              <dt>Last 30 days</dt>
              <dd>{usd(spend?.total)}</dd>
            </div>
            <div>
              <dt>Storage, a month</dt>
              <dd>{spend || storage ? usd(storageMonth) : '—'}</dd>
            </div>
          </dl>
          {(avgDay != null || money?.spendPerHour) && (
            <p className="sx-note">
              {avgDay != null ? `Lately about ${usd(avgDay)} a day` : ''}
              {lasts != null ? `, so the balance lasts about ${lasts >= 2 ? `${Math.floor(lasts)} days` : `${Math.max(1, Math.round(lasts * 24))} hours`}` : ''}
              {avgDay != null ? '. ' : ''}
              {money?.spendPerHour ? `Left as it is now, a whole day costs ${usd(money.spendPerHour * 24)}.` : 'Nothing is running right now.'}
            </p>
          )}
          {spend && spend.days.length > 0 && <SpendChart days={spend.days} />}
          {money?.spendLimit != null && <p className="sx-note">Runpod spend limit: {usd(money.spendLimit)}/h.</p>}
        </MagChapter>

        <MagChapter n={3} id="sx-storage" title="Storage" dek="What is kept, where, and what it costs while the machines rest.">
          <div className="sx-store">
            <p className="o5-kicker">Cloud storage (Cloudflare R2)</p>
            {!aiOn && !storage ? (
              <p className="ai-muted">The AI machine lists it: turn it on to see what is kept and free up space.</p>
            ) : storageError ? (
              <p className="ai-error">{storageError}</p>
            ) : !storage ? (
              <p className="ai-muted">Adding it up…</p>
            ) : !storage.cloud ? (
              <p className="ai-muted">The AI machine keeps nothing in cloud storage.</p>
            ) : (
              <>
                <p className="sx-big">
                  {bytes(storage.cloud.bytes)} <span>in {storage.cloud.files.toLocaleString()} files · {usd(storage.cloud.costPerMonth)} a month (first {bytes(storage.cloud.freeBytes)} free)</span>
                </p>
                <ul className="sx-folders" aria-label="Cloud storage by folder">
                  {storage.cloud.folders.map((f) => (
                    <li key={f.id}>
                      <span className="sx-folder-name">{f.label}</span>
                      <span className="sx-folder-size">{bytes(f.bytes)}</span>
                      <span className="sx-folder-bar" aria-hidden>
                        <span style={{ width: `${(f.bytes / cloudTop) * 100}%` }} />
                      </span>
                    </li>
                  ))}
                </ul>
                <button type="button" className="btn small ghost" onClick={() => void loadStorage(true)}>
                  Count again
                </button>
              </>
            )}
          </div>

          {spend && spend.volumes.length > 0 && (
            <div className="sx-store">
              <p className="o5-kicker">Saved storage drives</p>
              <ul className="sx-folders">
                {spend.volumes.map((v) => (
                  <li key={v.id}>
                    <span className="sx-folder-name">{v.name}</span>
                    <span className="sx-folder-size">
                      {v.sizeGb} GB · {usd(v.costPerMonth)} a month
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {biggest.length > 0 && (
            <div className="sx-store">
              <p className="o5-kicker">Biggest pictures and videos</p>
              <ul className="sx-items" aria-label="Biggest pictures and videos">
                {biggest.map((b) => {
                  const it = itemById.get(b.id)!;
                  const nsfw = nsfwFor(it.id, it.nsfw === true || isNsfw(it.prompt));
                  // NSFW stays hidden (no picture, no words) unless "Show NSFW" is on; then it is blurred.
                  const hidden = !shows(nsfw, nsfwView);
                  const kind = it.kind === 'video' ? 'Video' : 'Picture';
                  return (
                    <li key={b.id}>
                      <span className="sx-item-thumb" aria-hidden>
                        {hidden ? null : (
                          <Censor as="span" nsfw={nsfw}>
                            {it.kind === 'video' ? <video src={`${it.url}#t=0.1`} muted playsInline preload="metadata" /> : <img src={it.url} alt="" loading="lazy" />}
                          </Censor>
                        )}
                      </span>
                      <span className="sx-item-text">
                        <span className="sx-item-name">{hidden ? `NSFW ${kind.toLowerCase()} (hidden)` : it.prompt || kind}</span>
                        <span className="sx-item-sub">
                          {it.kind === 'video' ? 'Video' : 'Picture'} · {bytes(b.bytes)}
                        </span>
                      </span>
                      <button type="button" className="btn small ghost" onClick={() => setDeleting(it)} aria-label={`Delete ${kind.toLowerCase()}: ${hidden ? 'NSFW, hidden' : it.prompt}`}>
                        Delete
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </MagChapter>
      </div>

      {deleting && (
        <ConfirmSheet
          title="Delete this?"
          message={`${deleting.kind === 'video' ? 'This video' : 'This picture'} is removed from every device and from cloud storage. This can't be undone.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => {
            const it = deleting;
            setDeleting(null);
            void remove(it);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
