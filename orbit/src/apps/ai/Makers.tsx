import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/components';
import type { StudioMakerInfo } from '../../services/ai/LocalAi';

const GROUPS: { title: string; kinds: StudioMakerInfo['kind'][] }[] = [
  { title: 'Pictures', kinds: ['image'] },
  { title: 'Video', kinds: ['video'] },
  { title: 'Editing', kinds: ['edit', 'upscale'] },
  { title: 'Styles for Krea Real', kinds: ['style'] },
];

const gb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(bytes >= 10e9 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

/** The studio's store: install or remove image, video and editing makers and styles. */
export function MakersSheet({
  makers,
  busy,
  onInstall,
  onRemove,
  onClose,
}: {
  makers: StudioMakerInfo[] | null;
  busy: string | null;
  onInstall: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Makers" onClose={onClose}>
      <div className="ai-makers">
        <p className="ai-muted">
          More ways to make pictures and videos on your AI machine. Each downloads once onto its storage; shared parts are only downloaded once.
        </p>
        {!makers && <p className="ai-muted">Loading…</p>}
        {makers &&
          GROUPS.map((g) => {
            const list = makers.filter((m) => g.kinds.includes(m.kind));
            if (!list.length) return null;
            return (
              <section key={g.title} aria-label={g.title}>
                <h3>{g.title}</h3>
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
                        {m.installed ? (
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
                            <Icon name="download" size={14} /> {gb(m.size)}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
      </div>
    </Sheet>
  );
}
