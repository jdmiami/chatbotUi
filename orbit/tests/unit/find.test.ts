import { describe, expect, it } from 'vitest';
import { findIntent, scoreText, snippetAround, terms } from '../../src/shell/orb/find';

describe('find across my stuff', () => {
  it('understands find and bring requests', () => {
    expect(findIntent('find my chat about Paris flights')).toEqual({ query: 'chat about Paris flights', bring: false });
    expect(findIntent('Where is the budget file?')).toEqual({ query: 'budget file', bring: false });
    expect(findIntent('bring me the packing list')).toEqual({ query: 'packing list', bring: true });
    expect(findIntent('fetch the README')?.bring).toBe(true);
    expect(findIntent('open terminal')).toBeNull();
  });

  it('scores titles above bodies and ignores filler words', () => {
    expect(terms('find my chat about Paris flights')).toEqual(['paris', 'flights']);
    const ts = terms('paris flights');
    expect(scoreText(ts, 'Paris trip', 'flights are cheap')).toBeGreaterThan(scoreText(ts, 'Trip', 'paris flights'));
    expect(scoreText(ts, 'Groceries', 'milk')).toBe(0);
  });

  it('shows the words around the match', () => {
    const s = snippetAround(`${'x '.repeat(80)}the Paris flight leaves at 9${' y'.repeat(80)}`, ['paris']);
    expect(s).toMatch(/^….*Paris flight leaves at 9.*…$/);
  });
});
