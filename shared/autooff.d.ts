// Types for shared/autooff.js (the site and Orbit are TypeScript; the machines run the .js as is).

export declare const AUTO_OFF: Readonly<{
  defaultMinutes: number;
  minMinutes: number;
  maxMinutes: number;
  warnMinutes: number;
  keepOnMinutes: number;
  maxHoldMinutes: number;
  graceMinutes: number;
  blindMinutes: number;
  maxBusyMinutes: number;
  retryMinutes: number;
}>;

export declare function clampAutoOffMinutes(value: unknown): number;
export declare function autoOffSentence(minutes?: number): string;

export interface AutoOffState {
  limitMinutes: number;
  idleMinutes: number;
  idleSeconds: number;
  offAt: string | null;
  heldUntil: string | null;
  lastStop: { ok: boolean; at: string; error?: string } | null;
}

export interface AutoOff {
  activity(): void;
  extend(minutes: number): number;
  check(): Promise<void>;
  start(): void;
  stopTimer(): void;
  state(): AutoOffState;
}

export declare function createAutoOff(options: {
  limitMinutes: number;
  busy?: () => boolean | Promise<boolean>;
  stop: () => Promise<void>;
  warnMinutes?: number;
  warn?: ((offAt: number) => Promise<void> | void) | null;
  maxBusyMinutes?: number;
  maxHoldMinutes?: number;
  retryMinutes?: number;
  now?: () => number;
  everyMs?: number;
  log?: { info?: (msg: string) => void; warn?: (msg: string) => void };
  tag?: string;
}): AutoOff;

export declare function runpodStopSelf(options: { podId?: string; apiKey?: string; fetchImpl?: typeof fetch }): Promise<void>;
