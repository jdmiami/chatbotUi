/**
 * Every picture the drawing machine sent back, oldest first: the history strip shows them, scrubbing
 * restores one, and the time-lapse plays them in order. The same picture twice in a row is kept once;
 * the oldest are dropped past `max`.
 */
export interface Shot {
  id: number;
  image: string;
  at: number;
  /** The words it was made with. */
  prompt: string;
  /** Finished at full quality, or kept with Keep. */
  mark?: 'finish' | 'keep';
}

export class PictureHistory {
  private list: Shot[] = [];
  private seq = 0;
  /** Which one is showing (index into `items`), or -1 for the newest. */
  private cursor = -1;

  constructor(
    readonly max = 240,
    private now: () => number = Date.now,
  ) {}

  get items(): readonly Shot[] {
    return this.list;
  }
  get length() {
    return this.list.length;
  }
  /** The index showing now (the newest unless you scrubbed back). */
  get index() {
    return this.cursor < 0 ? this.list.length - 1 : this.cursor;
  }
  get current(): Shot | null {
    return this.list[this.index] ?? null;
  }
  /** Scrubbed back to an older picture. */
  get scrubbed() {
    return this.cursor >= 0 && this.cursor < this.list.length - 1;
  }

  /** A new picture arrived: it shows (scrubbing ends). Returns it, or null when it repeats the last one. */
  add(image: string, prompt: string, mark?: Shot['mark']): Shot | null {
    this.cursor = -1;
    const last = this.list[this.list.length - 1];
    if (last && last.image === image) {
      if (mark) last.mark = mark;
      return null;
    }
    const shot: Shot = { id: ++this.seq, image, at: this.now(), prompt, ...(mark ? { mark } : {}) };
    this.list.push(shot);
    if (this.list.length > this.max) this.list.splice(0, this.list.length - this.max);
    return shot;
  }

  /** Show an older picture (clamped); returns it. */
  restore(index: number): Shot | null {
    if (!this.list.length) return null;
    const i = Math.min(this.list.length - 1, Math.max(0, Math.round(index)));
    this.cursor = i === this.list.length - 1 ? -1 : i;
    return this.list[i];
  }

  /** Frames for a time-lapse: at most `max`, evenly picked, always ending on the newest. */
  frames(max = 120): Shot[] {
    const n = this.list.length;
    if (n <= max) return [...this.list];
    const out: Shot[] = [];
    for (let k = 0; k < max; k++) out.push(this.list[Math.round((k * (n - 1)) / (max - 1))]);
    return out;
  }

  clear() {
    this.list = [];
    this.cursor = -1;
  }
}
