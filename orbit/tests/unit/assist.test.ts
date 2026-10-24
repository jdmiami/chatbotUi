import { beforeEach, describe, expect, it, vi } from 'vitest';

const cloud = vi.hoisted(() => ({ ready: true, text: vi.fn<(req: { messages: { content: string }[]; temperature?: number }) => Promise<string>>() }));
vi.mock('../../src/services/ai/CloudAi', () => ({
  cloudReady: async () => cloud.ready,
  cloudText: (req: { messages: { content: string }[] }) => cloud.text(req),
  NOT_POSSIBLE: '[not possible]',
}));

import {
  assistIntent,
  currentAssist,
  fallbackIdea,
  fallbackPick,
  forgetIdeas,
  ideaFor,
  ideaKind,
  onAssistChange,
  orbApprove,
  pickFor,
  setApprover,
  setAssist,
  type AssistOption,
} from '../../src/shell/orb/assist';
import { aroundBox, edgeRail, keepOnScreen, nearestT, pingPong } from '../../src/shell/orb/rail';

const PICTURE = 'Step 3 of 5, Describe it: a picture with the Photo maker, style Dark brush';

beforeEach(() => {
  forgetIdeas();
  cloud.ready = true;
  cloud.text.mockReset();
});

describe('ideas for a text step', () => {
  it('knows what kind of words a box wants from its context', () => {
    expect(ideaKind(PICTURE)).toBe('picture');
    expect(ideaKind('Describe it: a portrait picture')).toBe('portrait');
    expect(ideaKind('Step 2: describe the video')).toBe('video');
    expect(ideaKind('Write the lyrics of your song')).toBe('music');
    expect(ideaKind('Your note to the team')).toBe('words');
  });

  it('written ideas (no AI) are never empty and change with n', () => {
    const ideas = [0, 1, 2, 3].map((n) => fallbackIdea(PICTURE, '', n));
    expect(new Set(ideas).size).toBe(4);
    for (const i of ideas) expect(i.length).toBeGreaterThan(20);
    // What is already written is kept and built on.
    const more = fallbackIdea(PICTURE, 'a red bicycle', 0);
    expect(more.startsWith('a red bicycle, ')).toBe(true);
    expect(fallbackIdea(PICTURE, 'a red bicycle', 1)).not.toBe(more);
  });

  it('without cloud AI it gives a written idea, different each time, and never asks the cloud', async () => {
    cloud.ready = false;
    const a = await ideaFor(PICTURE, '', 0);
    const b = await ideaFor(PICTURE, '', 1);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect(cloud.text).not.toHaveBeenCalled();
  });

  it('asks the cloud with the step, what is written and the earlier ideas; tidies the reply', async () => {
    cloud.text.mockResolvedValueOnce('Idea 1: "A lighthouse in a storm, one warm window"').mockResolvedValueOnce('A fox asleep in snow at dawn');
    expect(await ideaFor(PICTURE, '', 0)).toBe('A lighthouse in a storm, one warm window');
    expect(await ideaFor(PICTURE, '', 1)).toBe('A fox asleep in snow at dawn');
    const [first, second] = cloud.text.mock.calls.map((c) => c[0]);
    expect(first.messages[0].content).toMatch(/vivid picture prompt/);
    expect(first.messages[1].content).toContain(PICTURE);
    expect(first.messages[1].content).toContain('Idea number 1');
    expect(second.messages[1].content).toContain('Idea number 2');
    expect(second.messages[1].content).toContain('A lighthouse in a storm');
    // The same n again: the same idea, without asking again.
    expect(await ideaFor(PICTURE, '', 0)).toBe('A lighthouse in a storm, one warm window');
    expect(cloud.text).toHaveBeenCalledTimes(2);
  });

  it('builds on what is already written', async () => {
    cloud.text.mockResolvedValueOnce('a red bicycle leaning on a blue door, morning sun');
    expect(await ideaFor(PICTURE, 'a red bicycle', 0)).toBe('a red bicycle leaning on a blue door, morning sun');
    expect(cloud.text.mock.calls[0][0].messages[1].content).toContain('Already written: a red bicycle');
  });

  it('when the cloud fails, repeats itself or says nothing, a written idea stands in (no error)', async () => {
    cloud.text.mockRejectedValueOnce(new Error('Cloud AI answered 500.'));
    const a = await ideaFor(PICTURE, '', 0);
    expect(a).toBe(fallbackIdea(PICTURE, '', 0));
    cloud.text.mockResolvedValueOnce('');
    expect(await ideaFor(PICTURE, '', 1)).toBeTruthy();
    cloud.text.mockResolvedValueOnce(a);
    const c = await ideaFor(PICTURE, '', 2);
    expect(c).toBeTruthy();
    expect(c).not.toBe(a);
  });
});

describe('picks for a choice step', () => {
  const options: AssistOption[] = [
    { id: 'quick', label: 'Fast drafts' },
    { id: 'real', label: 'Real photo' },
    { id: 'ink', label: 'Dark brush' },
  ];

  it('takes the number the cloud answers, or the label it names', async () => {
    cloud.text.mockResolvedValueOnce('2');
    expect(await pickFor('Step 2 of 5, Maker', options)).toBe('real');
    cloud.text.mockResolvedValueOnce('I would go with Dark brush.');
    expect(await pickFor('Step 2 of 5, Maker', options)).toBe('ink');
    const asked = cloud.text.mock.calls[0][0].messages[1].content;
    expect(asked).toContain('1. Fast drafts');
    expect(asked).toContain('3. Dark brush');
  });

  it('without the cloud (or when it fails) it still picks one of the options', async () => {
    cloud.ready = false;
    expect(options.map((o) => o.id)).toContain(await pickFor('Pick a maker', options));
    cloud.ready = true;
    cloud.text.mockRejectedValueOnce(new Error('offline'));
    expect(options.map((o) => o.id)).toContain(await pickFor('Pick a maker', options));
    cloud.text.mockResolvedValueOnce('none of them');
    expect(options.map((o) => o.id)).toContain(await pickFor('Pick a maker', options));
  });

  it('nothing to pick from: null; one option: that one, without asking', async () => {
    expect(await pickFor('x', [])).toBeNull();
    expect(await pickFor('x', [options[0]])).toBe('quick');
    expect(cloud.text).not.toHaveBeenCalled();
  });

  it('a written pick prefers what matches the context, then a recommended one', () => {
    expect(fallbackPick('a dark painting with brush strokes', options, () => 0.99)).toBe('ink');
    const withRec = [...options, { id: 'auto', label: 'Recommended' }];
    expect(fallbackPick('Step 2 of 5', withRec, () => 0.5)).toBe('auto');
    expect(fallbackPick('Step 2 of 5', options, () => 0)).toBe('quick');
  });
});

describe('what the orb hears on a step', () => {
  it('knows "choose for me" and "another idea"', () => {
    expect(assistIntent('Choose for me')).toBe('choose');
    expect(assistIntent('you pick')).toBe('choose');
    expect(assistIntent('write it for me')).toBe('choose');
    expect(assistIntent('surprise me')).toBe('choose');
    expect(assistIntent('another idea please')).toBe('another');
    expect(assistIntent('something else')).toBe('another');
    expect(assistIntent('open terminal')).toBeNull();
    expect(assistIntent('dark mode')).toBeNull();
  });
});

describe('the step under the orb', () => {
  it('the newest registration is the focus; updates keep their place; the listeners hear changes', () => {
    const heard = vi.fn();
    const off = onAssistChange(heard);
    const a = {}, b = {};
    setAssist(a, { id: 'make:what', context: 'Step 1', target: null, kind: 'choice' });
    setAssist(b, { id: 'make:describe', context: 'Step 3', target: null, kind: 'text', value: '' });
    expect(currentAssist()?.id).toBe('make:describe');
    setAssist(a, { id: 'make:what', context: 'Step 1 again', target: null, kind: 'choice' });
    expect(currentAssist()?.id).toBe('make:describe');
    const n = heard.mock.calls.length;
    // The same thing again (a re-render): nobody is bothered.
    setAssist(b, { id: 'make:describe', context: 'Step 3', target: null, kind: 'text', value: '' });
    expect(heard.mock.calls.length).toBe(n);
    setAssist(b, { id: 'make:describe', context: 'Step 3', target: null, kind: 'text', value: 'a fox' });
    expect(heard.mock.calls.length).toBe(n + 1);
    setAssist(b, null);
    expect(currentAssist()?.id).toBe('make:what');
    setAssist(a, null);
    expect(currentAssist()).toBeNull();
    off();
  });

  it('approve: straight away with no orb; one show for one pick, even when asked twice', async () => {
    const el = document.createElement('button');
    document.body.append(el);
    await expect(orbApprove(el)).resolves.toBeUndefined();
    await expect(orbApprove(null)).resolves.toBeUndefined();
    let shows = 0;
    setApprover(async () => {
      shows++;
      await new Promise((r) => setTimeout(r, 20));
    });
    await Promise.all([orbApprove(el), orbApprove(el)]);
    expect(shows).toBe(1);
    setApprover(null);
    el.remove();
  });
});

describe('the paths round a text box', () => {
  const box = { left: 100, top: 100, right: 300, bottom: 160 };

  it('goes round the outside of the box, clockwise from the top left', () => {
    const pad = 10;
    const start = aroundBox(box, pad, 0, 0);
    expect(start.y).toBeCloseTo(90);
    const quarter = aroundBox(box, pad, 0, 0.4); // down the right side by now
    expect(quarter.x).toBeCloseTo(310);
    for (let t = 0; t < 1; t += 0.01) {
      const p = aroundBox(box, pad, 6, t);
      const inside = p.x > box.left && p.x < box.right && p.y > box.top && p.y < box.bottom;
      expect(inside).toBe(false);
    }
    // It wraps.
    expect(aroundBox(box, pad, 6, 1.25)).toEqual(aroundBox(box, pad, 6, 0.25));
    // Joining the path from where the orb is: the nearest point.
    const t = nearestT(box, pad, 6, { x: 310, y: 130 });
    const p = aroundBox(box, pad, 6, t);
    expect(Math.abs(p.x - 310)).toBeLessThan(15);
  });

  it('rides above a one-line box, or below when there is no room above', () => {
    expect(edgeRail(box, { y: 0, h: 800 }, 18).side).toBe('top');
    expect(edgeRail({ ...box, top: 10, bottom: 60 }, { y: 0, h: 800 }, 18).side).toBe('bottom');
  });

  it('slides back and forth softly, and stays on screen', () => {
    expect(pingPong(0, 2)).toBeCloseTo(0);
    expect(pingPong(1, 2)).toBeCloseTo(1);
    expect(pingPong(2, 2)).toBeCloseTo(0);
    expect(keepOnScreen({ x: -20, y: 900 }, { x: 0, y: 0, w: 400, h: 800 }, 18)).toEqual({ x: 20, y: 780 });
  });
});
