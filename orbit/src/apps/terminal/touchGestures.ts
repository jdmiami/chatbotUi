/**
 * Touch gestures for the terminal:
 *  - one-finger vertical swipe: scroll (with momentum after the finger lifts),
 *  - two-finger pinch: text size,
 *  - long-press: "Select and copy",
 *  - tap: handed to the app (focus the typing box).
 * Horizontal swipes are left alone. Listeners run in the capture phase so xterm's own (patchy, under
 * tmux) touch scrolling never runs at the same time.
 */

export interface TouchGestureHandlers {
  /** Height of one terminal row in CSS px. */
  lineHeight: () => number;
  /** Scroll by whole lines; negative = back (towards older output). */
  scroll: (lines: number) => void;
  pinch: (scale: number, phase: 'start' | 'move' | 'end') => void;
  longPress: () => void;
  /** Return true when the tap was handled (then the browser's own click is suppressed). */
  tap: () => boolean;
}

/** Converts finger movement (px) into whole lines, keeping the remainder for the next move. */
export class LineAccumulator {
  private rest = 0;
  constructor(private readonly lineHeight: () => number) {}
  /** dy > 0 = finger moved down = show older lines = negative scroll. */
  push(dy: number): number {
    const h = Math.max(4, this.lineHeight());
    this.rest += dy;
    const lines = Math.trunc(this.rest / h);
    this.rest -= lines * h;
    return lines === 0 ? 0 : -lines;
  }
  reset() {
    this.rest = 0;
  }
}

/** Momentum after a fling: velocity (px/ms) decays per 16 ms frame; returns px moved this frame. */
export function momentumStep(velocity: number, dtMs: number, friction = 0.95): { dy: number; velocity: number } {
  const dy = velocity * dtMs;
  return { dy, velocity: velocity * Math.pow(friction, dtMs / 16) };
}

const MOVE_SLOP = 8; // px before a touch counts as a swipe
const LONG_PRESS_MS = 550;
const TAP_MS = 450;

export function attachTouchGestures(el: HTMLElement, h: TouchGestureHandlers): () => void {
  type Mode = 'idle' | 'pending' | 'scroll' | 'horizontal' | 'pinch' | 'long';
  let mode: Mode = 'idle';
  let startX = 0;
  let startY = 0;
  let startAt = 0;
  let lastY = 0;
  let lastAt = 0;
  let velocity = 0; // px per ms, + = finger moving down
  let pinchStart = 1;
  let longTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  const acc = new LineAccumulator(h.lineHeight);

  const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
  const stopMomentum = () => cancelAnimationFrame(frame);
  const swallow = (e: TouchEvent) => {
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
  };

  const onStart = (e: TouchEvent) => {
    stopMomentum();
    clearTimeout(longTimer);
    if (e.touches.length === 2) {
      mode = 'pinch';
      pinchStart = spread(e.touches);
      h.pinch(1, 'start');
      swallow(e);
      return;
    }
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    mode = 'pending';
    startX = t.clientX;
    startY = lastY = t.clientY;
    // Event timestamps (when the finger moved), not handling time: a busy page must not make a
    // quick flick look like a slow drag.
    startAt = lastAt = e.timeStamp;
    velocity = 0;
    acc.reset();
    longTimer = setTimeout(() => {
      if (mode === 'pending') {
        mode = 'long';
        h.longPress();
      }
    }, LONG_PRESS_MS);
  };

  const onMove = (e: TouchEvent) => {
    if (mode === 'pinch') {
      if (e.touches.length === 2) h.pinch(spread(e.touches) / pinchStart, 'move');
      swallow(e);
      return;
    }
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (mode === 'pending') {
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.hypot(dx, dy) < MOVE_SLOP) return;
      clearTimeout(longTimer);
      mode = Math.abs(dy) >= Math.abs(dx) ? 'scroll' : 'horizontal';
    }
    if (mode === 'long') {
      swallow(e);
      return;
    }
    if (mode !== 'scroll') return;
    swallow(e);
    const now = e.timeStamp;
    const dy = t.clientY - lastY;
    const dt = Math.max(1, now - lastAt);
    velocity = 0.7 * velocity + 0.3 * (dy / dt);
    lastY = t.clientY;
    lastAt = now;
    const lines = acc.push(dy);
    if (lines) h.scroll(lines);
  };

  const onEnd = (e: TouchEvent) => {
    clearTimeout(longTimer);
    if (mode === 'pinch') {
      if (e.touches.length < 2) {
        mode = 'idle';
        h.pinch(1, 'end');
      }
      swallow(e);
      return;
    }
    if (e.touches.length > 0) return;
    const was = mode;
    mode = 'idle';
    if (was === 'long') {
      swallow(e);
    } else if (was === 'scroll') {
      swallow(e);
      // A finger resting before lifting means no fling.
      if (e.timeStamp - lastAt > 100 || Math.abs(velocity) < 0.25) return;
      let v = velocity;
      let prev = performance.now();
      const started = prev;
      const tick = (now: number) => {
        const step = momentumStep(v, Math.min(48, now - prev));
        prev = now;
        v = step.velocity;
        const lines = acc.push(step.dy);
        if (lines) h.scroll(lines);
        if (Math.abs(v) > 0.03 && now - started < 2500) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    } else if (was === 'pending' && e.type === 'touchend' && e.timeStamp - startAt < TAP_MS) {
      if (h.tap() && e.cancelable) e.preventDefault();
    }
  };

  el.addEventListener('touchstart', onStart, { capture: true, passive: false });
  el.addEventListener('touchmove', onMove, { capture: true, passive: false });
  el.addEventListener('touchend', onEnd, { capture: true, passive: false });
  el.addEventListener('touchcancel', onEnd, { capture: true, passive: false });
  return () => {
    stopMomentum();
    clearTimeout(longTimer);
    el.removeEventListener('touchstart', onStart, true);
    el.removeEventListener('touchmove', onMove, true);
    el.removeEventListener('touchend', onEnd, true);
    el.removeEventListener('touchcancel', onEnd, true);
  };
}
