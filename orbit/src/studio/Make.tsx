import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import type { StudioItem } from '../services/ai/LocalAi';
import { studioAi, type MemberMovie } from './memberApi';
import type { StudioDef } from './defs';
import { briefOf, jobOf, promptOf } from './engine';
import type { Project } from './projects';
import { Headline } from './Sheets';
import { orbSay, orbThink } from './orbGuide';

const PHASE: Record<string, string> = {
  draft: 'Getting ready',
  story: 'Writing the story',
  lead: 'Casting the lead',
  storyboard: 'Drawing the storyboard',
  review: 'Storyboard ready for you',
  shots: 'Filming the scenes',
  final: 'Cutting the film',
  done: 'Finished',
  stopped: 'Stopped',
  error: 'Stopped',
};

/**
 * The brief, then the making: wakes the studio's machine when it is resting (members never see the
 * word "machine"), starts the job, follows it to the end and shows what came out.
 */
export const Make = forwardRef<HTMLElement, { studio: StudioDef; project: Project; onChange: (p: Project) => void }>(function Make({ studio, project, onChange }, ref) {
  const ai = studioAi;
  const flow = studio.flows[project.kind];
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [movie, setMovie] = useState<MemberMovie | null>(null);
  const [items, setItems] = useState<Map<string, StudioItem>>(new Map());
  const live = useRef(true);
  const current = useRef(project);
  current.current = project;
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  const update = useCallback((patch: Partial<Project>) => onChange({ ...current.current, ...patch }), [onChange]);

  const loadItems = useCallback(async () => {
    const list = await ai.studioItems().catch(() => [] as StudioItem[]);
    setItems(new Map(list.map((i) => [i.id, i])));
  }, [ai]);

  /** Wake the studio when it rests, and wait until it is ready (a few minutes the first time). */
  const ready = useCallback(async () => {
    let s = await ai.status();
    if (s.state === 'off') {
      setNote('Warming up the studio. The first one of the day takes a few minutes.');
      s = await ai.power('start');
    }
    for (let i = 0; i < 180 && live.current && s.state !== 'on'; i++) {
      if (s.state === 'error' || s.state === 'unconfigured') throw new Error('The studio could not start right now. Try again in a minute.');
      setNote(s.state === 'downloading' ? 'Warming up the studio: loading its tools.' : 'Warming up the studio.');
      await new Promise((r) => setTimeout(r, 5000));
      s = await ai.status();
    }
  }, [ai]);

  // Follow a job that is already running (also after a reload).
  useEffect(() => {
    if (project.status !== 'making') return;
    let stop = false;
    const follow = async () => {
      while (!stop && live.current) {
        try {
          if (project.movieId) {
            const m = await ai.movie(project.movieId);
            setMovie(m);
            setNote(PHASE[m.phase ?? 'draft'] ?? 'Making');
            if (m.phase === 'review') await loadItems();
            if (m.phase === 'done' && m.render) {
              await loadItems();
              update({ status: 'done', items: [m.render.itemId], error: null });
              return;
            }
            if (m.phase === 'error' || m.phase === 'stopped') {
              update({ status: 'error', error: m.error ?? 'The film stopped.' });
              return;
            }
          } else if (project.jobId) {
            const j = await ai.studioJob(project.jobId);
            setProgress(j.progress);
            setNote(j.position ? `In line: ${j.position} ahead of you.` : j.etaSeconds ? `About ${Math.max(1, Math.round(j.etaSeconds / 60))} min left.` : 'Making it now.');
            if (j.status === 'done' && j.item) {
              setItems((m) => new Map(m).set(j.item!.id, j.item!));
              update({ status: 'done', items: [j.item.id], error: null });
              return;
            }
            if (j.status === 'error' || j.status === 'stopped') {
              update({ status: 'error', error: j.error ?? 'It stopped before it was done.' });
              return;
            }
          }
        } catch {
          /* a dropped poll: try again */
        }
        await new Promise((r) => setTimeout(r, project.movieId ? 5000 : 2500));
      }
    };
    void follow();
    return () => {
      stop = true;
    };
  }, [project.status, project.jobId, project.movieId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (project.status === 'done') void loadItems();
  }, [project.status, loadItems]);

  const make = async () => {
    update({ status: 'making', error: null });
    try {
      await ready();
      const makers = await ai.studioMakers().catch(() => []);
      const installed = makers.filter((m) => m.installed).map((m) => m.id);
      const job = jobOf(studio, project.kind, project.answers, installed);
      if (job.kind === 'movie') {
        const m = await ai.createMovie(job.draft);
        update({ movieId: m.id, status: 'making' });
        await ai.runMovie(m.id);
      } else {
        const j = await ai.createStudioJob(job.req);
        update({ jobId: j.id, status: 'making' });
      }
    } catch (err) {
      setNote(null);
      update({ status: 'error', error: (err as Error).message });
    }
  };

  const approve = async () => {
    if (!project.movieId) return;
    try {
      setMovie(await ai.runMovie(project.movieId, { approve: true }));
    } catch (err) {
      update({ status: 'error', error: (err as Error).message });
    }
  };

  const result = project.items.map((id) => items.get(id)).filter(Boolean) as StudioItem[];
  const frames = movie?.phase === 'review' ? movie.frames.filter((f): f is { id: string; status: string; url: string } => Boolean(f.url)) : [];
  const what = project.kind === 'image' ? 'picture' : project.kind;

  // The orb follows along: it glows while the studio works, reads out each new stage, and says when it's ready.
  useEffect(() => {
    if (project.status !== 'making') return;
    orbThink(0.55);
    return () => orbThink(null);
  }, [project.status]);
  useEffect(() => {
    if (project.status === 'making' && note) orbSay(note);
  }, [note]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (project.status === 'done') orbSay(`Your ${what} is ready.`);
    else if (project.status === 'error' && project.error) orbSay(project.error);
    else if (project.status === 'draft') orbSay(`Here is your brief. Tap “Make the ${what}” when it looks right.`);
  }, [project.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (movie?.phase === 'review') orbSay('Your storyboard is ready. Have a look, then tell me to film it.');
  }, [movie?.phase]);

  return (
    <article className="st-sheet st-brief" ref={ref} aria-labelledby="st-brief-t">
      <p className="o5-kicker st-kick">
        <span>The brief</span>
        <span className="st-num">{project.status === 'done' ? 'Finished' : project.status === 'making' ? 'Being made' : 'Ready'}</span>
      </p>
      {project.status === 'done' ? (
        <Headline text={`Here is your *${what}.*`} id="st-brief-t" />
      ) : project.status === 'making' ? (
        <Headline text={movie?.phase === 'review' ? 'Your *storyboard.*' : `Making your *${what}…*`} id="st-brief-t" />
      ) : (
        <Headline text="Here is your *brief.*" id="st-brief-t" />
      )}

      {result.length > 0 && (
        <figure className="st-result">
          {result[0].kind === 'image' ? <img src={result[0].url} alt={promptOf(studio, flow, project.answers)} /> : <video src={result[0].url} controls playsInline loop />}
        </figure>
      )}

      {frames.length > 0 && (
        <>
          <ol className="st-frames" aria-label="Storyboard">
            {frames.map((f, i) => (
              <li key={f.id}>
                <img src={f.url} alt={`Scene ${i + 1}`} />
                <span className="st-num">Scene {i + 1}</span>
              </li>
            ))}
          </ol>
          <button type="button" className="st-go" onClick={() => void approve()}>
            Looks right, film it
          </button>
        </>
      )}

      {project.status !== 'done' && !frames.length && (
        <dl className="st-brieflist">
          {briefOf(flow, project.answers).map((b) => (
            <div key={b.key}>
              <dt>{b.key}</dt>
              <dd>{b.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {project.status === 'making' && !frames.length && (
        <div className="st-making" role="status">
          <div className="st-bar" aria-hidden>
            <span style={{ width: `${progress ?? (movie ? 20 : 8)}%` }} className={progress == null ? 'st-bar-busy' : undefined} />
          </div>
          <p className="st-dek">{note ?? 'Starting…'}</p>
          <p className="st-ht">You can leave this page. It keeps going, and it will be in your gallery when it is done.</p>
        </div>
      )}

      {project.status === 'error' && <p className="st-error" role="alert">{project.error}</p>}

      {(project.status === 'draft' || project.status === 'error') && (
        <button type="button" className="st-go" onClick={() => void make()}>
          {project.status === 'error' ? 'Try again' : `Make the ${what}`}
        </button>
      )}
    </article>
  );
});
