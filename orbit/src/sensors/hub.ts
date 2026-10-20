import { create } from 'zustand';

/**
 * The sensor hub (docs/orbit-system/HANDOFF.md §3.1): one store of the latest reading from every
 * sensor, the phone's and later the machines', so a screen doesn't care where a reading came from.
 * Each sensor is its own small module (a Sensor below); the hub starts and stops it and keeps what
 * it reports.
 */

/** Where a reading comes from: this phone, iPad or computer, or one of the machines. */
export type SensorSource = 'device' | 'ai' | 'linux';

export interface Reading<V = unknown> {
  id: string;
  source: SensorSource;
  /** Null until the sensor has reported since it was started. */
  value: V | null;
  unit: string;
  /** When it was read (ms since 1970); 0 before the first reading. */
  at: number;
  /** Whether the sensor is running now. A stopped sensor keeps its last value. */
  on: boolean;
}

export interface Sensor<V = unknown, O = void> {
  id: string;
  /** Plain words for the privacy panel. */
  label: string;
  source: SensorSource;
  unit: string;
  /** Whether this browser has the sensor at all. */
  available(): boolean;
  /** Whether it has to ask before it may be read (iPhone and iPad). */
  needsPermission(): boolean;
  /** Asks, and must run from a tap. Resolves true when the sensor may be read. */
  permission(): Promise<boolean>;
  /** Starts reading; `publish` hands each reading to the hub. */
  start(publish: (value: V) => void, options?: O): void;
  stop(): void;
}

interface HubState {
  readings: Record<string, Reading>;
}

export const useSensorHub = create<HubState>()(() => ({ readings: {} }));

/** Which start of each sensor is current, so a late stop from an older start does nothing. */
const running = new Map<string, symbol>();

function patch(sensor: Sensor<any, any>, change: Partial<Reading>) {
  useSensorHub.setState((s) => {
    const prev: Reading = s.readings[sensor.id] ?? { id: sensor.id, source: sensor.source, value: null, unit: sensor.unit, at: 0, on: false };
    return { readings: { ...s.readings, [sensor.id]: { ...prev, ...change } } };
  });
}

/** Starts a sensor (restarting it if it was running). Returns a function that stops it. */
export function startSensor<V, O>(sensor: Sensor<V, O>, options?: O): () => void {
  if (running.has(sensor.id)) stopSensor(sensor);
  if (!sensor.available()) return () => {};
  const run = Symbol(sensor.id);
  running.set(sensor.id, run);
  patch(sensor, { on: true, value: null, at: 0 });
  sensor.start((value) => {
    if (running.get(sensor.id) === run) patch(sensor, { value, at: Date.now() });
  }, options);
  return () => {
    if (running.get(sensor.id) === run) stopSensor(sensor);
  };
}

export function stopSensor(sensor: Sensor<any, any>) {
  if (!running.delete(sensor.id)) return;
  sensor.stop();
  patch(sensor, { on: false });
}

export function reading<V>(id: string): Reading<V> | undefined {
  return useSensorHub.getState().readings[id] as Reading<V> | undefined;
}

/** The latest reading of one sensor, for a screen that reacts to it. */
export function useReading<V>(id: string): Reading<V> | undefined {
  return useSensorHub((s) => s.readings[id]) as Reading<V> | undefined;
}
