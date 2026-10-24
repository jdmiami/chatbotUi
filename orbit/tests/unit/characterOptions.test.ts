import { describe, expect, it } from 'vitest';
import { ageProblem, draftOf, emptyDraft, inputOf, localDesign, missingFor, parseDesign } from '../../src/apps/make/characterOptions';
import { sheetComplete, thumbOf, type Character } from '../../src/services/ai/Characters';

describe('character maker', () => {
  it('says the age rule straight away', () => {
    expect(ageProblem('')).toBeNull();
    expect(ageProblem('25')).toBeNull();
    expect(ageProblem('80')).toBeNull();
    expect(ageProblem('24')).toMatch(/25 or older/);
    expect(ageProblem('17')).toMatch(/25 or older/);
    expect(ageProblem('abc')).toMatch(/number/);
    expect(ageProblem('130')).toMatch(/up to 120/);
  });

  it('says what is missing before the sheet can be made', () => {
    const d = emptyDraft();
    expect(missingFor(d)).toMatch(/name/);
    d.name = 'Mira Vale';
    expect(missingFor(d)).toMatch(/age/);
    d.age = '20';
    expect(missingFor(d)).toMatch(/25 or older/);
    d.age = '34';
    expect(missingFor(d)).toMatch(/how they look/);
    d.hair = 'Short black';
    expect(missingFor(d)).toBeNull();
  });

  it('sends only what was filled in', () => {
    const d = { ...emptyDraft(), name: ' Mira ', age: '34', hair: 'Silver bob', outfits: [' a coat ', '', 'jeans'] };
    expect(inputOf(d)).toMatchObject({ name: 'Mira', age: '34', traits: { style: 'photoreal', gender: 'woman', hair: 'Silver bob', outfits: ['a coat', 'jeans'] } });
  });

  it('designs a whole adult character from one line, with no AI, the same every time for the same line', () => {
    const a = localDesign('a retired lighthouse keeper who restores old clocks, 63');
    expect(a.age).toBe('63');
    expect(a.name).not.toBe('');
    expect(a.outfits[0]).toMatch(/jumper|glasses/);
    expect(localDesign('a retired lighthouse keeper who restores old clocks, 63')).toEqual(a);
    expect(localDesign('a retired lighthouse keeper who restores old clocks, 63', 1)).not.toEqual(a);
    expect(missingFor(a)).toBeNull();
    // Never an age under 25, whatever the line says.
    for (const line of ['a 19 year old knight', 'a cheerful pastry chef', 'an anime pirate captain, he', 'a sunny botanist, she is 31']) {
      expect(Number(localDesign(line).age)).toBeGreaterThanOrEqual(25);
    }
    expect(localDesign('an anime pirate captain, he')).toMatchObject({ style: 'anime', gender: 'man' });
  });

  it("reads a model's design, and refuses an unusable one", () => {
    const ok = parseDesign('Sure: {"name":"Ines Okafor","age":41,"style":"illustration","gender":"woman","hair":"Silver bob","outfit":"a green coat","personality":"Calm."}', 'idea');
    expect(ok).toMatchObject({ name: 'Ines Okafor', age: '41', style: 'illustration', hair: 'Silver bob', outfits: ['a green coat'] });
    expect(parseDesign('{"name":"Kit","age":17}', 'idea')).toBeNull();
    expect(parseDesign('{"name":"Kit","age":"x"}', 'idea')).toBeNull();
    expect(parseDesign('no json', 'idea')).toBeNull();
  });

  it('fills the draft from a saved character, and knows a complete sheet', () => {
    const c = {
      id: 'c1',
      name: 'Mira',
      age: 34,
      traits: { style: 'anime', gender: 'man', build: 'Slim', height: '', skin: '', face: '', eyes: 'Green', hair: 'Short', marks: '', outfits: ['a coat'], personality: 'Kind' },
      sheet: [
        { view: 'front', label: 'Front', core: true, url: 'f.png' },
        { view: 'face', label: 'Face', core: true, url: 'x.png' },
      ],
    } as unknown as Character;
    expect(draftOf(c)).toMatchObject({ name: 'Mira', age: '34', style: 'anime', gender: 'man', eyes: 'Green', outfits: ['a coat'] });
    expect(thumbOf(c)).toBe('x.png');
    expect(sheetComplete(c)).toBe(false);
    expect(sheetComplete({ sheet: ['front', 'three-quarter', 'side', 'back', 'face'].map((view) => ({ view })) } as unknown as Character)).toBe(true);
  });
});
