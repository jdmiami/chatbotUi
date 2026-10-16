import { describe, expect, it } from 'vitest';
import { LineAccumulator, momentumStep } from '../../src/apps/terminal/touchGestures';

describe('LineAccumulator', () => {
  it('turns finger movement into whole lines, keeping the remainder', () => {
    const acc = new LineAccumulator(() => 20);
    expect(acc.push(15)).toBe(0); // not a full line yet
    expect(acc.push(10)).toBe(-1); // 25px down: one line back
    expect(acc.push(35)).toBe(-2); // 5 + 35 = 40px: two more
    expect(acc.push(-60)).toBe(3); // finger up: forward
  });
  it('never divides by a tiny row height', () => {
    const acc = new LineAccumulator(() => 0);
    expect(acc.push(8)).toBe(-2);
  });
});

describe('momentumStep', () => {
  it('moves by velocity × time and slows down', () => {
    const s = momentumStep(1, 16);
    expect(s.dy).toBe(16);
    expect(s.velocity).toBeCloseTo(0.95);
    let v = 2;
    for (let i = 0; i < 200; i++) v = momentumStep(v, 16).velocity;
    expect(Math.abs(v)).toBeLessThan(0.01);
  });
});
