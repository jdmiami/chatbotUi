import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShell, type AppId } from '../../state/shell';
import { useMotionLevel } from '../../motion/MotionProvider';
import { cue, tick } from '../../motion/feedback';
import { getLocalAi, type ChatMessage, type StreamHandlers } from '../../services/ai/LocalAi';
import { cloudChat, cloudReady } from '../../services/ai/CloudAi';
import { EXPLAIN_PROMPT, isExplain, screenPictures, screenText } from './look';
import { findIntent, findStuff, rerank, type Hit } from './find';
import { insertText, writable, type Field } from './write';
import { AiOrb, type OrbFace } from '../../apps/ai/AiOrb';
import { canSpeak, createSpeaker } from '../../apps/ai/speech';
import { Icon } from '../../ui/Icon';
import { DEEP_PRESS, SPRINGS, ShakeDetector, SpringValue, VelocityTracker, landing, rubberClamp, spring, stretchFor, type Rect } from './physics';
import { findFocus, restSpot } from './attention';
import { caretField, caretOf, offsetAt } from './caret';
import {
  PLANNER_PROMPT,
  describe,
  findItem,
  mainScroller,
  needsConfirm,
  parseCommand,
  parseStep,
  setFieldValue,
  settingPatch,
  snapshot,
  submitField,
  type Step,
} from './agent';
import { canListen, listen, type Listening } from './listen';

const SIZE = 56;
const R = SIZE / 2;
/** Flying to something it is about to touch: quick, purposeful, barely any overshoot. */
const AIM = spring(0.36, 0.84);
/** Riding the text cursor: fast and critically damped, so it never overshoots the letter you typed. */
const CARET = spring(0.075, 1);
/** Orb ⇄ caret shape change: smooth and nearly without overshoot, so it reads as calm. */
const MORPH = spring(0.34, 0.9);
/** Gliding over to become the caret (from wherever it is), or back home: unhurried, no overshoot. */
const GLIDE = spring(0.48, 0.96);
/** Growing into a spot or a stage (the AI's face, the voice orb) and back: a slow swell with some give. */
const GROW = spring(0.55, 0.72);
/** Pinched: its size follows the fingers closely, without lag or wobble. */
const PINCH_TRACK = spring(0.09, 1);
/** Let go after a stretch or a squeeze: it bounces back to its own size, overshooting a few times. */
const BOUNCE = spring(0.6, 0.34);
/** Text size steps a pinch moves through (the same range as Settings → Text size). */
const ZOOM = { min: 0.9, max: 1.3, step: 0.05, per: 1.2 } as const;
/** What the orb can press as a cursor (dropped on it), and lights up while it passes over. */
const PRESSABLE =
  'button, a[href], input, textarea, select, label, summary, [role="button"], [role="tab"], [role="link"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], [contenteditable="true"]';
const TEXT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number', '']);
const isText = (el: Element) =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_TYPES.has(el.type)) || (el as HTMLElement).isContentEditable;

/** How big it looks while pinched (r = finger distance now / at the start), rubber-banded at the ends. */
function stretchOf(r: number) {
  const s = Math.pow(r, 0.75);
  return s > 2 ? 2 + (s - 2) * 0.2 : s < 0.5 ? 0.5 - (0.5 - s) * 0.2 : s;
}
/** The text size a pinch of `r` lands on, from `now`. */
function zoomFor(r: number, now: number) {
  const steps = Math.round(Math.log(r) / Math.log(ZOOM.per));
  return Math.min(ZOOM.max, Math.max(ZOOM.min, Math.round((now + steps * ZOOM.step) * 100) / 100));
}
const CARET_W = 2.5;

type Mode = 'follow' | 'parked' | 'tucked' | 'drag' | 'acting' | 'caret';
type Line = { who: 'you' | 'orb'; text: string };

const APP_NAME: Record<AppId, string> = {
  terminal: 'Terminal',
  editor: 'Code',
  agent: 'Antigravity',
  ai: 'AI',
  soreal: 'soReal',
  settings: 'Settings',
  playground: 'Playground',
  vscode: 'VS Code',
  desktop: 'Linux desktop',
  windows: 'Windows PC',
};
const SUGGESTIONS = ['Explain this screen', 'Open Terminal', 'Make a picture of a red fox in snow', 'Dark mode', 'What can I do here?', 'Turn on the AI machine'];

function viewport(): Rect {
  const vv = window.visualViewport;
  return vv ? { x: vv.offsetLeft, y: vv.offsetTop, w: vv.width, h: vv.height } : { x: 0, y: 0, w: innerWidth, h: innerHeight };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The orb: on every screen, hovering beside what matters most. Tap it to talk; hold it (or press
 * hard) to tell it what to do and it will use Orbit for you, flying to each thing it touches.
 * Drag it, fling it to a side to park it, throw it off the bottom to tuck it away, shake the phone
 * to call it back (or to stop whatever it is doing).
 */
export function OrbCursor() {
  const enabled = useShell((s) => s.settings.orb !== false);
  return enabled ? <Orb /> : null;
}

function Orb() {
  const level = useMotionLevel();
  const follow = useShell((s) => s.settings.orbFollow !== false);
  const overlay = useShell((s) => s.overlay);
  const layer = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLButtonElement>(null);

  // ---- physics state (refs: the frame loop never re-renders React)
  const start = restSpot(viewport(), SIZE);
  const x = useRef(new SpringValue(start.x, SPRINGS.follow)).current;
  const y = useRef(new SpringValue(start.y, SPRINGS.follow)).current;
  const depth = useRef(new SpringValue(0, SPRINGS.press)).current;
  const jelly = useRef(new SpringValue(1, SPRINGS.jelly)).current;
  /** 0 = orb, 1 = text cursor. */
  const morph = useRef(new SpringValue(0, MORPH)).current;
  const caretH = useRef(20);
  /** Its size: grown on a spot or a stage (1 = the cursor's own size). */
  const grow = useRef(new SpringValue(1, GROW)).current;
  /** Stretched (pinched apart) or squeezed (pinched together); 1 = its own size. */
  const pinch = useRef(new SpringValue(1, BOUNCE)).current;
  /** The spot or stage it is sitting on: taps on the orb go to it when it is a button. */
  const seat = useRef<HTMLElement | null>(null);
  const onStage = useRef(false);
  /** How sharply its face is drawn: more only while it is grown (drawing is what costs). */
  const [faceRes, setFaceRes] = useState(1);
  const sizeTo = useCallback(
    (g: number) => {
      grow.target = g;
      setFaceRes(g > 1.2 ? Math.min(3.5, Math.ceil(g * 2) / 2) : 1);
    },
    [grow],
  );
  /** On its way to become the caret: how far it had to go (its shape follows the trip's progress). */
  const flight = useRef<{ d0: number } | null>(null);
  /** What the layer's attributes last said (written only when they change). */
  const slimShown = useRef(false);
  const flyingShown = useRef(false);
  /** Rounding out after being the caret: nothing else moves it until it is a ball again. */
  const leaving = useRef(false);
  const mode = useRef<Mode>(follow ? 'follow' : 'parked');
  const tracker = useRef(new VelocityTracker()).current;
  const raf = useRef(0);
  const last = useRef(0);
  const levelRef = useRef(level);
  levelRef.current = level;

  // ---- UI state
  const [panel, setPanel] = useState(false);
  const [listening, setListening] = useState(false);
  const [energy, setEnergy] = useState<number | undefined>(undefined);
  // A stage (the voice conversation) drives it with your voice and the replies.
  const [stageEnergy, setStageEnergy] = useState<number | undefined>(undefined);
  useEffect(() => {
    const on = (e: Event) => setStageEnergy((e as CustomEvent<number | null>).detail ?? undefined);
    window.addEventListener('orb:energy', on);
    return () => window.removeEventListener('orb:energy', on);
  }, []);
  const [caption, setCaption] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [confirm, setConfirm] = useState<{ text: string; resolve: (ok: boolean) => void } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [draft, setDraft] = useState('');
  const [found, setFound] = useState<Hit[] | null>(null);
  // The face: a mood that flashes after done (happy) or a failure (sad), talking while it speaks,
  // where it looks, and sleepy when no AI is available.
  const [moodFlash, setMoodFlash] = useState(0);
  const [talking, setTalking] = useState(false);
  const [gaze, setGaze] = useState<[number, number] | null>(null);
  const [sleepy, setSleepy] = useState(false);
  const faceTimers = useRef<{ mood?: ReturnType<typeof setTimeout>; talk?: ReturnType<typeof setTimeout>; gaze?: ReturnType<typeof setTimeout> }>({});
  const flash = useCallback((m: number) => {
    setMoodFlash(m);
    clearTimeout(faceTimers.current.mood);
    faceTimers.current.mood = setTimeout(() => setMoodFlash(0), 1800);
  }, []);
  // The last text box you were in (outside the orb), where "bring me…" drops things.
  const lastField = useRef<Field | null>(null);
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = writable(e.target as Element);
      if (el && !el.closest('.orb-layer')) lastField.current = el;
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, []);
  const listenRef = useRef<Listening | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const captionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((text: string, spoken = false) => {
    setLines((l) => [...l.slice(-30), { who: 'orb', text }]);
    setTalking(true);
    clearTimeout(faceTimers.current.talk);
    faceTimers.current.talk = setTimeout(() => setTalking(false), Math.min(4000, 600 + text.length * 40));
    setCaption(text);
    if (captionTimer.current) clearTimeout(captionTimer.current);
    captionTimer.current = setTimeout(() => setCaption(null), Math.min(9000, 2200 + text.length * 45));
    if (spoken && canSpeak()) {
      const sp = createSpeaker();
      sp.push(text);
      sp.end();
    }
  }, []);

  // Drawn where it starts from the very first paint, not in the corner until the first frame runs.
  useLayoutEffect(() => {
    if (body.current) body.current.style.transform = `translate3d(${x.value - R}px, ${y.value - R}px, 0)`;
    layer.current?.style.setProperty('--orb-x', `${x.value}px`);
    layer.current?.style.setProperty('--orb-y', `${y.value}px`);
  }, [x, y]);

  // ---- the frame loop
  const frame = useCallback(
    (t: number) => {
      const dt = last.current ? Math.min(0.05, (t - last.current) / 1000) : 1 / 60;
      last.current = t;
      const full = levelRef.current === 'full';
      x.step(dt);
      y.step(dt);
      depth.step(dt);
      if (flight.current) {
        const d = Math.hypot(x.target - x.value, y.target - y.value);
        const p = 1 - Math.min(1, d / flight.current.d0);
        // Round for the first part of the trip, then it narrows into the caret as it lands.
        const k = Math.max(0, Math.min(1, (p - 0.45) / 0.55));
        morph.target = k * k * (3 - 2 * k);
        if (d < 0.75) {
          flight.current = null;
          morph.target = 1;
          x.spring = CARET;
          y.spring = CARET;
        }
      }
      morph.step(dt);
      grow.step(dt);
      pinch.step(dt);
      // Stretch along its speed (the finger's while dragging), wobbling back on the jelly spring.
      const v = mode.current === 'drag' ? tracker.velocity() : { x: x.velocity, y: y.velocity };
      const { stretch, angle } = full && mode.current !== 'caret' ? stretchFor(v.x, v.y) : { stretch: 1, angle: 0 };
      jelly.target = stretch;
      jelly.step(dt);
      const s = Math.max(0.6, jelly.value);
      const press = 1 - Math.max(0, depth.value) * 0.16;
      const el = body.current;
      if (el) {
        // As a text cursor it narrows to a sliver and stretches to the line's height (squash, not a swap).
        const m = Math.max(0, Math.min(1.15, morph.value));
        const g = Math.max(0.2, grow.value * pinch.value);
        const cw = (1 + (CARET_W / SIZE - 1) * m) * g;
        const ch = (1 + (caretH.current / SIZE - 1) * m) * g;
        el.style.transform = `translate3d(${x.value - R}px, ${y.value - R}px, 0) scale(${cw}, ${ch}) rotate(${angle}rad) scale(${s * press}, ${press / s}) rotate(${-angle}rad)`;
        el.style.setProperty('--depth', Math.max(0, depth.value).toFixed(3));
      }
      layer.current?.style.setProperty('--orb-x', `${x.value}px`);
      layer.current?.style.setProperty('--orb-y', `${y.value}px`);
      // Its glow and ring fade with the shape (not when the mode flips), so there is never a streak.
      const slim = morph.value > 0.2;
      if (slim !== slimShown.current) {
        slimShown.current = slim;
        layer.current?.toggleAttribute('data-slim', slim);
      }
      if (!!flight.current !== flyingShown.current) {
        flyingShown.current = !!flight.current;
        layer.current?.toggleAttribute('data-flying', flyingShown.current);
      }
      const still = !flight.current && x.resting() && y.resting() && depth.resting(0.002) && jelly.resting(0.002) && morph.resting(0.002) && grow.resting(0.002) && pinch.resting(0.002);
      raf.current = mode.current === 'drag' || !still ? requestAnimationFrame(frame) : 0;
    },
    [x, y, depth, jelly, morph, grow, pinch, tracker],
  );
  const kick = useCallback(() => {
    if (!raf.current) {
      last.current = 0;
      raf.current = requestAnimationFrame(frame);
    }
  }, [frame]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const moveTo = useCallback(
    (px: number, py: number, sp = SPRINGS.follow) => {
      x.spring = sp;
      y.spring = sp;
      if (levelRef.current === 'off') {
        x.set(px);
        y.set(py);
      } else {
        x.target = px;
        y.target = py;
      }
      kick();
    },
    [x, y, kick],
  );

  // ---- following what matters
  const lastFocus = useRef<Element | null>(null);
  /** Where it was put down (parked or tucked), to go back to after doing something. */
  const spot = useRef<{ x: number; y: number } | null>(null);
  const refocus = useCallback(() => {
    // A dialog covers it, unless the dialog is a stage for it (the voice conversation).
    const modal = [...document.querySelectorAll('[aria-modal="true"]')].some((d) => !layer.current?.contains(d) && !d.querySelector('[data-orb-spot="stage"]'));
    setHidden(modal || overlay === 'index');
    if (leaving.current) return;
    const free = mode.current !== 'drag' && mode.current !== 'caret' && mode.current !== 'acting';
    const f = findFocus(viewport(), SIZE, layer.current);
    // A stage takes it whatever the mode: there it is the voice orb, centred and grown.
    if (f.kind === 'stage' && free) {
      if (!onStage.current) jelly.velocity += 1.2;
      onStage.current = true;
      seat.current = f.el as HTMLElement;
      sizeTo((f.size ?? SIZE) / SIZE);
      moveTo(f.x, f.y, GLIDE);
      return;
    }
    if (onStage.current) {
      onStage.current = false;
      seat.current = null;
      sizeTo(1);
      if (mode.current !== 'follow') {
        const p = spot.current ?? restSpot(viewport(), SIZE);
        moveTo(p.x, p.y, GLIDE);
      }
    }
    if (mode.current !== 'follow') {
      if (free && grow.target !== 1) sizeTo(1);
      return;
    }
    if (f.el !== lastFocus.current) {
      lastFocus.current = f.el;
      // A little nod when it turns to something new.
      if (f.el && levelRef.current === 'full') jelly.velocity += 1.6;
    }
    // On a spot kept for it (the AI's face on an empty chat) it sits centred, grown to the spot.
    seat.current = f.kind === 'spot' ? (f.el as HTMLElement) : null;
    sizeTo(f.kind === 'spot' && f.size ? f.size / SIZE : 1);
    moveTo(f.x, f.y);
  }, [overlay, moveTo, jelly, sizeTo]);

  // Only a change of the setting itself switches between following and staying put.
  const followSetting = useRef(follow);
  useEffect(() => {
    if (followSetting.current === follow) return;
    followSetting.current = follow;
    mode.current = follow ? 'follow' : 'parked';
    refocus();
  }, [follow, refocus]);
  const rest = useCallback(() => {
    if (mode.current === 'follow') return refocus();
    const p = spot.current ?? restSpot(viewport(), SIZE);
    moveTo(p.x, p.y, SPRINGS.land);
  }, [refocus, moveTo]);

  // ---- the text cursor: while you type in a box, the orb becomes its caret
  const [caretOn, setCaretOn] = useState(false);
  const caretMode = useRef<Mode | null>(null); // the mode to go back to
  const typingTimer = useRef(0);
  const caretFieldRef = useRef<Element | null>(null);
  const leaveTimer = useRef(0);
  const syncCaret = useCallback(() => {
    const field = caretField(document.activeElement, layer.current);
    const busy = mode.current === 'drag' || mode.current === 'acting';
    const c = field && !busy ? caretOf(field as HTMLElement) : null;
    if (c) {
      clearTimeout(leaveTimer.current);
      leaving.current = false;
      const entering = mode.current !== 'caret';
      if (entering) {
        caretMode.current = mode.current;
        mode.current = 'caret';
        setCaretOn(true);
        document.documentElement.dataset.orbCaret = '';
      }
      caretH.current = Math.max(12, Math.min(48, c.h));
      sizeTo(1);
      seat.current = null;
      // Centre of the caret: on the gap before the next letter, halfway down the line.
      const cx = c.x + CARET_W / 2;
      const cy = c.y + c.h / 2;
      if (levelRef.current === 'off') {
        flight.current = null;
        morph.set(1);
        x.set(cx);
        y.set(cy);
      } else if (entering || field !== caretFieldRef.current) {
        // From wherever it is (or from the box you were in), it glides over and becomes the caret.
        flight.current = { d0: Math.max(1, Math.hypot(cx - x.value, cy - y.value)) };
        x.spring = GLIDE;
        y.spring = GLIDE;
        x.target = cx;
        y.target = cy;
      } else {
        // Already the caret: it rides each letter (still gliding if it hasn't landed yet).
        if (!flight.current) {
          x.spring = CARET;
          y.spring = CARET;
          morph.target = 1;
        }
        x.target = cx;
        y.target = cy;
      }
      caretFieldRef.current = field;
      kick();
    } else if (mode.current === 'caret') {
      mode.current = caretMode.current ?? (followSetting.current ? 'follow' : 'parked');
      caretMode.current = null;
      caretFieldRef.current = null;
      flight.current = null;
      setCaretOn(false);
      delete document.documentElement.dataset.orbCaret;
      // It rounds out where it is first, then drifts home: quiet, no bounce.
      morph.target = 0;
      x.target = x.value;
      y.target = y.value;
      kick();
      clearTimeout(leaveTimer.current);
      leaving.current = true;
      const home = () => {
        if (mode.current === 'caret') return;
        // Mostly round again before it sets off.
        if (morph.value > 0.3 && levelRef.current !== 'off') {
          leaveTimer.current = window.setTimeout(home, 40);
          return;
        }
        leaving.current = false;
        rest();
        x.spring = GLIDE;
        y.spring = GLIDE;
        kick();
      };
      home();
    }
  }, [morph, x, y, sizeTo, kick, rest]);
  useEffect(() => {
    let frameReq = 0;
    const soon = () => {
      if (!frameReq) frameReq = requestAnimationFrame(() => ((frameReq = 0), syncCaret()));
    };
    const typed = () => {
      // Solid while typing; it starts to breathe again when you pause.
      layer.current?.setAttribute('data-typing', '');
      clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(() => layer.current?.removeAttribute('data-typing'), 650);
      soon();
    };
    // The terminal moves its hidden box and the code editor redraws its cursor without any
    // selection event (a reply arriving, a click in the editor): watch those for the focused field.
    const watch = new MutationObserver(soon);
    const track = () => {
      watch.disconnect();
      const el = document.activeElement;
      if (el?.classList.contains('xterm-helper-textarea')) watch.observe(el, { attributes: true, attributeFilter: ['style'] });
      const cursors = el?.closest('.cm-editor')?.querySelector('.cm-cursorLayer');
      if (cursors) watch.observe(cursors, { attributes: true, childList: true, subtree: true });
      soon();
    };
    // Focus moving between boxes passes through "nothing focused" for a moment: wait a frame.
    document.addEventListener('focusin', track);
    document.addEventListener('focusout', soon);
    document.addEventListener('selectionchange', soon);
    document.addEventListener('input', typed, true);
    document.addEventListener('keydown', typed, true);
    document.addEventListener('scroll', soon, { capture: true, passive: true });
    window.addEventListener('resize', soon);
    window.visualViewport?.addEventListener('resize', soon);
    window.visualViewport?.addEventListener('scroll', soon);
    return () => {
      cancelAnimationFrame(frameReq);
      clearTimeout(typingTimer.current);
      clearTimeout(leaveTimer.current);
      watch.disconnect();
      document.removeEventListener('focusin', track);
      document.removeEventListener('focusout', soon);
      document.removeEventListener('selectionchange', soon);
      document.removeEventListener('input', typed, true);
      document.removeEventListener('keydown', typed, true);
      document.removeEventListener('scroll', soon, { capture: true });
      window.removeEventListener('resize', soon);
      window.visualViewport?.removeEventListener('resize', soon);
      window.visualViewport?.removeEventListener('scroll', soon);
      delete document.documentElement.dataset.orbCaret;
    };
  }, [syncCaret]);

  useEffect(() => {
    let pending = 0;
    const soon = () => {
      if (!pending) pending = window.setTimeout(() => ((pending = 0), refocus()), 120);
    };
    const tick = window.setInterval(refocus, 700);
    window.addEventListener('resize', soon);
    window.visualViewport?.addEventListener('resize', soon);
    window.visualViewport?.addEventListener('scroll', soon);
    document.addEventListener('scroll', soon, { capture: true, passive: true });
    document.addEventListener('focusin', soon);
    document.addEventListener('focusout', soon);
    document.addEventListener('click', soon, true);
    return () => {
      clearInterval(tick);
      clearTimeout(pending);
      window.removeEventListener('resize', soon);
      window.visualViewport?.removeEventListener('resize', soon);
      window.visualViewport?.removeEventListener('scroll', soon);
      document.removeEventListener('scroll', soon, { capture: true });
      document.removeEventListener('focusin', soon);
      document.removeEventListener('focusout', soon);
      document.removeEventListener('click', soon, true);
    };
  }, [refocus]);

  // ---- shake: call it back, or stop what it's doing
  const summon = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      say('Stopped.');
    }
    cue('pop');
    const v = viewport();
    mode.current = 'acting';
    x.velocity += (Math.random() < 0.5 ? -1 : 1) * 1400;
    y.velocity -= 900;
    jelly.velocity += 5;
    moveTo(v.x + v.w / 2, v.y + v.h * 0.42, SPRINGS.summon);
    setTimeout(() => {
      // Back to following (or to its usual spot when it is set to stay put).
      mode.current = followSetting.current ? 'follow' : 'parked';
      spot.current = null;
      rest();
    }, 900);
  }, [moveTo, rest, say, x, y, jelly]);
  useEffect(() => {
    const shake = new ShakeDetector();
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.acceleration;
      if (!a || a.x == null || a.y == null) return;
      if (shake.push(performance.now(), a.x, a.y, a.z ?? 0)) summon();
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [summon]);

  // ---- touch: tap, deep press (pressure or hold), drag, fling
  const press = useRef<{
    id: number;
    x0: number;
    y0: number;
    /** Where that finger is now, and when it last moved. */
    cx: number;
    cy: number;
    tMove: number;
    dx: number;
    dy: number;
    t0: number;
    moved: boolean;
    deep: boolean;
    /** A second finger is pinching it now / did during this press (then letting go is not a tap). */
    pinching: boolean;
    pinched: boolean;
    holdTimer: number;
  } | null>(null);

  // ---- as a cursor: what it passes over lights up (as under a mouse), dropped on something it presses it
  const hover = useRef<{ el: HTMLElement; since: number } | null>(null);
  const pressableAt = (px: number, py: number): HTMLElement | null => {
    if (typeof document.elementsFromPoint !== 'function') return null;
    const hit = document.elementsFromPoint(px, py).find((e) => !layer.current?.contains(e));
    const cm = hit?.closest('.cm-editor')?.querySelector<HTMLElement>('.cm-content');
    const el = cm ?? hit?.closest<HTMLElement>(PRESSABLE) ?? null;
    if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return null;
    if (el.closest('[inert], [aria-hidden="true"]')) return null;
    return el;
  };
  const setHover = (el: HTMLElement | null) => {
    const prev = hover.current?.el ?? null;
    if (prev === el) return;
    const Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    if (prev) {
      prev.removeAttribute('data-orb-hover');
      prev.dispatchEvent(new Pointer('pointerout', { bubbles: true, relatedTarget: el }));
      prev.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: el }));
    }
    hover.current = el ? { el, since: performance.now() } : null;
    if (captionTimer.current) clearTimeout(captionTimer.current);
    if (el) {
      el.setAttribute('data-orb-hover', '');
      el.dispatchEvent(new Pointer('pointerover', { bubbles: true, relatedTarget: prev }));
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: prev }));
      tick();
      // It leans in a little, and says what it is over.
      grow.target = 1.12;
      jelly.velocity += 1.4;
      // Lingering on it a moment, it says what it is (not while just passing over).
      const label = (el.getAttribute('aria-label') || (el as HTMLInputElement).placeholder || el.textContent || '').replace(/\s+/g, ' ').trim();
      captionTimer.current = setTimeout(() => setCaption(label ? (label.length > 48 ? `${label.slice(0, 47)}…` : label) : null), 240);
    } else {
      grow.target = 1;
      setCaption(null);
    }
    kick();
  };
  /** Dropped on `el` at (px, py): a text box gets the caret right there, anything else is pressed. */
  const activate = (el: HTMLElement, px: number, py: number) => {
    mode.current = followSetting.current ? 'follow' : 'parked';
    x.spring = SPRINGS.land;
    y.spring = SPRINGS.land;
    depth.target = 0.9;
    jelly.velocity += 2;
    kick();
    window.setTimeout(() => ((depth.target = 0), kick()), 140);
    cue('tap');
    if ((el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && isText(el)) {
      // Where it landed, measured before focusing (focusing can move things: banners fold away).
      const at = offsetAt(el, px, py);
      el.focus({ preventScroll: true });
      try {
        el.setSelectionRange(at, at);
      } catch {
        /* type=number has no selection */
      }
      return; // it becomes the caret from here
    }
    if (el.isContentEditable) {
      el.focus({ preventScroll: true });
      const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
      const pos = doc.caretPositionFromPoint?.(px, py);
      const range = pos ? document.createRange() : document.caretRangeFromPoint?.(px, py);
      if (pos && range) range.setStart(pos.offsetNode, pos.offset);
      if (range && el.contains(range.startContainer)) {
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      return;
    }
    el.setAttribute('data-orb-pressed', '');
    window.setTimeout(() => el.removeAttribute('data-orb-pressed'), 260);
    if (el instanceof HTMLSelectElement) {
      el.focus();
      (el as HTMLSelectElement & { showPicker?: () => void }).showPicker?.();
    } else el.click();
    // Then back where it lives.
    window.setTimeout(() => {
      if (mode.current === 'follow' || mode.current === 'parked') rest();
    }, 320);
  };

  // ---- pinch: a second finger anywhere while one holds the orb stretches it (zoom in) or squeezes it
  // (zoom out); let go and the text size steps, and the orb bounces back to its own size.
  const pinchRef = useRef<{ id: number; x: number; y: number; d0: number; r: number } | null>(null);
  const unbind = useRef<(() => void) | null>(null);
  const zoomCaption = (r: number) => {
    const now = useShell.getState().settings.textScale;
    const next = zoomFor(r, now);
    if (captionTimer.current) clearTimeout(captionTimer.current);
    setCaption(`${r >= 1 ? 'Zoom in' : 'Zoom out'} · text ${Math.round(next * 100)}%`);
  };
  const pinchUpdate = () => {
    const p = press.current;
    const q = pinchRef.current;
    if (!p || !q) return;
    q.r = Math.max(0.2, Math.hypot(q.x - p.cx, q.y - p.cy) / q.d0);
    pinch.spring = PINCH_TRACK;
    pinch.target = stretchOf(q.r);
    zoomCaption(q.r);
    kick();
  };
  /** A pinch (or a trackpad pinch) of `r` is over: step the text size, bounce back. */
  const finishZoom = (r: number) => {
    const { settings, updateSettings } = useShell.getState();
    const next = zoomFor(r, settings.textScale);
    if (next !== settings.textScale) updateSettings({ textScale: next });
    cue('pop');
    pinch.spring = BOUNCE;
    pinch.target = 1;
    jelly.velocity += 2.5;
    kick();
    if (captionTimer.current) clearTimeout(captionTimer.current);
    setCaption(next === settings.textScale ? (r >= 1 ? 'Already the biggest text' : 'Already the smallest text') : `Text ${Math.round(next * 100)}%`);
    captionTimer.current = setTimeout(() => setCaption(null), 1600);
  };
  const endPinch = () => {
    const q = pinchRef.current;
    if (!q) return;
    pinchRef.current = null;
    if (press.current) press.current.pinching = false;
    finishZoom(q.r);
    // The second finger's touch must not also tap whatever it landed on.
    const swallow = (e: Event) => (e.preventDefault(), e.stopPropagation());
    window.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', swallow, true), 500);
  };
  const bindOthers = () => {
    const down = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId === p.id || pinchRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      pinchRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, d0: Math.max(24, Math.hypot(e.clientX - p.cx, e.clientY - p.cy)), r: 1 };
      p.pinching = true;
      p.pinched = true;
      clearTimeout(p.holdTimer);
      setHover(null);
      depth.target = 0.2;
      kick();
    };
    const move = (e: PointerEvent) => {
      const q = pinchRef.current;
      if (!q || e.pointerId !== q.id) return;
      e.preventDefault();
      q.x = e.clientX;
      q.y = e.clientY;
      pinchUpdate();
    };
    const up = (e: PointerEvent) => {
      if (pinchRef.current?.id === e.pointerId) endPinch();
    };
    // While it is held, the page must not scroll or zoom under a second finger.
    const still = (e: Event) => {
      if (pinchRef.current || (e as TouchEvent).touches?.length > 1) e.preventDefault();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    document.addEventListener('touchmove', still, { passive: false });
    document.addEventListener('gesturestart', still as EventListener);
    document.addEventListener('gesturechange', still as EventListener);
    unbind.current = () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      document.removeEventListener('touchmove', still);
      document.removeEventListener('gesturestart', still as EventListener);
      document.removeEventListener('gesturechange', still as EventListener);
      unbind.current = null;
    };
  };
  useEffect(() => () => unbind.current?.(), []);

  // A trackpad pinch (or Ctrl + scroll) over the orb does the same.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    let acc = 1;
    let timer = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      acc = Math.min(4, Math.max(0.25, acc * Math.exp(-e.deltaY * 0.01)));
      pinch.spring = PINCH_TRACK;
      pinch.target = stretchOf(acc);
      zoomCaption(acc);
      kick();
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        finishZoom(acc);
        acc = 1;
      }, 200);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      clearTimeout(timer);
      el.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const askMotionPermission = () => {
    const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DME?.requestPermission === 'function') void DME.requestPermission().catch(() => {});
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button > 0) return;
    e.preventDefault();
    body.current?.setPointerCapture(e.pointerId);
    askMotionPermission();
    tracker.reset();
    tracker.add(e.timeStamp, e.clientX, e.clientY);
    const p = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      cx: e.clientX,
      cy: e.clientY,
      tMove: e.timeStamp,
      dx: x.value - e.clientX,
      dy: y.value - e.clientY,
      t0: e.timeStamp,
      moved: false,
      deep: false,
      pinching: false,
      pinched: false,
      holdTimer: 0,
    };
    press.current = p;
    unbind.current?.();
    bindOthers();
    depth.target = 0.35;
    kick();
    // Holding still for a moment counts as a deep press (devices without pressure).
    p.holdTimer = window.setTimeout(() => {
      if (press.current === p && !p.moved) deepPress();
    }, DEEP_PRESS.holdMs);
  };

  const deepPress = () => {
    const p = press.current;
    if (!p || p.deep) return;
    p.deep = true;
    cue('pop');
    depth.target = 0.9;
    jelly.velocity += 4;
    kick();
    openPanel();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    tracker.add(e.timeStamp, e.clientX, e.clientY);
    p.cx = e.clientX;
    p.cy = e.clientY;
    p.tMove = e.timeStamp;
    if (p.pinching) return pinchUpdate();
    // Real pressure (3D Touch, Pencil, force trackpads) presses it in; a hard press acts like a hold.
    if (e.pressure > 0 && e.pressure !== 0.5 && !p.moved) {
      depth.target = 0.35 + e.pressure * 0.6;
      if (e.pressure >= DEEP_PRESS.force) deepPress();
      kick();
    }
    if (!p.moved && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > DEEP_PRESS.slopPx && !p.deep) {
      p.moved = true;
      clearTimeout(p.holdTimer);
      mode.current = 'drag';
      // Picked up off a spot or a stage: back to a cursor's size in the hand.
      sizeTo(1);
      seat.current = null;
      onStage.current = false;
      depth.target = 0.12;
      x.spring = SPRINGS.track;
      y.spring = SPRINGS.track;
    }
    if (p.moved) {
      const v = viewport();
      let tx = e.clientX + p.dx;
      let ty = e.clientY + p.dy;
      // As a cursor: what is under it lights up, and small things pull it in a little (magnetic).
      const over = pressableAt(tx, ty);
      setHover(over);
      // (Not text: there it goes exactly where you put it, between the letters you choose.)
      if (over && !isText(over)) {
        const r = over.getBoundingClientRect();
        if (r.width < 240 && r.height < 120) {
          tx += (r.left + r.width / 2 - tx) * 0.3;
          ty += (r.top + r.height / 2 - ty) * 0.3;
        }
      }
      // Past the edges it pulls back like a rubber band.
      x.target = rubberClamp(tx, v.x + R, v.x + v.w - R, v.w * 0.25);
      y.target = rubberClamp(ty, v.y + R, v.y + v.h - R, v.h * 0.25);
      kick();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    press.current = null;
    clearTimeout(p.holdTimer);
    unbind.current?.();
    depth.target = 0;
    kick();
    const over = hover.current;
    setHover(null);
    if (p.pinched) {
      // Letting go after a pinch: the zoom is done (it bounced back); this is not a tap or a throw.
      endPinch();
      if (p.moved) {
        // It was carried on after the pinch: it stays where it was put down, like any drop.
        mode.current = 'parked';
        // Inside the screen (a drag past the edge only rubber-bands).
        const v = viewport();
        x.target = Math.min(v.x + v.w - R, Math.max(v.x + R, x.target));
        y.target = Math.min(v.y + v.h - R, Math.max(v.y + R, y.target));
        spot.current = { x: x.target, y: y.target };
        kick();
      }
      return;
    }
    if (p.moved) {
      // A finger that stopped before letting go set it down; it did not throw it.
      const stopped = e.timeStamp - p.tMove > 150;
      const vel = stopped ? { x: 0, y: 0 } : tracker.velocity();
      const v = viewport();
      const speed = Math.hypot(vel.x, vel.y);
      // Set down on something (the finger rested on it a moment): it presses it, or types there.
      // A throw that happens to end over a button never presses it.
      if (over && stopped && performance.now() - over.since > 160) {
        activate(over.el, x.target, y.target);
        return;
      }
      x.spring = SPRINGS.land;
      y.spring = SPRINGS.land;
      // The spring starts at the finger's speed, so the throw carries on naturally.
      x.velocity = vel.x;
      y.velocity = vel.y;
      if (speed < 350) {
        // Set down gently: it stays right there.
        x.target = Math.min(v.x + v.w - R, Math.max(v.x + R, x.target));
        y.target = Math.min(v.y + v.h - R, Math.max(v.y + R, y.target));
        mode.current = 'parked';
      } else {
        // From where the finger let go (the drawn orb trails it by a few ms).
        const land = landing({ x: x.target, y: y.target }, vel, v, SIZE);
        if (land.tuck) {
          mode.current = 'tucked';
          x.target = v.x + v.w - R * 0.5;
          y.target = v.y + v.h - 150;
          say('Tucked away. Tap the edge or shake to bring me back.');
        } else {
          mode.current = 'parked';
          x.target = land.x;
          y.target = land.y;
        }
      }
      spot.current = { x: x.target, y: y.target };
      cue('tap');
      kick();
      return;
    }
    if (p.deep) return;
    // A tap. On a stage that is a button (the voice orb), the tap is that button's.
    if (onStage.current && seat.current instanceof HTMLButtonElement) {
      jelly.velocity += 2.5;
      kick();
      seat.current.click();
      return;
    }
    if (mode.current === 'tucked') {
      mode.current = follow ? 'follow' : 'parked';
      spot.current = null;
      jelly.velocity += 3;
      rest();
      return;
    }
    jelly.velocity += 2.5;
    kick();
    toggleVoice();
  };

  const onPointerCancel = () => {
    const p = press.current;
    if (p) clearTimeout(p.holdTimer);
    press.current = null;
    unbind.current?.();
    pinchRef.current = null;
    pinch.spring = BOUNCE;
    pinch.target = 1;
    setHover(null);
    depth.target = 0;
    if (mode.current === 'drag') mode.current = 'parked';
    kick();
  };

  // ---- acting on the page, as a cursor
  const aimAt = useCallback(
    async (el: HTMLElement, signal: AbortSignal) => {
      const before = el.getBoundingClientRect();
      const offscreen = before.bottom < 0 || before.top > innerHeight;
      el.scrollIntoView?.({ block: offscreen ? 'center' : 'nearest', behavior: levelRef.current === 'full' ? 'smooth' : 'auto' });
      await wait(levelRef.current === 'full' ? (offscreen ? 420 : 180) : 30);
      const r = el.getBoundingClientRect();
      // Look where it's going.
      const dx = r.left + r.width / 2 - x.value, dy = r.top + r.height / 2 - y.value;
      const dist = Math.max(1, Math.hypot(dx, dy));
      setGaze([dx / dist, -dy / dist]);
      clearTimeout(faceTimers.current.gaze);
      faceTimers.current.gaze = setTimeout(() => setGaze(null), 1400);
      mode.current = 'acting';
      moveTo(r.left + r.width / 2, r.top + r.height / 2, AIM);
      const t0 = performance.now();
      while (!signal.aborted && performance.now() - t0 < 900 && Math.hypot(x.value - x.target, y.value - y.target) > 4) await wait(16);
      // Press it like a finger would.
      depth.target = 1;
      kick();
      await wait(110);
      depth.target = 0;
      kick();
    },
    [moveTo, x, y, depth, kick],
  );

  const ask = (text: string) =>
    new Promise<boolean>((resolve) => {
      setPanel(true);
      setConfirm({ text, resolve });
    });

  const exec = useCallback(
    async (step: Step, signal: AbortSignal, spoken: boolean): Promise<string> => {
      const shell = useShell.getState();
      const items = () => snapshot(layer.current, document, { all: true });
      const findSoon = async (target: string, roles?: Parameters<typeof findItem>[2]) => {
        for (let i = 0; i < 12 && !signal.aborted; i++) {
          const hit = findItem(items(), target, roles);
          if (hit) return hit;
          await wait(130);
        }
        return null;
      };
      switch (step.do) {
        case 'open':
          shell.launch(step.app);
          await wait(420);
          return `Opened ${APP_NAME[step.app] ?? step.app}`;
        case 'home':
          shell.goHome();
          await wait(300);
          return 'Home';
        case 'back': {
          const b = await findSoon('Back|All movies|All chats|All sessions|Close', ['button']);
          if (b) {
            await aimAt(b.el, signal);
            b.el.click();
            return `Tapped ${b.label}`;
          }
          shell.goHome();
          return 'Home';
        }
        case 'click': {
          const it = await findSoon(step.target);
          if (!it) throw new Error(`I can't see “${step.target.split('|')[0]}” on this screen.`);
          const warn = needsConfirm(step, it.label);
          if (warn && !(await ask(warn))) return 'Skipped';
          await aimAt(it.el, signal);
          if (signal.aborted) return 'Stopped';
          it.el.focus?.({ preventScroll: true });
          it.el.click();
          await wait(260);
          return `Tapped ${it.label}`;
        }
        case 'type': {
          let field: HTMLElement | null = null;
          if (step.target) field = (await findSoon(step.target, ['field']))?.el ?? null;
          const active = document.activeElement as HTMLElement | null;
          if (!field && active?.matches('input, textarea, [contenteditable="true"]') && !layer.current?.contains(active)) field = active;
          if (!field) field = items().find((i) => i.role === 'field')?.el ?? null;
          if (!field) throw new Error('There is no box to type in on this screen.');
          await aimAt(field, signal);
          field.focus({ preventScroll: true });
          // Typed in visibly, a few letters at a time.
          const full = step.text;
          const chunk = Math.max(2, Math.ceil(full.length / 18));
          for (let i = chunk; i < full.length && levelRef.current !== 'off' && !signal.aborted; i += chunk) {
            setFieldValue(field, full.slice(0, i));
            await wait(22);
          }
          setFieldValue(field, full);
          if (step.submit) {
            await wait(120);
            submitField(field);
          }
          return `Typed “${full.length > 40 ? `${full.slice(0, 40)}…` : full}”`;
        }
        case 'scroll': {
          const sc = mainScroller(layer.current);
          if (!sc) return 'Nothing to scroll';
          const behavior: ScrollBehavior = levelRef.current === 'off' ? 'auto' : 'smooth';
          if (step.dir === 'top') sc.scrollTo({ top: 0, behavior });
          else if (step.dir === 'bottom') sc.scrollTo({ top: sc.scrollHeight, behavior });
          else sc.scrollBy({ top: (step.dir === 'down' ? 1 : -1) * sc.clientHeight * 0.8, behavior });
          await wait(300);
          return `Scrolled ${step.dir}`;
        }
        case 'setting': {
          const patch = settingPatch(step, shell.settings);
          if (!patch) throw new Error(`I don't know the setting “${step.value}”.`);
          shell.updateSettings(patch);
          return 'Done';
        }
        case 'machine': {
          const warn = needsConfirm(step);
          if (warn && !(await ask(warn))) return 'Left it off';
          const res = await fetch('/api/status', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ machine: step.which, action: step.power === 'on' ? 'start' : 'stop' }),
          }).catch(() => null);
          if (!res || res.status === 404) throw new Error('Machines can only be switched from your workspace site, not this preview.');
          if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'That didn’t work.');
          return `${step.which === 'ai' ? 'AI' : 'Linux'} machine turning ${step.power}${step.power === 'on' ? ' (2–4 minutes)' : ''}`;
        }
        case 'say':
        case 'done':
          if ('say' in step && step.say) say(step.say, spoken);
          if (step.do === 'say') say(step.text, spoken);
          return '';
      }
    },
    [aimAt, say],
  );

  /** Find across chats, files and sessions; "bring" carries the best match into your last text box. */
  const find = useCallback(
    async (query: string, bring: boolean, signal: AbortSignal, spoken: boolean) => {
      setCaption('Looking…');
      let hits = await findStuff(query, signal);
      if (hits.length > 2 && (await cloudReady())) hits = await rerank(query, hits, signal);
      if (signal.aborted) return;
      if (!hits.length) return say(`I couldn’t find anything about “${query}”.`, spoken);
      const field = lastField.current;
      if (bring && field?.isConnected) {
        const top = hits[0];
        const text = (await top.text()).slice(0, 6000);
        if (!text) return say(`I found “${top.title}” but it has nothing to bring.`, spoken);
        setPanel(false);
        await aimAt(field as HTMLElement, signal);
        insertText(field, text);
        cue('done');
        flash(1);
        return say(`Brought “${top.title}”.`, spoken);
      }
      setFound(hits.slice(0, 6));
      say(hits.length === 1 ? `Found “${hits[0].title}”.` : `Found ${hits.length} things. The best match is “${hits[0].title}”.`, spoken);
    },
    [aimAt, say],
  );

  /** Explain what is on screen: its text, plus the biggest pictures when there are any (cloud AI). */
  const explain = useCallback(
    async (goal: string, signal: AbortSignal, spoken: boolean) => {
      setCaption('Looking…');
      const text = screenText(document.body, 5000);
      const pictures = await screenPictures(2);
      const question = `${goal}\n\nApp: ${useShell.getState().activeApp ?? 'home'}\nText on screen:\n${text || '(no text)'}`;
      let answer = '';
      await cloudChat(
        {
          task: pictures.length ? 'vision' : 'fast',
          maxTokens: 500,
          temperature: 0.3,
          signal,
          messages: [
            { role: 'system', content: EXPLAIN_PROMPT },
            { role: 'user', content: pictures.length ? [{ type: 'text', text: question }, ...pictures.map((url) => ({ type: 'image_url' as const, image_url: { url } }))] : question },
          ],
        },
        { onText: (d) => (answer += d) },
      );
      say(answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || 'I couldn’t make sense of this screen.', spoken);
    },
    [say],
  );

  /** The model plans one step at a time against a fresh look at the screen. */
  const plan = useCallback(
    async (goal: string, signal: AbortSignal, spoken: boolean) => {
      // Cloud AI first (quick, works with the AI machine off); the AI machine is the fallback.
      let ask: ((messages: ChatMessage[], h: StreamHandlers) => Promise<unknown>) | null = null;
      const local = async () => {
        const ai = getLocalAi();
        const status = await ai.status().catch(() => null);
        if (status?.state !== 'on') return null;
        const models = await ai.listModels().catch(() => []);
        if (!models.length) return 'no-model' as const;
        return (messages: ChatMessage[], h: StreamHandlers) => ai.chat(models[0], messages, h, signal);
      };
      if (await cloudReady()) {
        ask = async (messages, h) => {
          try {
            return await cloudChat({ task: 'agent', messages, maxTokens: 1024, temperature: 0.2, signal }, h);
          } catch (err) {
            if (signal.aborted) throw err;
            const fallback = await local();
            if (typeof fallback !== 'function') throw err;
            return fallback(messages, h);
          }
        };
      } else {
        const fallback = await local();
        if (fallback === 'no-model') return say('Add a chat model on your AI machine first.', spoken);
        if (!fallback) {
          say('I can do simple things now (open apps, tap, type, settings). For anything else turn on Cloud AI in Settings, or say “turn on the AI machine”.', spoken);
          return;
        }
        ask = fallback;
      }
      const history: string[] = [];
      for (let i = 0; i < 8 && !signal.aborted; i++) {
        const items = snapshot(layer.current);
        let text = '';
        await ask(
          [
            { role: 'system', content: PLANNER_PROMPT },
            {
              role: 'user',
              content: `Goal: ${goal}\nDone so far: ${history.length ? history.join('; ') : 'nothing yet'}\n\n${describe(items, useShell.getState().activeApp)}\n\nText on screen:\n${screenText(document.body, 1500) || '(none)'}`,
            },
          ],
          { onText: (d) => (text += d) },
        );
        let step = parseStep(text);
        if (!step) return say('I couldn’t work out how to do that.', spoken);
        // Item numbers become the real labels.
        if ((step.do === 'click' || step.do === 'type') && step.target && /^#?\d+$/.test(step.target.trim())) {
          const it = findItem(items, step.target);
          if (!it) return say('I lost track of the screen. Try again?', spoken);
          step = { ...step, target: it.label };
        }
        if (step.do === 'done') {
          flash(1);
          say(step.say || 'Done.', spoken);
          return;
        }
        const out = await exec(step, signal, spoken);
        if (out) {
          history.push(out);
          setLines((l) => [...l, { who: 'orb', text: out }]);
          setCaption(out);
        }
      }
    },
    [exec, say],
  );

  const run = useCallback(
    async (text: string, spoken: boolean) => {
      const goal = text.trim();
      if (!goal) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setRunning(true);
      setFound(null);
      setLines((l) => [...l.slice(-30), { who: 'you', text: goal }]);
      const before = mode.current;
      try {
        const steps = parseCommand(goal);
        if (steps) {
          for (const s of steps) {
            if (ctrl.signal.aborted) break;
            const out = await exec(s, ctrl.signal, spoken);
            if (out) {
              setLines((l) => [...l, { who: 'orb', text: out }]);
              setCaption(out);
            }
          }
          if (steps.length && !ctrl.signal.aborted && steps[steps.length - 1].do !== 'say') {
            cue('done');
            flash(1);
          }
        } else {
          const wants = findIntent(goal);
          if (wants) await find(wants.query, wants.bring, ctrl.signal, spoken);
          else if (isExplain(goal) && (await cloudReady())) await explain(goal, ctrl.signal, spoken);
          else await plan(goal, ctrl.signal, spoken);
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          cue('error');
          flash(-1);
          say((err as Error).message, spoken);
        }
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setRunning(false);
        mode.current = before === 'acting' || before === 'drag' ? (followSetting.current ? 'follow' : 'parked') : before;
        // Back where it lives: beside what matters, the spot you put it, or the caret of the box it typed in.
        setTimeout(() => {
          rest();
          syncCaret();
        }, 250);
      }
    },
    [exec, explain, find, plan, rest, say, syncCaret],
  );

  // ---- voice
  const toggleVoice = () => {
    if (listenRef.current) {
      listenRef.current.finish();
      return;
    }
    if (!canListen()) {
      openPanel();
      return;
    }
    cue('tap');
    setListening(true);
    setCaption('Listening…');
    let lastLevel = 0;
    listenRef.current = listen({
      onLevel: (v) => {
        const now = performance.now();
        if (now - lastLevel > 70) {
          lastLevel = now;
          setEnergy(0.25 + v * 0.75);
        }
        depth.target = -v * 0.25; // swells a little with your voice
        kick();
      },
      onPartial: (t) => setCaption(t || 'Listening…'),
      onDone: (t) => {
        listenRef.current = null;
        setListening(false);
        setEnergy(undefined);
        depth.target = 0;
        void run(t, true);
      },
      onError: (msg) => {
        listenRef.current = null;
        setListening(false);
        setEnergy(undefined);
        depth.target = 0;
        say(msg);
      },
    });
  };
  useEffect(() => () => listenRef.current?.cancel(), []);

  // ---- the ask panel
  // "Make from anywhere": other parts of Orbit (the Rewrite menu…) hand the orb a request.
  useEffect(() => {
    const onRun = (e: Event) => {
      const goal = (e as CustomEvent<string>).detail;
      if (typeof goal !== 'string' || !goal.trim()) return;
      setPanel(true);
      void run(goal, false);
    };
    window.addEventListener('orbit:orb-run', onRun);
    return () => window.removeEventListener('orbit:orb-run', onRun);
  }, [run]);
  const openPanel = () => setPanel(true);
  // Sleepy when there is no AI to think with (cloud AI off or not set up, and the AI machine off).
  useEffect(() => {
    if (!panel) return;
    let live = true;
    void (async () => {
      const ok = (await cloudReady()) || (await getLocalAi().status().catch(() => null))?.state === 'on';
      if (live) setSleepy(!ok);
    })();
    return () => {
      live = false;
    };
  }, [panel]);
  const busyFace = running || listening;
  const expression = moodFlash > 0 ? 'done' : moodFlash < 0 ? 'error' : listening ? 'listening' : running ? 'thinking' : talking ? 'speaking' : panel ? (sleepy ? 'sleepy' : 'idle') : 'off';
  const face: OrbFace = {
    on: expression !== 'off' && level !== 'off',
    // Thinking looks up and aside; listening looks at you; otherwise where it's acting.
    gaze: gaze ?? (running && !talking ? [0.35, 0.45] : [0, 0]),
    mood: moodFlash || (talking ? 0.35 : busyFace ? 0 : 0.15),
    talk: talking,
    sleepy: expression === 'sleepy',
  };
  const closePanel = () => {
    setPanel(false);
    confirm?.resolve(false);
    setConfirm(null);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        setPanel((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const submitDraft = (e: React.FormEvent) => {
    e.preventDefault();
    const t = draft;
    setDraft('');
    void run(t, false);
  };

  const pageHelp = () => {
    const items = snapshot(layer.current).slice(0, 8);
    return items.length ? `On this screen: ${items.map((i) => i.label).join(', ')}. Ask me to tap, type, open or change anything.` : 'Ask me to open an app, change a setting or make something.';
  };

  return (
    <div ref={layer} className="orb-layer" data-caret={caretOn || undefined} data-hidden={hidden || undefined} data-listening={listening || undefined} data-running={running || undefined} data-face={expression}>
      <button
        ref={body}
        type="button"
        className="orb-cursor"
        aria-label={listening ? 'Orb: listening. Tap to stop.' : 'Orb: tap to talk, hold to ask it to do something'}
        aria-expanded={panel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (e.shiftKey) openPanel();
            else if (onStage.current && seat.current instanceof HTMLButtonElement) seat.current.click();
            else toggleVoice();
          }
        }}
        onClick={(e) => {
          // Keyboard "clicks" are handled above; pointer taps by the pointer handlers.
          if (e.detail === 0) e.preventDefault();
        }}
      >
        <AiOrb typing={running} energy={energy ?? stageEnergy ?? (running ? 0.8 : undefined)} resolution={faceRes} className="orb-cursor-face" face={face} />
        <span className="orb-cursor-ring" aria-hidden />
      </button>

      {caption && !panel && (
        <p className="orb-caption" role="status" aria-live="polite">
          {caption}
        </p>
      )}

      {panel && (
        <div className="orb-panel" role="dialog" aria-label="Ask the orb">
          <div className="orb-panel-head">
            <p className="orb-panel-title">What should I do?</p>
            <button type="button" className="icon-btn" aria-label="Close" onClick={closePanel}>
              <Icon name="close" size={18} />
            </button>
          </div>
          {lines.length > 0 && (
            <ol className="orb-log" aria-label="What happened">
              {lines.slice(-8).map((l, i) => (
                <li key={i} data-who={l.who}>
                  {l.text}
                </li>
              ))}
            </ol>
          )}
          {found && found.length > 0 && (
            <ul className="orb-found" aria-label="Found">
              {found.map((h) => (
                <li key={`${h.kind}:${h.id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setFound(null);
                      setPanel(false);
                      h.open();
                    }}
                  >
                    <span className="orb-found-kind">{h.kind === 'chat' ? 'Chat' : h.kind === 'file' ? 'File' : 'Session'}</span>
                    <span className="orb-found-title">{h.title}</span>
                    <span className="orb-found-snippet">{h.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {confirm ? (
            <div className="orb-confirm" role="alertdialog" aria-label="Confirm">
              <p>{confirm.text}</p>
              <div className="row-inline">
                <button type="button" className="btn ghost" onClick={() => (confirm.resolve(false), setConfirm(null))}>
                  No
                </button>
                <button type="button" className="btn primary" onClick={() => (confirm.resolve(true), setConfirm(null))}>
                  Yes, do it
                </button>
              </div>
            </div>
          ) : (
            <>
              {lines.length === 0 && (
                <div className="orb-suggest" aria-label="Ideas">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="chip"
                      onClick={() => (s === 'What can I do here?' ? (setLines([{ who: 'you', text: s }]), say(pageHelp())) : void run(s, false))}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <form className="orb-ask" onSubmit={submitDraft}>
                <input
                  className="input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Open Code, make a video of waves, dark mode…"
                  aria-label="Tell the orb what to do"
                  autoFocus
                  enterKeyHint="go"
                />
                {running ? (
                  <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>
                    Stop
                  </button>
                ) : (
                  <>
                    {canListen() && (
                      <button type="button" className="icon-btn" aria-label="Say it instead" onClick={() => (setPanel(false), toggleVoice())}>
                        <Icon name="mic" size={18} />
                      </button>
                    )}
                    <button type="submit" className="btn primary" disabled={!draft.trim()}>
                      Go
                    </button>
                  </>
                )}
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}

