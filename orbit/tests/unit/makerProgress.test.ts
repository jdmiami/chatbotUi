import { describe, expect, it } from 'vitest';
import { progressText, progressWhy } from '../../src/apps/ai/makerCatalog';
import type { StudioMakerInfo } from '../../src/services/ai/LocalAi';

const m = (over: Partial<StudioMakerInfo>): StudioMakerInfo =>
  ({ id: 'h3-max', kind: 'video', name: 'H3 Max', builtIn: false, wanted: true, installed: false, percent: 40, ...over }) as StudioMakerInfo;

describe('maker download progress', () => {
  it('says why a number is not moving', () => {
    expect(progressText(m({ status: 'downloading' }))).toBe('40%');
    expect(progressText(m({ status: 'waiting' }))).toBe('40% · in line');
    expect(progressText(m({ status: 'saving', percent: 100 }))).toBe('100% · saving');
    expect(progressText(m({ status: 'disk' }))).toBe('Disk full');
    expect(progressText(m({ status: 'blocked' }))).toBe("Can't download");
    // The machine is off: nothing moves and the last number may be old, so no number.
    expect(progressText(m({ status: 'downloading' }), false)).toBe('Waits for the machine');
    expect(progressWhy(m({}), false)).toBe('H3 Max carries on downloading when your AI machine is on.');
    expect(progressWhy(m({ status: 'waiting', waitingFor: 'a.safetensors' }))).toBe('H3 Max is 40% done, waiting for a.safetensors to finish first (one at a time).');
  });
});
