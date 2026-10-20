import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reading, SENSORS, startSensor, stopSensor, tiltSensor, useSensorHub, type Sensor, type TiltValue } from '../../src/sensors';
import { startTilt } from '../../src/sensors/tilt';

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let now: number;
const root = document.documentElement;

function runFrames(max = 400) {
  const out: string[] = [];
  for (let i = 0; i < max && frames.size; i++) {
    const due = [...frames.values()];
    frames.clear();
    now += 16;
    for (const cb of due) cb(now);
    out.push(`${root.style.getPropertyValue('--tx')} ${root.style.getPropertyValue('--ty')}`);
  }
  return out;
}

const orient = (beta: number, gamma: number) => dispatchEvent(Object.assign(new Event('deviceorientation'), { beta, gamma, alpha: 0 }));

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  now = 1000;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++nextFrame, cb);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  for (const s of SENSORS) stopSensor(s);
  useSensorHub.setState({ readings: {} });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  root.removeAttribute('style');
});

describe('sensor hub', () => {
  it('lists tilt as a phone sensor', () => {
    expect(SENSORS.map((s) => s.id)).toEqual(['tilt']);
    expect(tiltSensor).toMatchObject({ source: 'device', label: 'Tilt' });
    expect(tiltSensor.available()).toBe(true);
  });

  it('tilt started through the hub writes exactly what it wrote on its own', () => {
    const alone = startTilt();
    orient(40, 0);
    orient(40, 15);
    const before = runFrames();
    alone();

    const viaHub = startSensor(tiltSensor);
    orient(40, 0);
    orient(40, 15);
    expect(runFrames()).toEqual(before);
    viaHub();
    expect(root.style.getPropertyValue('--tx')).toBe('');
  });

  it('keeps the latest tilt reading, about ten a second while it moves and once when it settles', () => {
    const seen: TiltValue[] = [];
    useSensorHub.subscribe((s) => {
      const v = s.readings.tilt?.value as TiltValue | null;
      if (v) seen.push(v);
    });
    const stop = startSensor(tiltSensor);
    expect(reading('tilt')).toMatchObject({ id: 'tilt', source: 'device', on: true, value: null, at: 0 });

    orient(40, 0);
    orient(40, 15);
    const written = runFrames();
    // 48 frames × 16 ms ≈ 0.8 s of easing.
    expect(written.length).toBe(48);
    expect(seen.length).toBeGreaterThanOrEqual(8);
    expect(seen.length).toBeLessThanOrEqual(10);
    const last = reading<TiltValue>('tilt')!;
    expect(last.value).toEqual({ x: 0.823, y: 0 });
    expect(`${last.value!.x.toFixed(3)} ${last.value!.y.toFixed(3)}`).toBe(written.at(-1));
    expect(last.at).toBeGreaterThan(0);

    stop();
    expect(reading('tilt')).toMatchObject({ on: false, value: { x: 0.823, y: 0 } });
  });

  it('a stop from an older start does not stop the newer one', () => {
    const first = startSensor(tiltSensor);
    const second = startSensor(tiltSensor);
    first();
    expect(reading('tilt')?.on).toBe(true);
    orient(40, 0);
    orient(40, 15);
    expect(runFrames().length).toBeGreaterThan(0);
    second();
    expect(reading('tilt')?.on).toBe(false);
  });

  it('does not start a sensor the browser lacks', () => {
    const start = vi.fn();
    const missing: Sensor<number> = {
      id: 'missing',
      label: 'Missing',
      source: 'device',
      unit: 'lx',
      available: () => false,
      needsPermission: () => false,
      permission: async () => false,
      start,
      stop: vi.fn(),
    };
    startSensor(missing)();
    expect(start).not.toHaveBeenCalled();
    expect(reading('missing')).toBeUndefined();
  });

  it('ignores readings a sensor sends after it was stopped', () => {
    let send: (v: number) => void = () => {};
    const late: Sensor<number> = {
      id: 'late',
      label: 'Late',
      source: 'ai',
      unit: '°C',
      available: () => true,
      needsPermission: () => false,
      permission: async () => true,
      start: (publish) => (send = publish),
      stop: () => {},
    };
    const stop = startSensor(late);
    send(71);
    stop();
    send(99);
    expect(reading('late')).toMatchObject({ source: 'ai', unit: '°C', value: 71, on: false });
  });
});
