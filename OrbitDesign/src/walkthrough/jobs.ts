/**
 * The shape of the job a finished brief becomes. In Orbit these types came from the AI machine's
 * client (services/ai/LocalAi); here they are the portable subset the engine actually fills in, so
 * the package has no dependency on any machine. An app maps a Job onto whatever makes its pictures.
 */

/** Picture or video: one request to a maker. */
export interface StudioRequest {
  kind: 'image' | 'video';
  /** Which maker to use (an app-defined id, chosen from the studio's list). */
  maker?: string;
  /** A style for the maker, when it has them. */
  style?: string;
  prompt: string;
  /** 'portrait' | 'square' | 'landscape' (free-form so an app can add its own). */
  size?: string;
  /** Videos only. */
  seconds?: number;
}

/** 'shots': their voices speak the lines in the shots; 'auto': the maker picks per scene. */
export type MovieSound = 'auto' | 'shots' | 'music' | 'quiet';

/** One shot of a film, when the script is filmed as written. */
export interface MovieShotDraft {
  /** What we see, with who is who at the first mention ("Mara (late twenties, dark curls) …"). */
  prompt?: string;
  /** The exact final moment of the shot (its storyboard picture). */
  end?: string;
  /** What is said in the shot, one line: `Mara, softly: "Stay."` */
  says?: string;
}

/** A whole film, planned from a brief: one idea in, several five-second shots out. */
export interface MovieDraft {
  title?: string;
  /** The brief as one paragraph ("Story: …. Tone: …."). */
  idea?: string;
  /** The look added to every shot so they match (the finish, then the studio's tail). */
  look?: string;
  maker?: 'ltx' | 'h3-max';
  size?: 'landscape' | 'portrait' | 'square';
  /** Whole movie, seconds (30 at most). */
  length?: number;
  sound?: MovieSound;
  /** Stop after the storyboard and wait for approval before filming. */
  reviewStoryboard?: boolean;
  /** The lead: designed from a description ('ai') or left to the maker ('auto'). */
  lead?: { mode?: 'auto' | 'ai' | 'photo' | 'none'; description?: string };
  /** The opening picture: the place, before anything happens. Only with `shots`. */
  opening?: string;
  /** Your script, scene by scene: the maker films it as written instead of writing its own. */
  shots?: MovieShotDraft[];
}
