import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/components';
import { MagChapter, MagContents, MagCover } from '../../ui/Magazine';
import type { StudioMakerInfo } from '../../services/ai/LocalAi';

const GROUPS: { id: string; title: string; dek: string; kinds: StudioMakerInfo['kind'][] }[] = [
  { id: 'makers-pictures', title: 'Pictures', dek: 'Each paints in its own hand.', kinds: ['image'] },
  { id: 'makers-video', title: 'Video', dek: 'Moving pictures, with sound.', kinds: ['video'] },
  { id: 'makers-editing', title: 'Editing', dek: 'Change, restage or sharpen a picture you have.', kinds: ['edit', 'upscale'] },
  { id: 'makers-styles', title: 'Styles for Krea Real', dek: 'Looks to lay over Krea Real.', kinds: ['style'] },
];

const gb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(bytes >= 10e9 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

/** The studio's store: install or remove image, video and editing makers and styles. */
export function MakersSheet({
  makers,
  machineOn = true,
  error,
  onRetry,
  onTurnOn,
  busy,
  onInstall,
  onRemove,
  onClose,
}: {
  makers: StudioMakerInfo[] | null;
  /** Off: the list is what the machine last had (or offers); adding and removing wait for it. */
  machineOn?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onTurnOn?: () => void;
  busy: string | null;
  onInstall: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Makers" onClose={onClose} page>
      <div className="ai-makers mag">
        <MagCover
          kicker={<>The studio · {makers ? `${makers.filter((m) => m.installed).length} on your machine` : 'Makers'}</>}
          title="Makers"
          dek="More ways to make pictures and videos on your AI machine. Each downloads once; shared parts only once."
        >
          {makers && <MagContents chapters={GROUPS.filter((g) => makers.some((m) => g.kinds.includes(m.kind)))} />}
        </MagCover>
        {!machineOn && (
          <div className="ai-banner ai-banner-off ai-makers-off" role="status">
            <p className="ai-banner-kicker">The machine is resting</p>
            <p>Makers live on your AI machine. Turn it on to add or remove them; you can still pick one now.</p>
            {onTurnOn && (
              <button type="button" className="btn primary" onClick={onTurnOn}>
                Turn on
              </button>
            )}
          </div>
        )}
        {!makers && error && (
          <div className="ai-banner ai-banner-error" role="alert">
            <p className="ai-banner-kicker">A problem</p>
            <p>The makers could not be loaded: {error}</p>
            {onRetry && (
              <button type="button" className="btn" onClick={onRetry}>
                Try again
              </button>
            )}
          </div>
        )}
        {!makers && !error && <p className="ai-muted">Loading…</p>}
        {makers &&
          GROUPS.filter((g) => makers.some((m) => g.kinds.includes(m.kind))).map((g, i) => {
            const list = makers.filter((m) => g.kinds.includes(m.kind));
            return (
              <MagChapter key={g.id} n={i + 1} id={g.id} title={g.title} dek={g.dek}>
                <ul>
                  {list.map((m) => {
                    const downloading = m.wanted && !m.installed;
                    return (
                      <li key={m.id} className="ai-maker-row" data-installed={m.installed}>
                        <div className="ai-maker-text">
                          <span className="ai-maker-name">
                            {m.name}
                            {m.builtIn && <span className="ai-maker-tag">Included</span>}
                          </span>
                          <span className="ai-muted">{m.blurb}</span>
                          {downloading && (
                            <div className="ai-bar" aria-label={`Downloading ${m.percent}%`}>
                              <span style={{ width: `${Math.max(3, m.percent)}%` }} />
                            </div>
                          )}
                        </div>
                        {!machineOn ? (
                          <span className="ai-maker-ok">{m.installed ? 'On your machine' : m.wanted ? `${m.percent}%` : 'Not added'}</span>
                        ) : m.installed ? (
                          m.builtIn ? (
                            <span className="ai-maker-ok">
                              <Icon name="check" size={16} /> Ready
                            </span>
                          ) : (
                            <button type="button" className="btn small" onClick={() => onRemove(m.id)} disabled={busy === m.id} aria-label={`Remove ${m.name}`}>
                              Remove
                            </button>
                          )
                        ) : downloading ? (
                          <span className="ai-maker-ok" aria-live="polite">
                            {m.percent}%
                          </span>
                        ) : (
                          <button type="button" className="btn small primary" onClick={() => onInstall(m.id)} disabled={busy === m.id} aria-label={`Install ${m.name}, ${gb(m.size)}`}>
                            <Icon name="download" size={14} /> Add · {gb(m.size)}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </MagChapter>
            );
          })}
      </div>
    </Sheet>
  );
}
