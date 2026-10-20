import { tiltSensor } from './tilt';
import type { Sensor } from './hub';

export * from './hub';
export { tiltSensor };
export type { TiltOptions, TiltValue } from './tilt';

/** Every sensor Orbit can read, in the order the privacy panel lists them. */
export const SENSORS: Sensor<any, any>[] = [tiltSensor];
