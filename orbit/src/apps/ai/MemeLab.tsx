import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { IconButton, Segmented, Toggle } from '../../ui/components';
import { TextArea } from '../../ui/TextArea';
import { Censor } from '../../ui/Censor';
import { isNsfw } from '../../ui/nsfw';
import { connectMarks } from '../../ui/nsfwFlags';
import { AiError, type LabIdea, type LabMovieProgress, type LabStyle, type LocalAi, type MemeLabState, type MemeRecord, type YourStyleProfile } from '../../services/ai/LocalAi';

/**
 * The Lab: whenever the AI machine is on and ready, it makes short videos about your topics (comedy,
 * or spicy: flirty thirst-trap clips of made-up adults with no nudity), or 30-second movies in your
 * own style (written from your saved prompts on the AI machine, made with soReal's auto flow),
 * one after another, planned to fill the hour before the machine turns itself off. A chat model
 * scores how viral each could go. Your own pictures and videos always come first. Nothing is posted.
 * Shown as the AI app's Lab tab and as the Lab app.
 */
export function MemeLab({ ai, machineOn, isActive, onKept }: { ai: LocalAi; machineOn: boolean; isActive: boolean; onKept?: () => void }) {
  // A Lab video held to blur is saved on the AI machine from here too.
  useEffect(() => connectMarks(ai), [ai]);
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
  const yours = style === 'yours';
  const kind = spicy ? 'spicy videos' : yours ? 'movies in your style' : 'comedy videos';
  const movie = lab?.making?.movie ?? null;

  return (
    <section className="meme-lab" aria-labelledby="meme-lab-title">
      <LabHead>{lab && <Toggle checked={lab.enabled} label={`Make ${kind} while the machine is on`} onChange={(on) => void act(ai.setMemeLab(on))} />}</LabHead>
      {lab?.style && (
        <Segmented<LabStyle>
          label="Lab style"
          value={style}
          options={[
            { value: 'spicy', label: 'Spicy' },
            { value: 'comedy', label: 'Comedy' },
            { value: 'yours', label: 'Your style' },
          ]}
          onChange={(v) => v !== style && void act(ai.setLabStyle(v))}
        />
      )}
      <p className="ai-muted meme-lab-dek">
        {spicy
          ? 'While your AI machine is on, the Lab makes short vertical thirst-trap style videos: flirty, confident, stylish made-up adults, never nudity, so they can be posted. Another AI scores how viral each could go.'
          : yours
            ? 'While your AI machine is on, the Lab makes 30-second vertical movies that look like yours. The AI on your machine reads the prompts you saved, writes a story in your style, and makes it shot by shot. It pauses whenever you make something.'
            : 'While your AI machine is on, the Lab makes short vertical comedy videos about your topics, one after another, and another AI scores how viral each could go.'}{' '}
        Your own pictures and videos always go first. Nothing is posted anywhere.
      </p>
      {error && <p className="ai-error">{error}</p>}
      {yours && <YourStylePanel ai={ai} isActive={isActive} onChanged={load} />}

      <div className="meme-lab-block">
        <p className="o5-kicker">Making now</p>
        {lab?.making ? (
          <div className="meme-now" role="status" aria-label="Making now">
            <span className="meme-lab-dot" aria-hidden />
            <div className="meme-now-text">
              <Censor as="div" text nsfw={lab.making.nsfw === true || isNsfw(lab.making.title, lab.making.prompt)}>
                <p className="meme-card-title">{lab.making.title}</p>
              </Censor>
              {movie && <MovieStages movie={movie} />}
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

      {!yours && <div className="meme-lab-block">
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
      </div>}

      <div className="meme-lab-block">
        <p className="o5-kicker">
          Up next{queue.length > 0 ? ` · ${queue.length} planned, about ${queueMinutes} min · machine off in about ${lab?.minutesLeft ?? 0} min` : ''}
        </p>
        {yours && (
          <p className="ai-muted meme-lab-dek">
            Each movie takes about {lab?.minutesPerVideo ?? 45} minutes, so the Lab plans just what fits before the machine turns off.
          </p>
        )}
        {queue.length > 0 && (
          <ol className="meme-queue" aria-label="Up next">
            {queue.map((q: LabIdea, i) => (
              <li key={q.id} className="meme-queue-item">
                <span className="meme-queue-n" aria-hidden>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <Censor as="div" text className="meme-queue-text" nsfw={editing?.id !== q.id && (q.nsfw === true || isNsfw(q.title, q.prompt, q.look))}>
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
                      <p className="ai-muted meme-queue-meta">
                        {q.kind === 'movie' && <span className="meme-queue-badge">{q.seconds ?? 30}-second movie</span>}
                        {q.yours ? 'Your idea, made as written' : q.kind === 'movie' ? `In your style${q.look ? `: ${q.look}` : ''}` : q.topic ? `About ${q.topic}` : 'The AI sharpens it just before making'}
                      </p>
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
          <input id="lab-mine" value={mine} onChange={(e) => setMine(e.target.value)} placeholder={yours ? 'Your own movie idea, made next' : 'Your own idea, made next'} aria-label="Your own idea" autoComplete="off" />
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
                <Censor as="div" className="meme-card-media" markId={r.id} nsfw={labNsfw(r)}>
                  <video src={r.url ? `${r.url}#t=0.1` : undefined} controls playsInline preload="metadata" muted aria-label={r.title} />
                  {r.movieId && <span className="meme-card-badge">{Math.round(r.seconds ?? 30)} s movie</span>}
                </Censor>
                <div className="meme-card-text">
                  <p className="meme-card-kicker">
                    {r.status === 'ready' ? 'Ready to post' : r.status === 'judged' ? 'Judged' : 'Waiting to be judged'}
                    {r.score != null && <span className="meme-score">{r.score}</span>}
                  </p>
                  <Censor as="div" text markId={r.id} nsfw={labNsfw(r)}>
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

const STAGES: { id: string; label: string; phases: LabMovieProgress['phase'][] }[] = [
  { id: 'story', label: 'Story', phases: ['draft', 'story', 'lead'] },
  { id: 'storyboard', label: 'Storyboard', phases: ['storyboard', 'review'] },
  { id: 'shots', label: 'Shots', phases: ['shots'] },
  { id: 'final', label: 'Final cut', phases: ['final', 'done'] },
];

/** Where a Lab movie is: story, storyboard, shots, final cut; and the time left. */
function MovieStages({ movie }: { movie: LabMovieProgress }) {
  const at = Math.max(0, STAGES.findIndex((s) => s.phases.includes(movie.phase)));
  const minutes = typeof movie.etaSeconds === 'number' && movie.etaSeconds > 0 ? Math.max(1, Math.round(movie.etaSeconds / 60)) : null;
  return (
    <>
      <ol className="meme-stages" aria-label="Movie stages">
        {STAGES.map((s, i) => (
          <li key={s.id} data-state={i < at ? 'done' : i === at ? 'now' : 'next'} aria-current={i === at ? 'step' : undefined}>
            {s.label}
            {s.id === 'shots' && movie.shots > 0 && i === at ? ` ${Math.min(movie.shots, movie.shotsDone + 1)} of ${movie.shots}` : ''}
          </li>
        ))}
      </ol>
      <p className="ai-muted meme-now-line">
        {movie.paused ? 'Paused while you make something; it carries on after.' : `A ${movie.seconds}-second movie`}
        {minutes ? ` · about ${minutes} min left` : ''}
      </p>
    </>
  );
}

const when = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** "Your style": what the AI on your machine picked up from your saved prompts; yours to edit. */
function YourStylePanel({ ai, isActive, onChanged }: { ai: LocalAi; isActive: boolean; onChanged: () => void }) {
  const [p, setP] = useState<YourStyleProfile | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);

  const load = useCallback(() => {
    ai.labProfile().then(
      (v) => {
        setP(v);
        setErr(null);
      },
      (e: Error) => setErr(e.message),
    );
  }, [ai]);
  useEffect(() => {
    if (!isActive) return;
    load();
    // While it is being built, look again soon.
    const t = window.setInterval(load, p?.building || asked ? 4000 : 30_000);
    return () => window.clearInterval(t);
  }, [isActive, load, p?.building, asked]);
  useEffect(() => {
    if (asked && p && !p.building) setAsked(false);
  }, [asked, p]);

  const act = (q: Promise<YourStyleProfile>, after?: () => void) =>
    q.then(
      (v) => {
        setP(v);
        setErr(null);
        after?.();
        onChanged();
      },
      (e: Error) => setErr(e.message),
    );
  const building = Boolean(p?.building || asked);

  return (
    <div className="meme-lab-block your-style" role="region" aria-label="Your style">
      <p className="o5-kicker">Your style</p>
      {err && <p className="ai-error">{err}</p>}
      {!p ? (
        <p className="ai-muted">Reading your style…</p>
      ) : (
        <>
          {draft != null ? (
            <form
              className="your-style-edit"
              onSubmit={(e) => {
                e.preventDefault();
                void act(ai.editLabProfile({ summary: draft }), () => setDraft(null));
              }}
            >
              <TextArea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} aria-label="Your style, in your words" />
              <div className="meme-card-actions">
                <button type="submit" className="btn primary">
                  Save
                </button>
                <button type="button" className="btn" onClick={() => setDraft(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <Censor as="div" text nsfw={p.spicy}>
              <p className="your-style-summary">{p.ready ? p.summary : 'Not built yet. It is made from the prompts you saved: your pictures, videos and soReal movies.'}</p>
            </Censor>
          )}
          <p className="ai-muted your-style-meta">
            {building
              ? 'Building it from your saved prompts…'
              : p.ready
                ? `Built from ${p.count} of your prompts${p.builtAt ? ` · ${when(p.builtAt)}` : ''}${p.by === 'words' ? ' · by counting words (no chat model installed)' : ''}${p.edited ? ' · with your edits' : ''}`
                : ''}
          </p>
          <div className="meme-card-actions">
            {draft == null && (
              <button type="button" className="btn" onClick={() => setDraft(p.summary)} disabled={!p.ready}>
                <Icon name="pencil" size={16} /> Edit
              </button>
            )}
            <button type="button" className="btn" disabled={building} onClick={() => void act(ai.rebuildLabProfile(), () => setAsked(true))}>
              {building ? 'Rebuilding…' : 'Rebuild now'}
            </button>
          </div>
          {p.chips.length > 0 && (
            <>
              <p className="ai-muted your-style-meta">What it picked up. Remove anything you don't want in your movies.</p>
              <Censor as="div" text nsfw={p.spicy}>
                <ul className="meme-topics" aria-label="What it picked up">
                  {p.chips.map((c) => (
                    <li key={`${c.kind}:${c.text}`} data-kind={c.kind}>
                      <span>{c.text}</span>
                      <button type="button" aria-label={`Stop using ${c.text}`} onClick={() => void act(ai.editLabProfile({ remove: [c.text] }))}>
                        <Icon name="close" size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </Censor>
            </>
          )}
          {p.lastError && <p className="ai-muted">Last try: {p.lastError}</p>}
        </>
      )}
    </div>
  );
}

/** A Lab video is NSFW when its words say so, or when it was made in the spicy style. */
const labNsfw = (r: MemeRecord & { style?: string }) => r.nsfw === true || r.style === 'spicy' || isNsfw(r.title, r.prompt, r.caption);

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
