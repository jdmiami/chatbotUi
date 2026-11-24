import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { ConfirmSheet, IconButton, Segmented, Toggle } from '../../ui/components';
import { TextArea } from '../../ui/TextArea';
import { Censor } from '../../ui/Censor';
import { isNsfw } from '../../ui/nsfw';
import { connectMarks, rememberItems } from '../../ui/nsfwFlags';
import { AiError, type LabIdea, type LabMix, type LocalAi, type MemeLabState, type MemeRecord } from '../../services/ai/LocalAi';
import { useShell } from '../../state/shell';
import { GalleryGrid, GalleryViewer, useGalleryStepper, type GalleryMedia } from '../ai/Gallery';

/**
 * The Lab: a prompt multiplier. While the AI machine is on, the writer (NVIDIA's open-weight models)
 * reads the prompts you wrote in Make and keeps writing new ones in your style; your machine makes
 * them, one after another, with the maker, size and look you used. Your own work always comes first.
 * What it makes waits here until you keep it or delete it.
 */
export function PromptLab({ ai, machineOn, isActive, onKept }: { ai: LocalAi; machineOn: boolean; isActive: boolean; onKept?: () => void }) {
  useEffect(() => connectMarks(ai), [ai]);
  const [lab, setLab] = useState<MemeLabState | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [seed, setSeed] = useState('');
  const [editing, setEditing] = useState<{ id: string; prompt: string } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const viewFrom = useRef<DOMRect | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MemeRecord | null>(null);
  const launch = useShell((s) => s.launch);

  const load = useCallback(() => {
    ai.memeLab().then(
      (s) => {
        setLab(s);
        rememberItems((s.records ?? []).filter((r) => r && r.id));
        setMissing(false);
      },
      (err: Error) => {
        if (err instanceof AiError && err.status === 404) setMissing(true);
        else setError(err.message);
      },
    );
  }, [ai]);

  useEffect(() => {
    if (!machineOn || !isActive) return;
    load();
    const t = window.setInterval(load, 8000);
    return () => window.clearInterval(t);
  }, [machineOn, isActive, load]);

  const records = (lab?.records ?? []).filter((r) => r && r.id);
  const open = viewing ? (records.find((r) => r.id === viewing) ?? null) : null;
  const media = records.map(asMedia);
  const step = useGalleryStepper(media, open?.id);

  if (!machineOn) {
    return (
      <section className="meme-lab" aria-labelledby="lab-title">
        <LabHead />
        <p className="ai-muted meme-lab-dek">The Lab works while your AI machine is on. Turn it on and it starts as soon as the machine is ready.</p>
      </section>
    );
  }
  if (missing) {
    return (
      <section className="meme-lab" aria-labelledby="lab-title">
        <LabHead />
        <p className="ai-muted meme-lab-dek">Your AI machine is on an older version. The new Lab arrives the next time it starts.</p>
      </section>
    );
  }
  if (!lab) return error ? <p className="ai-error meme-lab">{error}</p> : <p className="ai-muted meme-lab">Opening the Lab…</p>;

  const act = (what: string, p: Promise<MemeLabState>, after?: () => void) => {
    setBusy(what);
    return p.then(
      (s) => {
        setLab(s);
        setError(null);
        after?.();
      },
      (err: Error) => setError(err.message),
    ).finally(() => setBusy(null));
  };

  const queue = lab.queue ?? [];
  const job = lab.making?.job;
  const yours = lab.yours ?? { pictures: 0, videos: 0 };
  const nothingYet = yours.pictures + yours.videos === 0;

  return (
    <section className="meme-lab" aria-labelledby="lab-title">
      <LabHead>
        <Toggle checked={lab.enabled} label="Make new ones in my style while the machine is on" onChange={(on) => void act('power', ai.setMemeLab(on))} />
      </LabHead>
      <p className="ai-muted meme-lab-dek">
        The Lab reads the prompts you wrote in Make and keeps writing new ones in the same style. Your machine makes them with the same maker, size and look. It pauses whenever you make something.
      </p>
      <Segmented<LabMix>
        label="What the Lab makes"
        value={lab.mix ?? 'both'}
        options={[
          { value: 'both', label: 'Both' },
          { value: 'pictures', label: 'Pictures' },
          { value: 'videos', label: 'Videos' },
        ]}
        onChange={(m) => void act('mix', ai.setLabMix(m))}
      />
      <p className="ai-muted" data-testid="lab-yours">
        {nothingYet
          ? 'Make a few pictures or videos in Make first: the Lab writes in the style of your own prompts.'
          : `Learning from ${count(yours.pictures, 'picture prompt')} and ${count(yours.videos, 'video prompt')} of yours.`}
        {lab.writerReady === false ? ' The writer is not reachable from your machine right now.' : ''}
      </p>
      {error && <p className="ai-error">{error}</p>}

      <div className="meme-lab-block">
        <p className="o5-kicker">Multiply a prompt</p>
        <form
          className="meme-add"
          onSubmit={(e) => {
            e.preventDefault();
            const p = seed.trim();
            if (p) void act('multiply', ai.addLabIdea({ prompt: p, count: 6 }), () => setSeed(''));
          }}
        >
          <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="Paste one of your prompts: 6 new ones are written from it" aria-label="Prompt to multiply" autoComplete="off" />
          <button type="submit" className="btn primary" disabled={!seed.trim() || busy === 'multiply'}>
            {busy === 'multiply' ? 'Writing…' : 'Multiply'}
          </button>
        </form>
      </div>

      <div className="meme-lab-block">
        <p className="o5-kicker">Making now</p>
        {lab.making ? (
          <div className="meme-now" role="status" aria-label="Making now">
            <span className="meme-lab-dot" aria-hidden />
            <div className="meme-now-text">
              <Censor as="div" text nsfw={isNsfw(lab.making.prompt)}>
                <p className="meme-queue-title">{lab.making.prompt}</p>
              </Censor>
              {job && (
                <>
                  <div className="ai-bar" aria-label={`${Math.round(job.progress)}%`}>
                    <span style={{ width: `${Math.max(3, job.progress)}%` }} />
                  </div>
                  <p className="ai-muted meme-now-line">
                    {lab.making.kind === 'clip' ? '5-second video' : 'Picture'} · {job.status === 'queued' ? 'waiting for the maker' : `${Math.round(job.progress)}%`}
                    {typeof job.etaSeconds === 'number' && job.etaSeconds > 0 ? ` · about ${Math.max(1, Math.round(job.etaSeconds / 60))} min left` : ''}
                  </p>
                </>
              )}
            </div>
            <button type="button" className="btn" onClick={() => void act('cancel', ai.cancelLabVideo())}>
              <Icon name="stop" size={16} /> Skip
            </button>
          </div>
        ) : (
          <p className="ai-muted meme-lab-now">
            {lab.writing ? 'Writing new prompts in your style…' : lab.enabled ? 'The next one starts as soon as the machine is free.' : 'The Lab is off. Turn it on to start.'} {lab.madeLastHour} made in the last hour.
          </p>
        )}
        {lab.lastError && <p className="ai-muted">Last try: {lab.lastError}</p>}
      </div>

      <div className="meme-lab-block">
        <div className="lab-gallery-head">
          <p className="o5-kicker">Up next{queue.length ? ` · ${queue.length}` : ''}</p>
          <button type="button" className="btn small ghost" onClick={() => void act('write', ai.writeLab())} disabled={busy === 'write' || nothingYet}>
            <Icon name="refresh" size={16} /> {busy === 'write' ? 'Writing…' : 'Write new ones'}
          </button>
        </div>
        {queue.length === 0 ? (
          <p className="ai-muted">The writer adds the next prompts here a moment before they are needed.</p>
        ) : (
          <ol className="meme-queue" aria-label="Up next">
            {queue.map((q: LabIdea, i) => (
              <li key={q.id} className="meme-queue-item">
                <span className="meme-queue-n" aria-hidden>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <Censor as="div" text className="meme-queue-text" nsfw={editing?.id !== q.id && isNsfw(q.prompt)}>
                  {editing?.id === q.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act('edit', ai.editLabIdea(q.id, { prompt: editing.prompt }), () => setEditing(null));
                      }}
                    >
                      <TextArea value={editing.prompt} onChange={(e) => setEditing({ id: q.id, prompt: e.target.value })} rows={3} aria-label="Edit this prompt" />
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
                      <p className="meme-queue-title">{q.prompt}</p>
                      <p className="ai-muted meme-queue-meta">
                        <span className="meme-queue-badge">{q.kind === 'clip' ? '5-second video' : 'Picture'}</span>
                        {q.from ? `From your prompt: “${short(q.from)}”` : 'In your style'}
                      </p>
                    </>
                  )}
                </Censor>
                {editing?.id !== q.id && (
                  <div className="meme-queue-actions">
                    {i > 0 && <IconButton icon="arrowUp" label="Make this next" onClick={() => void act('next', ai.makeLabIdeaNext(q.id))} />}
                    <IconButton icon="pencil" label="Edit this prompt" onClick={() => setEditing({ id: q.id, prompt: q.prompt })} />
                    <IconButton icon="trash" label="Drop this prompt" onClick={() => void act('drop', ai.removeLabIdea(q.id))} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="meme-lab-block">
        <div className="lab-gallery-head">
          <p className="o5-kicker">Made in the Lab</p>
          <button type="button" className="btn small ghost" onClick={() => launch('gallery')}>
            <Icon name="image" size={16} /> All your creations
          </button>
        </div>
        {records.length === 0 ? (
          <p className="ai-muted">What the Lab makes shows up here, newest first. Keep the ones you like; they move to your gallery.</p>
        ) : (
          <GalleryGrid
            items={media}
            label="Made in the Lab, newest first"
            onOpen={(m, from) => {
              viewFrom.current = from;
              setViewing(m.id);
            }}
          />
        )}
      </div>

      {open && (
        <GalleryViewer
          media={asMedia(open)}
          title={open.kind === 'image' ? 'Lab picture' : 'Lab video'}
          origin={viewFrom.current}
          onClose={() => setViewing(null)}
          onPrev={step.prev ? () => setViewing(step.prev!.id) : null}
          onNext={step.next ? () => setViewing(step.next!.id) : null}
          position={step.index >= 0 ? { index: step.index, count: step.count } : undefined}
          neighbours={[step.prev, step.next]}
          words={
            <div className="lab-detail-words">
              <p className="meme-card-caption">{open.prompt}</p>
              {open.from && <p className="ai-muted">Built on your prompt: “{open.from}”</p>}
            </div>
          }
        >
          <div className="ai-viewer-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                void act('keep', ai.keepMeme(open.id), () => {
                  setViewing(null);
                  onKept?.();
                })
              }
            >
              <Icon name="download" size={16} /> Keep in my gallery
            </button>
            <button type="button" className="btn" onClick={() => void act('multiply', ai.addLabIdea({ prompt: open.prompt, count: 6 }), () => setViewing(null))}>
              <Icon name="sparkle" size={16} /> More like this
            </button>
            <button type="button" className="btn danger" onClick={() => setConfirmDelete(open)}>
              <Icon name="trash" size={16} /> Delete
            </button>
          </div>
        </GalleryViewer>
      )}
      {confirmDelete && (
        <ConfirmSheet
          title="Delete this?"
          message="It is removed from the Lab."
          confirmLabel="Delete"
          destructive
          onConfirm={() => {
            const r = confirmDelete;
            setConfirmDelete(null);
            setViewing(null);
            void act('delete', ai.deleteMeme(r.id));
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </section>
  );
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const short = (t: string, n = 60) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/** Something the Lab made, as the shared gallery shows it: blurred for its words, the machine's check, or your say. */
const asMedia = (r: MemeRecord): GalleryMedia & { record: MemeRecord } => ({
  id: r.id,
  kind: r.kind === 'image' ? 'image' : 'video',
  url: r.url ?? '',
  thumbUrl: r.thumbUrl,
  label: r.title ?? r.prompt,
  nsfw: r.nsfw === true || isNsfw(r.title, r.prompt, r.caption, r.remixOf),
  seconds: r.seconds,
  record: r,
});

function LabHead({ children }: { children?: React.ReactNode }) {
  return (
    <header className="meme-lab-head">
      <div>
        <p className="o5-kicker">Your prompts, multiplied</p>
        <h3 className="o5-chapter-title" id="lab-title">
          Lab
        </h3>
      </div>
      {children}
    </header>
  );
}
