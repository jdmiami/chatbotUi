import { describe, expect, it } from 'vitest';
import {
  SPRINGS,
  ShakeDetector,
  SpringValue,
  VelocityTracker,
  landing,
  project,
  rubberBand,
  rubberClamp,
  spring,
  stretchFor,
} from '../../src/shell/orb/physics';
import { besideRect, restSpot } from '../../src/shell/orb/attention';
import { describe as describeScreen, findItem, needsConfirm, parseCommand, parseStep, settingPatch, snapshot, type PageItem } from '../../src/shell/orb/agent';
import { DEFAULT_SETTINGS } from '../../src/state/shell';

describe('orb physics', () => {
  it('springs: response and damping ratio become stiffness and damping', () => {
    const s = spring(0.5, 1);
    expect(s.stiffness).toBeCloseTo((2 * Math.PI / 0.5) ** 2);
    expect(s.damping).toBeCloseTo(2 * (2 * Math.PI / 0.5));
  });

  it('a critically damped spring settles without overshoot; a bouncy one overshoots once and settles', () => {
    const calm = new SpringValue(0, spring(0.4, 1));
    calm.target = 100;
    let max = 0;
    for (let i = 0; i < 120; i++) {
      calm.step(1 / 60);
      max = Math.max(max, calm.value);
    }
    expect(max).toBeLessThanOrEqual(100.01);
    expect(calm.resting()).toBe(true);

    const land = new SpringValue(0, SPRINGS.land);
    land.target = 100;
    let peak = 0;
    for (let i = 0; i < 180; i++) {
      land.step(1 / 60);
      peak = Math.max(peak, land.value);
    }
    expect(peak).toBeGreaterThan(101);
    expect(peak).toBeLessThan(120);
    expect(land.resting()).toBe(true);
  });

  it('is stable at any frame rate (30, 60, 120 Hz give the same path)', () => {
    const at = (hz: number) => {
      const v = new SpringValue(0, SPRINGS.follow);
      v.target = 200;
      for (let i = 0; i < Math.round(0.4 * hz); i++) v.step(1 / hz);
      return v.value;
    };
    expect(Math.abs(at(30) - at(120))).toBeLessThan(2);
    expect(Math.abs(at(60) - at(120))).toBeLessThan(1);
  });

  it('momentum projection matches UIScrollView (1000 px/s → ~499 px)', () => {
    expect(project(1000)).toBeCloseTo(499, 0);
    expect(project(-2000)).toBeCloseTo(-998, 0);
    expect(project(0)).toBe(0);
  });

  it('rubber band: resists more the further you pull and never passes the dimension', () => {
    expect(rubberBand(0, 400)).toBe(0);
    const a = rubberBand(50, 400);
    const b = rubberBand(200, 400);
    expect(a).toBeLessThan(50);
    expect(b - a).toBeLessThan(150);
    expect(rubberBand(1e6, 400)).toBeLessThan(400);
    expect(rubberClamp(50, 0, 100, 400)).toBe(50);
    expect(rubberClamp(150, 0, 100, 400)).toBeGreaterThan(100);
    expect(rubberClamp(150, 0, 100, 400)).toBeLessThan(150);
  });

  it('finger velocity is the slope of the last 100 ms', () => {
    const v = new VelocityTracker();
    for (let i = 0; i <= 10; i++) v.add(i * 10, i * 10, 500 - i * 5); // 1000 px/s right, 500 up
    const { x, y } = v.velocity();
    expect(x).toBeCloseTo(1000, -1);
    expect(y).toBeCloseTo(-500, -1);
  });

  it('squash and stretch grows with speed, is capped, and points along the motion', () => {
    expect(stretchFor(0, 0).stretch).toBe(1);
    expect(stretchFor(2600, 0).stretch).toBeCloseTo(1.5 - 0, 0);
    expect(stretchFor(1e6, 0).stretch).toBeCloseTo(1.22);
    expect(stretchFor(0, 1000).angle).toBeCloseTo(Math.PI / 2);
  });

  it('a fling lands on the side it was thrown toward, at the projected height; a hard throw down tucks it', () => {
    const view = { x: 0, y: 0, w: 390, h: 844 };
    const right = landing({ x: 100, y: 400 }, { x: 1800, y: -300 }, view, 56);
    expect(right.x).toBe(390 - 28);
    expect(right.y).toBeLessThan(400);
    expect(right.tuck).toBe(false);
    const left = landing({ x: 300, y: 400 }, { x: -1500, y: 0 }, view, 56);
    expect(left.x).toBe(28);
    expect(landing({ x: 200, y: 700 }, { x: 0, y: 4000 }, view, 56).tuck).toBe(true);
  });

  it('a shake is three quick back-and-forth jolts, once per shake', () => {
    const s = new ShakeDetector();
    expect(s.push(0, 20, 0)).toBe(false);
    expect(s.push(120, -20, 0)).toBe(false);
    expect(s.push(240, 20, 0)).toBe(true);
    expect(s.push(300, -20, 0)).toBe(false);
    const calm = new ShakeDetector();
    expect([0, 100, 200, 300].map((t) => calm.push(t, 5, 0))).toEqual([false, false, false, false]);
  });
});

describe('orb attention', () => {
  const view = { x: 0, y: 0, w: 390, h: 844 };
  const rect = (x: number, y: number, w: number, h: number) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect;

  it('sits beside its target (right, else above, else left), inside the screen', () => {
    expect(besideRect(rect(20, 300, 200, 44), view, 56)).toEqual({ x: 258, y: 328 });
    // No room on the right: goes above the right end.
    expect(besideRect(rect(20, 300, 360, 44), view, 56)).toEqual({ x: 352, y: 262 });
    // Avoids places that would cover a control.
    const spot = besideRect(rect(20, 300, 200, 44), view, 56, (x) => x > 250);
    expect(spot).toEqual({ x: 192, y: 262 });
  });

  it('rests low on the right, above the home handle', () => {
    expect(restSpot(view, 56)).toEqual({ x: 348, y: 720 });
  });
});

describe('orb agent', () => {
  it('understands simple commands without the AI machine', () => {
    expect(parseCommand('Open Terminal')).toEqual([{ do: 'open', app: 'terminal' }]);
    expect(parseCommand('please launch the code editor')).toEqual([{ do: 'open', app: 'editor' }]);
    expect(parseCommand('take me to soReal')).toEqual([{ do: 'open', app: 'soreal' }]);
    expect(parseCommand('go home')).toEqual([{ do: 'home' }]);
    expect(parseCommand('Dark mode')).toEqual([{ do: 'setting', name: 'theme', value: 'dark' }]);
    expect(parseCommand('turn off animations')).toEqual([{ do: 'setting', name: 'motion', value: 'off' }]);
    expect(parseCommand('scroll down')).toEqual([{ do: 'scroll', dir: 'down' }]);
    expect(parseCommand('go to the top')).toEqual([{ do: 'scroll', dir: 'top' }]);
    expect(parseCommand('Turn on the AI machine')).toEqual([{ do: 'machine', which: 'ai', power: 'on' }]);
    expect(parseCommand('switch the linux machine off')).toEqual([{ do: 'machine', which: 'linux', power: 'off' }]);
    expect(parseCommand('Tap Make the movie')).toEqual([{ do: 'click', target: 'Make the movie' }]);
    expect(parseCommand('type "hello world" into Message')).toEqual([{ do: 'type', text: 'hello world', target: 'Message' }]);
    const make = parseCommand('Make a picture of a red fox in snow')!;
    expect(make[0]).toEqual({ do: 'open', app: 'make' });
    expect(make.find((s) => s.do === 'type')).toEqual({ do: 'type', target: 'Describe it', text: 'a red fox in snow' });
    expect(parseCommand('write me a poem about the sea and then summarise my week')).toBeNull();
  });

  it('asks before anything that costs money or can’t be undone', () => {
    expect(needsConfirm({ do: 'machine', which: 'ai', power: 'on' })).toMatch(/bills by the hour/);
    expect(needsConfirm({ do: 'machine', which: 'ai', power: 'off' })).toBeNull();
    expect(needsConfirm({ do: 'click', target: 'x' }, 'Delete movie')).toMatch(/can't be undone/);
    expect(needsConfirm({ do: 'click', target: 'x' }, 'Make video')).toBeNull();
  });

  it('reads model replies (thinking removed, first JSON object)', () => {
    expect(parseStep('<think>hmm {"do":"home"}</think> Sure: {"do":"click","target":"#3"} ok')).toEqual({ do: 'click', target: '#3' });
    expect(parseStep('no json here')).toBeNull();
  });

  it('settings steps become patches', () => {
    expect(settingPatch({ do: 'setting', name: 'motion', value: 'off' }, DEFAULT_SETTINGS)).toEqual({ motion: 'reduce', motionPicked: true });
    expect(settingPatch({ do: 'setting', name: 'text', value: 'up' }, DEFAULT_SETTINGS)).toEqual({ textScale: 1.1 });
  });

  it('finds things on screen by what a person would call them', () => {
    const el = document.createElement('button');
    const items: PageItem[] = [
      { id: 1, role: 'button', label: 'Make video', el },
      { id: 2, role: 'radio' as PageItem['role'], label: 'A video With sound, from words or a photo', el },
      { id: 3, role: 'field', label: 'Describe it', el },
      { id: 4, role: 'tab', label: 'Talk', el },
    ];
    expect(findItem(items, 'make video')?.id).toBe(1);
    expect(findItem(items, 'A video|Video')?.id).toBe(2);
    expect(findItem(items, 'the describe it box')?.id).toBe(3);
    expect(findItem(items, '#4')?.id).toBe(4);
    expect(findItem(items, 'Settings')).toBeNull();
    expect(describeScreen(items.slice(0, 1), 'ai')).toBe('App on screen: ai\n#1 button: Make video');
  });

  it('snapshot lists visible, enabled controls by their accessible names', () => {
    document.body.innerHTML = `
      <button aria-label="Open Terminal">x</button>
      <button disabled>Nope</button>
      <label>Title <input value="Night"></label>
      <div aria-hidden="true"><button>Hidden</button></div>`;
    // jsdom has no layout: give everything a box.
    for (const el of document.querySelectorAll('*')) (el as HTMLElement).getBoundingClientRect = () => ({ top: 10, bottom: 40, left: 10, right: 100, width: 90, height: 30 }) as DOMRect;
    const items = snapshot();
    expect(items.map((i) => [i.role, i.label, i.value])).toEqual([
      ['button', 'Open Terminal', undefined],
      ['field', 'Title', 'Night'],
    ]);
  });

  it('snapshot never reads out passwords or one-time codes', () => {
    document.body.innerHTML = `
      <label>Password <input type="password" value="hunter2"></label>
      <label>Code <input autocomplete="one-time-code" value="123456"></label>
      <div data-private><label>Note <input value="secret note"></label></div>
      <label>Name <input value="Ada"></label>`;
    for (const el of document.querySelectorAll('*')) (el as HTMLElement).getBoundingClientRect = () => ({ top: 10, bottom: 40, left: 10, right: 100, width: 90, height: 30 }) as DOMRect;
    const values = snapshot().map((i) => i.value);
    expect(values).toEqual([undefined, undefined, undefined, 'Ada']);
  });
});
