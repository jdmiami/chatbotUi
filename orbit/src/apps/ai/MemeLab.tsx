import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { IconButton, Segmented, Toggle } from '../../ui/components';
import { TextArea } from '../../ui/TextArea';
import { Censor } from '../../ui/Censor';
import { isNsfw } from '../../ui/nsfw';
import { AiError, type LabIdea, type LabStyle, type LocalAi, type MemeLabState, type MemeRecord } from '../../services/ai/LocalAi';

/**
 * The Lab: whenever the AI machine is on and ready, it makes short videos about your topics (comedy,
 * or spicy: flirty thirst-trap clips of made-up adults with no nudity),
 * one after another, planned to fill the hour before the machine turns itself off. A chat model
 * scores how viral each could go. Your own pictures and videos always come first. Nothing is posted.
 * Shown as the AI app's Lab tab and as the Lab app.
 */
export function MemeLab({ ai, machineOn, isActive, onKept }: { ai: LocalAi; machineOn: boolean; isActive: boolean; onKept?: () => void }) {
  const [lab, setLab] = useState<MemeLabState | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [mine, setMine] = useState('');
  const [editing, setEditing] = useState<{ id: string; prompt: string } | null>(null);

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
    const t = window.setInterval(load, 10_000);
    return () => window.clearInterval(t);
  }, [machineOn, isActive, load]);

  if (!machineOn) {
    return (
      <section className="meme-lab" aria-labelledby="meme-lab-title">
        <LabHead />
        <p className="ai-muted meme-lab-dek">The Lab works while your AI machine is on. Turn it on and the Lab starts as soon as the machine is ready.</p>
      </section>
    );
  }
  if (missing) {
    return (
      <section className="meme-lab" aria-labelledby="meme-lab-title">
        <LabHead />
        <p className="ai-muted meme-lab-dek">Your AI machine is still on an older version. The Lab arrives the next time it starts.</p>
      </section>
    );
  }
  if (!lab && !error) return <p className="ai-muted meme-lab">Opening the Lab…</p>;

  const act = (p: Promise<MemeLabState>, after?: () => void) =>
    p.then(
      (s) => {
        setLab(s);
        setError(null);
        after?.();
      },
      (err: Error) => setError(err.message),
    );

  const copy = (r: MemeRecord) => {
    const text = `${r.caption ?? ''} ${(r.hashtags ?? []).join(' ')}`.trim();
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(r.id);
        window.setTimeout(() => setCopied(null), 1500);
      },
      () => setError('Could not copy. Select the caption and copy it instead.'),
    );
  };

  const topics = lab?.topics ?? [];
  const queue = lab?.queue ?? [];
  const addTopic = () => {
    const t = topic.trim();
    if (!t || topics.includes(t)) return;
    void act(ai.setLabTopics([...topics, t]), () => setTopic(''));
  };
  const records = [...(lab?.records ?? [])].filter((r) => r && r.id).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const job = lab?.making?.job;
  const queueMinutes = queue.length * (lab?.minutesPerVideo ?? 6);
  const style: LabStyle = lab?.style ?? 'comedy';
  const spicy = style === 'spicy';
  const kind = spicy ? 'spicy' : 'comedy';

  return (
    <section className="meme-lab" aria-labelledby="meme-lab-title">
      <LabHead>{lab && <Toggle checked={lab.enabled} label={`Make ${kind} videos while the machine is on`} onChange={(on) => void act(ai.setMemeLab(on))} />}</LabHead>
      {lab?.style && (
        <Segmented<LabStyle>
          label="Lab style"
          value={style}
          options={[
            { value: 'spicy', label: 'Spicy' },
            { value: 'comedy', label: 'Comedy' },
          ]}
          onChange={(v) => v !== style && void act(ai.setLabStyle(v))}
        />
      )}
      <p className="ai-muted meme-lab-dek">
        {spicy
          ? 'While your AI machine is on, the Lab makes short vertical thirst-trap style videos: flirty, confident, stylish made-up adults, never nudity, so they can be posted. Another AI scores how viral each could go.'
          : 'While your AI machine is on, the Lab makes short vertical comedy videos about your topics, one after another, and another AI scores how viral each could go.'}{' '}
        Your own pictures and videos always go first. Nothing is posted anywhere.
      </p>
      {error && <p className="ai-error">{error}</p>}

      <div className="meme-lab-block">
        <p className="o5-kicker">Making now</p>
        {lab?.making ? (
          <div className="meme-now" role="status" aria-label="Making now">
            <span className="meme-lab-dot" aria-hidden />
            <div className="meme-now-text">
              <Censor as="div" text nsfw={isNsfw(lab.making.title, lab.making.prompt)}>
                <p className="meme-card-title">{lab.making.title}</p>
              </Censor>
              {job && (
                <>
                  <div className="ai-bar" aria-label={`${Math.round(job.progress)}%`}>
                    <span style={{ width: `${Math.max(3, job.progress)}%` }} />
                  </div>
                  <p className="ai-muted meme-now-line">
                    {job.status === 'queued' ? 'Waiting for the maker' : `${Math.round(job.progress)}%`}
                    {typeof job.etaSeconds === 'number' && job.etaSeconds > 0 ? ` · about ${Math.max(1, Math.round(job.etaSeconds / 60))} min left` : ''}
                    {lab.making.topic ? ` · ${lab.making.topic}` : ''}
                  </p>
                </>
              )}
            </div>
            <button type="button" className="btn" onClick={() => void act(ai.cancelLabVideo())}>
              <Icon name="stop" size={16} /> Cancel
            </button>
          </div>
        ) : (
          <p className="ai-muted meme-lab-now">
            {lab?.enabled ? 'Starting the next one as soon as the machine is free.' : 'The Lab is off. Turn it on to start.'} {lab?.madeLastHour ?? 0} made in the last hour.
          </p>
        )}
        {lab?.lastError && <p className="ai-muted">Last try: {lab.lastError}</p>}
      </div>

      <div className="meme-lab-block">
        <p className="o5-kicker">Your topics</p>
        <p className="ai-muted meme-lab-dek">{spicy ? 'A vibe or a place for each video, e.g. date night, beach, gym.' : 'Comedy about whatever you list here.'} With no topics, it picks its own.</p>
        {topics.length > 0 && (
          <ul className="meme-topics" aria-label="Topics">
            {topics.map((t) => (
              <li key={t}>
                <span>{t}</span>
                <button type="button" aria-label={`Remove topic ${t}`} onClick={() => void act(ai.setLabTopics(topics.filter((x) => x !== t)))}>
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="meme-add"
          onSubmit={(e) => {
            e.preventDefault();
            addTopic();
          }}
        >
          <input id="lab-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={spicy ? 'Add a topic, e.g. date night, rooftop, gym' : 'Add a topic, e.g. my cat, gym fails, Mondays'} aria-label="New topic" autoComplete="off" />
          <button type="submit" className="btn" disabled={!topic.trim()}>
            Add
          </button>
        </form>
      </div>

      <div className="meme-lab-block">
        <p className="o5-kicker">
          Up next{queue.length > 0 ? ` · ${queue.length} planned, about ${queueMinutes} min · machine off in about ${lab?.minutesLeft ?? 0} min` : ''}
        </p>
        {queue.length > 0 && (
          <ol className="meme-queue" aria-label="Up next">
            {queue.map((q: LabIdea, i) => (
              <li key={q.id} className="meme-queue-item">
                <span className="meme-queue-n" aria-hidden>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <Censor as="div" text className="meme-queue-text" nsfw={editing?.id !== q.id && isNsfw(q.title, q.prompt)}>
                  {editing?.id === q.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act(ai.editLabIdea(q.id, { prompt: editing.prompt }), () => setEditing(null));
                      }}
                    >
                      <TextArea value={editing.prompt} onChange={(e) => setEditing({ id: q.id, prompt: e.target.value })} rows={3} aria-label={`What ${q.title} shows`} />
                      <div className="meme-card-actions">
                        <button type="submit" className="btn primary">
                          Save
                        </button>
                        <button type="button" className="btn" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="meme-queue-title">{q.title}</p>
                      <p className="ai-muted meme-queue-meta">{q.yours ? 'Your idea, made as written' : q.topic ? `About ${q.topic}` : 'The AI sharpens it just before making'}</p>
                    </>
                  )}
                </Censor>
                {editing?.id !== q.id && (
                  <div className="meme-queue-actions">
                    {i > 0 && <IconButton icon="arrowUp" label={`Make ${q.title} next`} onClick={() => void act(ai.makeLabIdeaNext(q.id))} />}
                    <IconButton icon="pencil" label={`Edit ${q.title}`} onClick={() => setEditing({ id: q.id, prompt: q.prompt })} />
                    <IconButton icon="trash" label={`Remove ${q.title}`} onClick={() => void act(ai.removeLabIdea(q.id))} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        <form
          className="meme-add"
          onSubmit={(e) => {
            e.preventDefault();
            const p = mine.trim();
            if (p) void act(ai.addLabIdea({ prompt: p }), () => setMine(''));
          }}
        >
          <input id="lab-mine" value={mine} onChange={(e) => setMine(e.target.value)} placeholder="Your own idea, made next" aria-label="Your own idea" autoComplete="off" />
          <button type="submit" className="btn" disabled={!mine.trim()}>
            Add
          </button>
        </form>
      </div>

      <div className="meme-lab-block">
        <p className="o5-kicker">The Lab gallery</p>
        {records.length === 0 ? (
          <p className="ai-muted">Finished videos show up here, best first. They stay apart from your own gallery.</p>
        ) : (
          <ol className="meme-lab-list" aria-label="Lab videos, best first">
            {records.map((r) => (
              <li key={r.id} className="meme-card" data-ready={r.status === 'ready' || undefined}>
                <Censor as="div" className="meme-card-media" nsfw={labNsfw(r)}>
                  <video src={r.url ? `${r.url}#t=0.1` : undefined} controls playsInline preload="metadata" muted aria-label={r.title} />
                </Censor>
                <div className="meme-card-text">
                  <p className="meme-card-kicker">
                    {r.status === 'ready' ? 'Ready to post' : r.status === 'judged' ? 'Judged' : 'Waiting to be judged'}
                    {r.score != null && <span className="meme-score">{r.score}</span>}
                  </p>
                  <Censor as="div" text nsfw={labNsfw(r)}>
                    <p className="meme-card-title">{r.title}</p>
                    {r.why && <p className="ai-muted meme-card-why">{r.why}</p>}
                    <p className="meme-card-caption">
                      {r.caption} <span className="ai-muted">{(r.hashtags ?? []).join(' ')}</span>
                    </p>
                  </Censor>
                  <div className="meme-card-actions">
                    <button type="button" className="btn" onClick={() => copy(r)}>
                      <Icon name="copy" size={16} /> {copied === r.id ? 'Copied' : 'Copy caption'}
                    </button>
                    <button type="button" className="btn" onClick={() => void act(ai.keepMeme(r.id), onKept)}>
                      <Icon name="download" size={16} /> Keep in my gallery
                    </button>
                    <IconButton icon="trash" label={`Delete ${r.title}`} onClick={() => void act(ai.deleteMeme(r.id))} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/** A Lab video is NSFW when its words say so, or when it was made in the spicy style. */
const labNsfw = (r: MemeRecord & { style?: string }) => r.style === 'spicy' || isNsfw(r.title, r.prompt, r.caption);

function LabHead({ children }: { children?: React.ReactNode }) {
  return (
    <header className="meme-lab-head">
      <div>
        <p className="o5-kicker">Videos made while the machine is on</p>
        <h3 className="o5-chapter-title" id="meme-lab-title">
          Lab
        </h3>
      </div>
      {children}
    </header>
  );
}
