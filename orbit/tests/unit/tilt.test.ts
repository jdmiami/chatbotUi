import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestTiltPermission, startTilt, tiltNeedsPermission } from '../../src/sensors/tilt';

/**
 * Tilt as it behaved before the sensor hub: the exact --tx/--ty it writes frame by frame for the same
 * phone movements and mouse moves, and how it asks for permission on iPhone. The numbers were
 * recorded from src/motion/tilt.ts before it moved into src/sensors, so any change in feel shows here.
 */

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
const root = document.documentElement;
const tx = () => root.style.getPropertyValue('--tx');
const ty = () => root.style.getPropertyValue('--ty');

/** Runs animation frames until tilt stops asking for them (or `max`), and returns what it wrote. */
function runFrames(max = 400) {
  const out: string[] = [];
  for (let i = 0; i < max && frames.size; i++) {
    const due = [...frames.values()];
    frames.clear();
    for (const cb of due) cb(i * 16);
    out.push(`${tx()} ${ty()}`);
  }
  return out;
}

const orient = (beta: number | null, gamma: number | null) =>
  dispatchEvent(Object.assign(new Event('deviceorientation'), { beta, gamma, alpha: 0 }));

const mouse = (clientX: number, clientY: number, pointerType = 'mouse') =>
  dispatchEvent(Object.assign(new Event('pointermove'), { clientX, clientY, pointerType }));

/** Pretends this is an iPhone: DeviceOrientationEvent.requestPermission exists. */
function iPhone(answer: 'granted' | 'denied' | Error) {
  const requestPermission = vi.fn(() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)));
  vi.stubGlobal('DeviceOrientationEvent', Object.assign(function DeviceOrientationEvent() {}, { requestPermission }));
  return requestPermission;
}

function pointer(fine: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: fine && q === '(pointer: fine)', media: q }) as MediaQueryList);
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++nextFrame, cb);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('innerWidth', 400);
  vi.stubGlobal('innerHeight', 800);
  pointer(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  root.removeAttribute('style');
});

describe('tilt (unchanged by the sensor hub)', () => {
  it('takes the angle the phone is held at as level and eases toward the tilt, frame by frame', () => {
    const stop = startTilt();
    orient(40, 0);
    // Held still at the starting angle: nothing moves.
    expect(runFrames()).toEqual(['0.000 0.000']);

    orient(40, 15);
    const right = runFrames();
    expect(right.slice(0, 6)).toMatchInlineSnapshot(`
      [
        "0.099 0.000",
        "0.186 0.000",
        "0.263 0.000",
        "0.330 0.000",
        "0.390 0.000",
        "0.442 0.000",
      ]
    `);
    expect(right.length).toMatchInlineSnapshot(`48`);
    expect(right.at(-1)).toMatchInlineSnapshot(`"0.823 0.000"`);

    orient(55, -30);
    const tipped = runFrames();
    expect(tipped.slice(0, 4)).toMatchInlineSnapshot(`
      [
        "0.604 0.099",
        "0.412 0.186",
        "0.242 0.263",
        "0.093 0.330",
      ]
    `);
    expect(tipped.at(-1)).toMatchInlineSnapshot(`"-0.999 0.824"`);
    stop();
  });

  it('slowly follows a new grip', () => {
    const stop = startTilt();
    orient(40, 0);
    for (let i = 0; i < 200; i++) orient(60, 10);
    runFrames();
    expect([tx(), ty()]).toMatchInlineSnapshot(`
      [
        "0.074",
        "0.148",
      ]
    `);
    stop();
  });

  it('ignores readings without angles', () => {
    const stop = startTilt();
    orient(null, null);
    expect(frames.size).toBe(0);
    expect(tx()).toBe('');
    stop();
  });

  it('follows the mouse on a computer and recentres when it leaves the window', () => {
    pointer(true);
    const stop = startTilt();
    mouse(300, 200);
    const moved = runFrames();
    expect(moved.slice(0, 3)).toMatchInlineSnapshot(`
      [
        "0.060 -0.060",
        "0.113 -0.113",
        "0.159 -0.159",
      ]
    `);
    expect(moved.at(-1)).toMatchInlineSnapshot(`"0.499 -0.499"`);

    // A finger is not a mouse.
    mouse(0, 0, 'touch');
    expect(frames.size).toBe(0);

    document.dispatchEvent(new Event('pointerleave'));
    expect(runFrames().at(-1)).toMatchInlineSnapshot(`"0.001 -0.001"`);
    stop();
  });

  it('does not follow the mouse on a touch screen', () => {
    const stop = startTilt();
    mouse(300, 200);
    expect(frames.size).toBe(0);
    stop();
  });

  it('stopping clears the tilt, cancels the frame and stops listening', () => {
    pointer(true);
    const stop = startTilt();
    orient(40, 0);
    orient(40, 15);
    runFrames(3);
    expect(tx()).not.toBe('');
    stop();
    expect(tx()).toBe('');
    expect(ty()).toBe('');
    expect(frames.size).toBe(0);
    orient(40, 30);
    mouse(10, 10);
    expect(frames.size).toBe(0);
    expect(tx()).toBe('');
  });

  it('asks for permission only where the phone needs it', async () => {
    expect(tiltNeedsPermission()).toBe(false);
    expect(await requestTiltPermission()).toBe(true);

    const ask = iPhone('granted');
    expect(tiltNeedsPermission()).toBe(true);
    expect(await requestTiltPermission()).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);

    iPhone('denied');
    expect(await requestTiltPermission()).toBe(false);
    iPhone(new Error('not from a tap'));
    expect(await requestTiltPermission()).toBe(false);
  });

  it('asks again on the first tap of a visit when it was allowed before', () => {
    const ask = iPhone('granted');
    const stop = startTilt({ askOnTap: true });
    expect(ask).not.toHaveBeenCalled();
    dispatchEvent(new Event('pointerup'));
    dispatchEvent(new Event('pointerup'));
    expect(ask).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not ask on tap unless told to, and never where no permission is needed', () => {
    const ask = iPhone('granted');
    const stop = startTilt();
    dispatchEvent(new Event('pointerup'));
    expect(ask).not.toHaveBeenCalled();
    stop();

    vi.unstubAllGlobals();
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const stop2 = startTilt({ askOnTap: true });
    dispatchEvent(new Event('pointerup'));
    expect(ask).not.toHaveBeenCalled();
    stop2();
  });

  it('a stop before the first tap removes the ask', () => {
    const ask = iPhone('granted');
    startTilt({ askOnTap: true })();
    dispatchEvent(new Event('pointerup'));
    expect(ask).not.toHaveBeenCalled();
  });
});
