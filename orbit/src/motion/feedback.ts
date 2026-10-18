import { useShell } from '../state/shell';

/**
 * Optional sound and vibration for key moments. Both are off until switched on in Settings.
 * Sounds are made on the fly with the Web Audio API (no files to download).
 */
export type Cue = 'tap' | 'pop' | 'send' | 'done' | 'error';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** [start Hz, end Hz, seconds, volume] per note, played in a row. */
const NOTES: Record<Cue, [number, number, number, number][]> = {
  tap: [[520, 420, 0.05, 0.04]],
  pop: [[380, 760, 0.09, 0.07]],
  send: [
    [420, 640, 0.07, 0.06],
    [640, 980, 0.1, 0.05],
  ],
  done: [
    [660, 660, 0.08, 0.06],
    [880, 880, 0.14, 0.06],
  ],
  error: [[260, 170, 0.18, 0.07]],
};

const BUZZ: Record<Cue, number | number[]> = { tap: 6, pop: 10, send: 14, done: [12, 40, 12], error: [30, 50, 30] };

function playSound(cue: Cue) {
  const a = audio();
  if (!a) return;
  let t = a.currentTime;
  for (const [from, to, dur, vol] of NOTES[cue]) {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    t += dur * 0.8;
  }
}

let switchEl: HTMLInputElement | null = null;

/** Android and desktop Chrome can vibrate. Safari on iPhone can't, but a hidden switch gives a light tap on iOS 17.4+. */
function buzz(cue: Cue) {
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(BUZZ[cue]);
      return;
    }
    if (!switchEl) {
      switchEl = document.createElement('input');
      switchEl.type = 'checkbox';
      switchEl.setAttribute('switch', '');
      switchEl.setAttribute('aria-hidden', 'true');
      switchEl.tabIndex = -1;
      Object.assign(switchEl.style, { position: 'fixed', opacity: '0', pointerEvents: 'none', width: '1px', height: '1px', left: '-10px', top: '-10px' });
      document.body.appendChild(switchEl);
    }
    switchEl.click();
  } catch {
    /* not available here */
  }
}

/** Play a cue if the person turned sound and/or vibration on. */
export function cue(name: Cue) {
  const { sound, haptics } = useShell.getState().settings;
  if (sound) playSound(name);
  if (haptics) buzz(name);
}

/** The lightest touch (vibration only, no sound): the orb passing over something it can press. */
export function tick() {
  if (useShell.getState().settings.haptics) buzz('tap');
}
