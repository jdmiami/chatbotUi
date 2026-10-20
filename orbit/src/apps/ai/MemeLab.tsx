import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { IconButton, Toggle } from '../../ui/components';
import { AiError, type LocalAi, type MemeLabState, type MemeRecord } from '../../services/ai/LocalAi';

/**
 * Meme lab: while the AI machine is on and nobody is using it, it makes short meme videos and a chat
 * model scores how viral each could go. Your own jobs always come first, and the lab never keeps the
 * machine on. Nothing is posted anywhere: the best are marked "Ready to post" for you.
 */
export function MemeLab({ ai, machineOn, isActive, onKept }: { ai: LocalAi; machineOn: boolean; isActive: boolean; onKept: () => void }) {
  const [lab, setLab] = useState<MemeLabState | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => {
    ai.memeLab().then(
      (s) => {
        setLab(s);
        setMissing(false);
        setError(null);
      },
      (err: Error) => {
        // An older AI machine, or the helper machine: no lab there.
        if (err instanceof AiError && err.status === 404) setMissing(true);
        else setError(err.message);
      },
    );
  }, [ai]);

  useEffect(() => {
    if (!machineOn || !isActive) return;
    load();
    const t = window.setInterval(load, 15_000);
    return () => window.clearInterval(t);
  }, [machineOn, isActive, load]);

  if (!machineOn || missing || (!lab && !error)) return null;

  const act = (p: Promise<MemeLabState>, after?: () => void) =>
    p.then(
      (s) => {
        setLab(s);
        after?.();
      },
      (err: Error) => setError(err.message),
    );

  const copy = (r: MemeRecord) => {
    const text = `${r.caption} ${r.hashtags.join(' ')}`.trim();
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(r.id);
        window.setTimeout(() => setCopied(null), 1500);
      },
      () => setError('Could not copy. Select the caption and copy it instead.'),
    );
  };

  const records = [...(lab?.records ?? [])].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  return (
    <section className="meme-lab" aria-labelledby="meme-lab-title">
      <header className="meme-lab-head">
        <div>
          <p className="o5-kicker">While you're away</p>
          <h3 className="o5-chapter-title" id="meme-lab-title">
            Meme lab
          </h3>
        </div>
        {lab && <Toggle checked={lab.enabled} label="Make meme videos while the machine is unused" onChange={(on) => void act(ai.setMemeLab(on))} />}
      </header>
      <p className="ai-muted meme-lab-dek">
        When nobody has used the AI machine for {lab?.quietMinutes ?? 3} minutes, it makes short vertical meme videos and another AI scores how viral each could go. Your
        own pictures and videos always go first, and the machine still turns off after an hour without use. Nothing is posted anywhere.
      </p>
      {lab?.making && (
        <p className="meme-lab-now" role="status">
          <span className="meme-lab-dot" aria-hidden /> Making “{lab.making.title}”{lab.making.job ? ` · ${Math.round(lab.making.job.progress)}%` : ''}
        </p>
      )}
      {lab && !lab.making && lab.enabled && <p className="ai-muted meme-lab-now">Waiting for a quiet moment. {lab.madeLastHour} made in the last hour.</p>}
      {error && <p className="ai-error">{error}</p>}
      {lab?.lastError && <p className="ai-muted">Last try: {lab.lastError}</p>}
      {records.length > 0 && (
        <ol className="meme-lab-list" aria-label="Meme lab videos, best first">
          {records.map((r) => (
            <li key={r.id} className="meme-card" data-ready={r.status === 'ready' || undefined}>
              <video src={r.url ? `${r.url}#t=0.1` : undefined} controls playsInline preload="metadata" muted aria-label={r.title} />
              <div className="meme-card-text">
                <p className="meme-card-kicker">
                  {r.status === 'ready' ? 'Ready to post' : r.status === 'judged' ? 'Judged' : 'Waiting to be judged'}
                  {r.score != null && <span className="meme-score">{r.score}</span>}
                </p>
                <p className="meme-card-title">{r.title}</p>
                {r.why && <p className="ai-muted meme-card-why">{r.why}</p>}
                <p className="meme-card-caption">
                  {r.caption} <span className="ai-muted">{r.hashtags.join(' ')}</span>
                </p>
                <div className="meme-card-actions">
                  <button type="button" className="btn" onClick={() => copy(r)}>
                    <Icon name="copy" size={16} /> {copied === r.id ? 'Copied' : 'Copy caption'}
                  </button>
                  <button type="button" className="btn" onClick={() => void act(ai.keepMeme(r.id), onKept)}>
                    <Icon name="download" size={16} /> Keep in gallery
                  </button>
                  <IconButton icon="trash" label={`Delete ${r.title}`} onClick={() => void act(ai.deleteMeme(r.id))} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
