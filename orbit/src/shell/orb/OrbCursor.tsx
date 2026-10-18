import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShell, type AppId } from '../../state/shell';
import { useMotionLevel } from '../../motion/MotionProvider';
import { cue } from '../../motion/feedback';
import { getLocalAi } from '../../services/ai/LocalAi';
import { AiOrb } from '../../apps/ai/AiOrb';
import { canSpeak, createSpeaker } from '../../apps/ai/speech';
import { Icon } from '../../ui/Icon';
import { DEEP_PRESS, SPRINGS, ShakeDetector, SpringValue, VelocityTracker, landing, rubberClamp, spring, stretchFor, type Rect } from './physics';
import { findFocus, restSpot } from './attention';
import { caretField, caretOf } from './caret';
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
/** Orb ⇄ caret shape change: quick, with a hint of give. */
const MORPH = spring(0.3, 0.74);
const CARET_W = 2.5;

type Mode = 'follow' | 'parked' | 'tucked' | 'drag' | 'acting' | 'caret';
type Line = { who: 'you' | 'orb'; text: string };

const APP_NAME: Record<AppId, string> = { terminal: 'Terminal', editor: 'Code', agent: 'Antigravity', ai: 'AI', soreal: 'soReal', settings: 'Settings' };
const SUGGESTIONS = ['Open Terminal', 'Make a picture of a red fox in snow', 'Dark mode', 'What can I do here?', 'Turn on the AI machine'];

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
  const [caption, setCaption] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [confirm, setConfirm] = useState<{ text: string; resolve: (ok: boolean) => void } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [draft, setDraft] = useState('');
  const listenRef = useRef<Listening | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const captionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((text: string, spoken = false) => {
    setLines((l) => [...l.slice(-30), { who: 'orb', text }]);
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
      morph.step(dt);
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
        const cw = 1 + (CARET_W / SIZE - 1) * m;
        const ch = 1 + (caretH.current / SIZE - 1) * m;
        el.style.transform = `translate3d(${x.value - R}px, ${y.value - R}px, 0) scale(${cw}, ${ch}) rotate(${angle}rad) scale(${s * press}, ${press / s}) rotate(${-angle}rad)`;
        el.style.setProperty('--depth', Math.max(0, depth.value).toFixed(3));
      }
      layer.current?.style.setProperty('--orb-x', `${x.value}px`);
      layer.current?.style.setProperty('--orb-y', `${y.value}px`);
      const still = x.resting() && y.resting() && depth.resting(0.002) && jelly.resting(0.002) && morph.resting(0.002);
      raf.current = mode.current === 'drag' || !still ? requestAnimationFrame(frame) : 0;
    },
    [x, y, depth, jelly, morph, tracker],
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
  const refocus = useCallback(() => {
    const modal = [...document.querySelectorAll('[aria-modal="true"]')].some((d) => !layer.current?.contains(d));
    setHidden(modal || overlay === 'index');
    if (mode.current !== 'follow') return;
    const f = findFocus(viewport(), SIZE, layer.current);
    if (f.el !== lastFocus.current) {
      lastFocus.current = f.el;
      // A little nod when it turns to something new.
      if (f.el && levelRef.current === 'full') jelly.velocity += 1.6;
    }
    moveTo(f.x, f.y);
  }, [overlay, moveTo, jelly]);

  // Only a change of the setting itself switches between following and staying put.
  const followSetting = useRef(follow);
  useEffect(() => {
    if (followSetting.current === follow) return;
    followSetting.current = follow;
    mode.current = follow ? 'follow' : 'parked';
    refocus();
  }, [follow, refocus]);
  /** Where it was put down (parked or tucked), to go back to after doing something. */
  const spot = useRef<{ x: number; y: number } | null>(null);
  const rest = useCallback(() => {
    if (mode.current === 'follow') return refocus();
    const p = spot.current ?? restSpot(viewport(), SIZE);
    moveTo(p.x, p.y, SPRINGS.land);
  }, [refocus, moveTo]);

  // ---- the text cursor: while you type in a box, the orb becomes its caret
  const [caretOn, setCaretOn] = useState(false);
  const caretMode = useRef<Mode | null>(null); // the mode to go back to
  const typingTimer = useRef(0);
  const syncCaret = useCallback(() => {
    const field = caretField(document.activeElement, layer.current);
    const busy = mode.current === 'drag' || mode.current === 'acting';
    const c = field && !busy ? caretOf(field as HTMLElement) : null;
    if (c) {
      if (mode.current !== 'caret') {
        caretMode.current = mode.current;
        mode.current = 'caret';
        setCaretOn(true);
        document.documentElement.dataset.orbCaret = '';
      }
      caretH.current = Math.max(12, Math.min(48, c.h));
      morph.target = 1;
      // Centre of the caret: on the gap before the next letter, halfway down the line.
      const cx = c.x + CARET_W / 2;
      const cy = c.y + c.h / 2;
      if (levelRef.current === 'off') {
        morph.set(1);
        x.set(cx);
        y.set(cy);
      } else {
        x.spring = CARET;
        y.spring = CARET;
        x.target = cx;
        y.target = cy;
      }
      kick();
    } else if (mode.current === 'caret') {
      mode.current = caretMode.current ?? (followSetting.current ? 'follow' : 'parked');
      caretMode.current = null;
      setCaretOn(false);
      delete document.documentElement.dataset.orbCaret;
      morph.target = 0;
      jelly.velocity += 2; // a little pop back into a ball
      rest();
    }
  }, [morph, x, y, jelly, kick, rest]);
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
    // Focus moving between boxes passes through "nothing focused" for a moment: wait a frame.
    document.addEventListener('focusin', soon);
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
      document.removeEventListener('focusin', soon);
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
  const press = useRef<{ id: number; x0: number; y0: number; dx: number; dy: number; t0: number; moved: boolean; deep: boolean; holdTimer: number } | null>(null);

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
      dx: x.value - e.clientX,
      dy: y.value - e.clientY,
      t0: e.timeStamp,
      moved: false,
      deep: false,
      holdTimer: 0,
    };
    press.current = p;
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
      depth.target = 0.12;
      x.spring = SPRINGS.track;
      y.spring = SPRINGS.track;
    }
    if (p.moved) {
      const v = viewport();
      // Past the edges it pulls back like a rubber band.
      x.target = rubberClamp(e.clientX + p.dx, v.x + R, v.x + v.w - R, v.w * 0.25);
      y.target = rubberClamp(e.clientY + p.dy, v.y + R, v.y + v.h - R, v.h * 0.25);
      kick();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    press.current = null;
    clearTimeout(p.holdTimer);
    depth.target = 0;
    kick();
    if (p.moved) {
      const vel = tracker.velocity();
      const v = viewport();
      const speed = Math.hypot(vel.x, vel.y);
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
    // A tap.
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

  /** The model plans one step at a time against a fresh look at the screen. */
  const plan = useCallback(
    async (goal: string, signal: AbortSignal, spoken: boolean) => {
      const ai = getLocalAi();
      const status = await ai.status().catch(() => null);
      if (status?.state !== 'on') {
        say('I can do simple things now (open apps, tap, type, settings). For anything else your AI machine needs to be on: say “turn on the AI machine”.', spoken);
        return;
      }
      const models = await ai.listModels().catch(() => []);
      if (!models.length) return say('Add a chat model on your AI machine first.', spoken);
      const history: string[] = [];
      for (let i = 0; i < 8 && !signal.aborted; i++) {
        const items = snapshot(layer.current);
        let text = '';
        await ai.chat(
          models[0],
          [
            { role: 'system', content: PLANNER_PROMPT },
            { role: 'user', content: `Goal: ${goal}\nDone so far: ${history.length ? history.join('; ') : 'nothing yet'}\n\n${describe(items, useShell.getState().activeApp)}` },
          ],
          { onText: (d) => (text += d) },
          signal,
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
          if (steps.length && !ctrl.signal.aborted && steps[steps.length - 1].do !== 'say') cue('done');
        } else {
          await plan(goal, ctrl.signal, spoken);
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          cue('error');
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
    [exec, plan, rest, say, syncCaret],
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
  const openPanel = () => setPanel(true);
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
    <div ref={layer} className="orb-layer" data-caret={caretOn || undefined} data-hidden={hidden || undefined} data-listening={listening || undefined} data-running={running || undefined}>
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
            else toggleVoice();
          }
        }}
        onClick={(e) => {
          // Keyboard "clicks" are handled above; pointer taps by the pointer handlers.
          if (e.detail === 0) e.preventDefault();
        }}
      >
        <AiOrb typing={running} energy={energy ?? (running ? 0.8 : undefined)} className="orb-cursor-face" />
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

