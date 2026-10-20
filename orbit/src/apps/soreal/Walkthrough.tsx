import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShell } from "../../state/shell";
import { Icon } from "../../ui/Icon";
import { IconButton, Segmented, Toggle } from "../../ui/components";
import { TextArea } from "../../ui/TextArea";
import { Censor } from "../../ui/Censor";
import {
  getLocalAi,
  type AiMachine,
  type Movie,
  type MovieDraft,
  type MovieSound,
  type StudioItem,
} from "../../services/ai/LocalAi";
import { shrinkImage } from "../ai/attach";
import {
  LENGTHS,
  SOUNDS,
  STEPS,
  STYLES,
  SURPRISES,
  TEMPLATES,
  aboutTime,
  shotsFor,
  soundName,
} from "./plan";

type LeadChoice = "ai" | "photo" | "none";
const leadChoice = (m: Movie): LeadChoice =>
  m.lead?.mode === "photo" ? "photo" : m.lead?.mode === "none" ? "none" : "ai";
const storyKey = (m: Movie) =>
  `${m.idea ?? ""}|${m.length ?? ""}|${m.template ?? ""}`;

/**
 * "Walk me through it": the movie one step at a time, with the orb as the guide. On each step the
 * orb goes to the step and says one plain line about it. Every step can be skipped; whatever is
 * skipped, the AI fills in when the movie is made.
 */
export function Walkthrough({
  movie,
  itemById,
  ready,
  helperOn,
  makeOn,
  setMakeOn,
  onMovie,
  onItems,
  onMade,
}: {
  movie: Movie;
  itemById: Map<string, StudioItem>;
  ready: boolean;
  helperOn: boolean;
  makeOn: AiMachine;
  setMakeOn: (v: AiMachine) => void;
  onMovie: (m: Movie) => void;
  onItems: () => void;
  onMade: (m: Movie) => void;
}) {
  const ai = useMemo(() => getLocalAi(), []);
  const toast = useShell((s) => s.toast);
  const [step, setStep] = useState(0);
  const [idea, setIdea] = useState(movie.idea ?? "");
  const [length, setLength] = useState(movie.length ?? 20);
  const [size, setSize] = useState<"portrait" | "landscape">(
    movie.size === "landscape" ? "landscape" : "portrait",
  );
  const [lines, setLines] = useState(
    movie.shots.map((s) => ({
      id: s.id,
      prompt: s.prompt,
      says: s.says ?? "",
    })),
  );
  const [lead, setLead] = useState<LeadChoice>(leadChoice(movie));
  const [leadText, setLeadText] = useState(movie.lead?.description ?? "");
  const [look, setLook] = useState(movie.look);
  const [review, setReview] = useState(Boolean(movie.reviewStoryboard));
  const [sound, setSound] = useState<MovieSound>(movie.sound ?? "auto");
  const [writing, setWriting] = useState(false);
  const [writtenFor, setWrittenFor] = useState<string | null>(
    movie.shots.some((s) => s.prompt.trim()) ? storyKey(movie) : null,
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const current = STEPS[step];

  // The orb goes to the step (it follows [data-orb-focus]) and says its line.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("orb:say", { detail: STEPS[step].guide }),
    );
    top.current?.scrollIntoView({ block: "start" });
    setProblem(null);
  }, [step]);

  const save = useCallback(
    async (draft: MovieDraft) => {
      const m = await ai.updateMovie(movie.id, draft);
      onMovie(m);
      return m;
    },
    [ai, movie.id, onMovie],
  );

  const write = useCallback(async () => {
    setWriting(true);
    try {
      const m = await ai.planMovie(movie.id);
      onMovie(m);
      setLines(
        m.shots.map((s) => ({
          id: s.id,
          prompt: s.prompt,
          says: s.says ?? "",
        })),
      );
      setLead(leadChoice(m));
      setLeadText(m.lead?.description ?? "");
      setLook(m.look);
      setWrittenFor(storyKey(m));
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setWriting(false);
    }
  }, [ai, movie.id, onMovie, toast]);

  // The story is written when you reach it (and again if the idea or the length changed since).
  useEffect(() => {
    if (current.id !== "story" || writing || !movie.idea?.trim()) return;
    const has = movie.shots.some((s) => s.prompt.trim());
    if (!has || (writtenFor !== storyKey(movie) && movie.story !== "you"))
      void write();
  }, [current.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A photo of the lead is being made into its reference picture: look again until it's ready.
  const leadMaking = movie.lead?.status === "making";
  useEffect(() => {
    if (!leadMaking) return;
    const t = setInterval(async () => {
      try {
        const m = await ai.movie(movie.id);
        onMovie(m);
        if (m.lead?.itemId) onItems();
      } catch {
        /* next time */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [leadMaking, ai, movie.id, onMovie, onItems]);

  /** Keep what was chosen on this step (Next, Back). False when it can't be kept yet. */
  const commit = async (): Promise<boolean> => {
    switch (current.id) {
      case "idea": {
        if (idea.trim() === (movie.idea ?? "").trim()) return true;
        await save({ idea: idea.trim() });
        return true;
      }
      case "shape":
        if (length !== movie.length || size !== movie.size)
          await save({ length, size });
        return true;
      case "story": {
        const changed =
          lines.length !== movie.shots.length ||
          lines.some(
            (l, i) =>
              l.prompt !== movie.shots[i]?.prompt ||
              l.says !== (movie.shots[i]?.says ?? ""),
          );
        if (changed) {
          const m = await save({
            shots: lines
              .filter((l) => l.prompt.trim())
              .map((l) => ({
                id: l.id,
                prompt: l.prompt.trim(),
                says: l.says.trim(),
              })),
          });
          setWrittenFor(storyKey(m));
        }
        return true;
      }
      case "cast": {
        if (lead === "photo" && movie.lead?.mode !== "photo") {
          setProblem(
            "Choose a photo first, or skip and the AI designs the lead.",
          );
          return false;
        }
        const was = leadChoice(movie);
        const draft: MovieDraft = {};
        if (
          lead !== was ||
          (lead === "ai" && leadText.trim() !== (movie.lead?.description ?? ""))
        )
          draft.lead = {
            mode: lead,
            description: lead === "ai" ? leadText.trim() : "",
          };
        if (look.trim() !== movie.look) draft.look = look.trim();
        if (Object.keys(draft).length) await save(draft);
        return true;
      }
      case "storyboard":
        if (review !== Boolean(movie.reviewStoryboard))
          await save({ reviewStoryboard: review });
        return true;
      case "sound":
        if (sound !== (movie.sound ?? "auto")) await save({ sound });
        return true;
      default:
        return true;
    }
  };

  /** Skip: leave this step to the AI (what you typed here is not kept). */
  const skip = async () => {
    switch (current.id) {
      case "idea":
        if (!(movie.idea ?? "").trim()) {
          const surprise =
            SURPRISES[Math.floor(Math.random() * SURPRISES.length)];
          setIdea(surprise);
          await save({ idea: surprise });
        } else setIdea(movie.idea ?? "");
        break;
      case "shape":
        setLength(movie.length ?? 20);
        setSize(movie.size === "landscape" ? "landscape" : "portrait");
        break;
      case "story":
        setLines(
          movie.shots.map((s) => ({
            id: s.id,
            prompt: s.prompt,
            says: s.says ?? "",
          })),
        );
        break;
      case "cast":
        setLead(leadChoice(movie));
        setLeadText(movie.lead?.description ?? "");
        setLook(movie.look);
        break;
      case "storyboard":
        setReview(Boolean(movie.reviewStoryboard));
        break;
      case "sound":
        setSound(movie.sound ?? "auto");
        break;
    }
  };

  const go = async (to: number, how: "next" | "skip" | "back") => {
    setBusy(true);
    try {
      if (how === "skip") await skip();
      else if (!(await commit()) && how === "next") return;
      setStep(Math.max(0, Math.min(STEPS.length - 1, to)));
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const make = async () => {
    setBusy(true);
    try {
      onMade(await ai.runMovie(movie.id, makeOn));
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const choosePhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const photo = await shrinkImage(file, 1536, 0.9);
      onMovie(await ai.movieLeadPhoto(movie.id, photo));
      setLead("photo");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const want = shotsFor(length, movie.shotSeconds ?? 5);
  const leadItem = movie.lead?.itemId ? itemById.get(movie.lead.itemId) : null;
  const template = TEMPLATES.find((t) => t.id === movie.template);
  const picked = movie.soundPicked ?? null;

  const body = (() => {
    switch (current.id) {
      case "idea":
        return (
          <label className="sr-field">
            <span>What’s your movie about?</span>
            <TextArea
              className="input"
              rows={4}
              value={idea}
              maxLength={2000}
              aria-label="What’s your movie about?"
              placeholder={template?.example ?? SURPRISES[0]}
              onChange={(e) => setIdea(e.target.value)}
            />
          </label>
        );
      case "shape":
        return (
          <div className="sr-pickers">
            <div className="sr-field">
              <span>Length</span>
              <Segmented
                label="Length"
                value={String(length)}
                onChange={(v) => setLength(Number(v))}
                options={LENGTHS.map((l) => ({
                  value: String(l),
                  label: `${l} s`,
                }))}
              />
            </div>
            <div className="sr-field">
              <span>Shape</span>
              <Segmented
                label="Shape"
                value={size}
                onChange={setSize}
                options={[
                  { value: "portrait", label: "Vertical" },
                  { value: "landscape", label: "Wide" },
                ]}
              />
            </div>
            <p className="ai-muted">
              {want} shots of about {movie.shotSeconds ?? 5} seconds
              {size === "portrait"
                ? ", framed for a phone"
                : ", for a big screen"}
              .
            </p>
          </div>
        );
      case "story":
        return writing ? (
          <p className="sr-working" role="status">
            <span className="sr-spin" aria-hidden /> Writing your story…
          </p>
        ) : !lines.length ? (
          <div className="stack">
            <p className="ai-muted">
              {movie.idea?.trim()
                ? "No story yet."
                : "Go back and give me an idea first, or skip and I’ll write one when I make it."}
            </p>
            {movie.idea?.trim() && (
              <button
                type="button"
                className="btn"
                onClick={() => void write()}
              >
                <Icon name="sparkle" size={16} /> Write the story
              </button>
            )}
          </div>
        ) : (
          <>
            {movie.story === "plain" && (
              <p className="ai-muted">
                No chat model on your AI machine, so this is a plain story from
                your idea. Edit any line, or add a chat model in AI.
              </p>
            )}
            <ol className="sr-lines">
              {lines.map((l, i) => (
                <li key={l.id} className="sr-line">
                  <span className="sr-line-n" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Censor as="div" text className="sr-line-body">
                    <TextArea
                      className="input"
                      rows={2}
                      value={l.prompt}
                      maxLength={4000}
                      aria-label={`Shot ${i + 1}`}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((x) =>
                            x.id === l.id
                              ? { ...x, prompt: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                    <TextArea
                      className="input sr-says"
                      rows={2}
                      value={l.says}
                      maxLength={900}
                      placeholder={
                        'Said or sung (optional), e.g. Mara, softly: "Stay."'
                      }
                      aria-label={`Words said or sung in shot ${i + 1}`}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((x) =>
                            x.id === l.id ? { ...x, says: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Censor>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="btn ghost sr-rewrite"
              onClick={() => void write()}
              disabled={writing}
            >
              <Icon name="refresh" size={16} /> Write it again
            </button>
          </>
        );
      case "cast":
        return (
          <>
            <div className="sr-field">
              <span>Who stars</span>
              <Segmented
                label="Who stars"
                value={lead}
                onChange={(v) => {
                  setLead(v);
                  setProblem(null);
                }}
                options={[
                  { value: "ai", label: "AI designs one" },
                  { value: "photo", label: "Use a photo" },
                  { value: "none", label: "No lead" },
                ]}
              />
            </div>
            {lead === "ai" && (
              <label className="sr-field">
                <span>The lead</span>
                <TextArea
                  className="input"
                  rows={2}
                  value={leadText}
                  maxLength={600}
                  aria-label="Describe the lead"
                  placeholder="Leave it empty and the AI designs one"
                  onChange={(e) => setLeadText(e.target.value)}
                />
              </label>
            )}
            {lead === "photo" && (
              <div className="sr-photo">
                <span className="sr-photo-pic" aria-hidden>
                  {leadItem ? (
                    <img src={leadItem.url} alt="" />
                  ) : movie.lead?.status === "making" ? (
                    <span className="sr-spin" />
                  ) : (
                    <Icon name="user" size={28} />
                  )}
                </span>
                <div className="sr-photo-text">
                  <p className="ai-muted" role="status">
                    {movie.lead?.mode === "photo" &&
                    movie.lead.status === "making"
                      ? "Getting your photo ready as the lead…"
                      : movie.lead?.mode === "photo" &&
                          movie.lead.status === "done"
                        ? "Your lead is ready. Every storyboard picture keeps this face."
                        : movie.lead?.error ||
                          "A clear photo of one person, face visible."}
                  </p>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Icon name="upload" size={16} />{" "}
                    {movie.lead?.mode === "photo"
                      ? "Choose another photo"
                      : "Choose a photo"}
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    className="sr-hidden"
                    aria-label="Photo of the lead"
                    tabIndex={-1}
                    onChange={(e) => void choosePhoto(e.target.files?.[0])}
                  />
                  <p className="ai-muted sr-small">
                    Photos of real people can never be made sexual or undressed.
                  </p>
                </div>
              </div>
            )}
            <div className="sr-field">
              <span>Style</span>
              <div className="sr-chips" role="group" aria-label="Styles">
                {STYLES.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    className="sr-chip"
                    aria-pressed={look === s.look}
                    onClick={() => setLook(look === s.look ? "" : s.look)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              <TextArea
                className="input"
                rows={2}
                value={look}
                maxLength={2000}
                aria-label="Style"
                placeholder="Leave it empty and the AI picks one"
                onChange={(e) => setLook(e.target.value)}
              />
            </div>
          </>
        );
      case "storyboard":
        return (
          <>
            <label className="sr-switch">
              <span>
                <span className="sr-switch-title">
                  Let me check the storyboard first
                </span>
                <span className="ai-muted">
                  {review
                    ? "I’ll stop after the pictures so you can redo any of them, then make the video."
                    : "Off: I check them myself and go straight on to the video."}
                </span>
              </span>
              <Toggle
                checked={review}
                onChange={setReview}
                label="Let me check the storyboard first"
              />
            </label>
            <p className="ai-muted">
              Pictures are quick; video is slow. Each shot is made between two
              of these pictures, so cuts land where they should and the look
              holds.
            </p>
          </>
        );
      case "sound":
        return (
          <>
            {picked && sound === "auto" && (
              <p className="sr-pick-note">
                For this movie I’d use: {soundName(picked)}.
              </p>
            )}
            <ul className="o5-links sr-choices" role="group" aria-label="Sound">
              {SOUNDS.map((s) => (
                <li key={s.value}>
                  <button
                    type="button"
                    className="o5-go sr-choice"
                    aria-pressed={sound === s.value}
                    onClick={() => setSound(s.value)}
                  >
                    <span className="o5-go-label">{s.label}</span>
                    <span className="o5-go-hint">{s.hint}</span>
                    {sound === s.value ? (
                      <Icon name="check" size={20} />
                    ) : (
                      <span aria-hidden />
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <p className="ai-muted sr-small">
              Voices are made with each shot: whatever is said or sung is
              written into the shot (see “Said or sung” in the story), and the
              video maker speaks it. Music-only and quiet leave the words out.
            </p>
          </>
        );
      case "make":
        return (
          <>
            <dl className="sr-summary">
              <dt>Idea</dt>
              <dd>{movie.idea?.trim() || "The AI picks one"}</dd>
              <dt>Length</dt>
              <dd>
                {movie.length ?? 20} s ·{" "}
                {movie.size === "landscape" ? "Wide" : "Vertical"} ·{" "}
                {movie.shots.length || shotsFor(movie.length ?? 20)} shots
              </dd>
              <dt>Lead</dt>
              <dd>
                {movie.lead?.mode === "photo"
                  ? "From your photo"
                  : movie.lead?.mode === "none"
                    ? "No lead"
                    : movie.lead?.description || "The AI designs one"}
              </dd>
              <dt>Style</dt>
              <dd>{movie.look || "The AI picks one"}</dd>
              <dt>Storyboard</dt>
              <dd>
                {movie.reviewStoryboard ? "You check it first" : "Automatic"}
              </dd>
              <dt>Sound</dt>
              <dd>
                {movie.sound === "auto" || !movie.sound
                  ? `${soundName(picked ?? "shots")} (the AI’s pick)`
                  : soundName(movie.sound)}
              </dd>
            </dl>
            {helperOn && (
              <div className="sr-field">
                <span>Make on</span>
                <Segmented
                  label="Make on"
                  value={makeOn}
                  onChange={setMakeOn}
                  options={[
                    { value: "main", label: "Main machine" },
                    { value: "helper", label: "Helper" },
                  ]}
                />
              </div>
            )}
            <p className="sr-estimate" role="status">
              {movie.etaSeconds
                ? `Takes ${aboutTime(movie.etaSeconds)} on your AI machine. It keeps going if your phone sleeps; come back any time.`
                : "It keeps going on your AI machine if your phone sleeps."}
            </p>
          </>
        );
    }
  })();

  const last = step === STEPS.length - 1;
  return (
    <div className="sr-page sr-walk-page" ref={top}>
      <header className="sr-walk-head">
        <p className="o5-kicker">
          Step {step + 1} of {STEPS.length}
        </p>
        <ol className="sr-dots" aria-hidden>
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              data-on={i === step || undefined}
              data-done={i < step || undefined}
            />
          ))}
        </ol>
      </header>
      <section className="sr-step" aria-labelledby="sr-step-t">
        <h3 className="sr-step-title" id="sr-step-t">
          {current.title}
        </h3>
        <p className="sr-guide" data-orb-focus>
          <span className="sr-guide-orb" aria-hidden />
          {current.guide}
        </p>
        {body}
        {problem && <p className="ai-error">{problem}</p>}
      </section>
      <nav className="sr-walk-nav" aria-label="Steps">
        {step > 0 && (
          <IconButton
            icon="back"
            label="Back"
            disabled={busy}
            onClick={() => void go(step - 1, "back")}
          />
        )}
        {!last && (
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => void go(step + 1, "skip")}
          >
            Skip
          </button>
        )}
        {!last ? (
          <button
            type="button"
            className="btn primary"
            disabled={busy || writing}
            onClick={() => void go(step + 1, "next")}
          >
            Next <Icon name="forward" size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="btn primary sr-make"
            disabled={busy || !ready}
            onClick={() => void make()}
          >
            <Icon name="film" size={18} /> Make my movie
          </button>
        )}
      </nav>
      {!last && (
        <button
          type="button"
          className="btn ghost sr-skip-all"
          disabled={busy || writing}
          onClick={() => void go(STEPS.length - 1, "next")}
        >
          Skip to the end
        </button>
      )}
    </div>
  );
}
