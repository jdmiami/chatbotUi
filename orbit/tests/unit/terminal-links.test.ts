import { describe, expect, it } from 'vitest';
import { lastLink, linkLabel } from '../../src/apps/terminal/links';

describe('lastLink', () => {
  it('finds the newest address', () => {
    expect(lastLink('see https://a.example/one\nthen https://b.example/two?x=1 now')).toBe('https://b.example/two?x=1');
  });
  it('drops trailing punctuation', () => {
    expect(lastLink('Open (https://accounts.example/auth?c=9).')).toBe('https://accounts.example/auth?c=9');
  });
  it('rejoins an address the program broke at the terminal width', () => {
    const cols = 20;
    const text = 'Visit:\nhttps://accounts.exa\nmple/o/oauth?code=12\n3&x=y\nWaiting...';
    expect(lastLink(text, cols)).toBe('https://accounts.example/o/oauth?code=123&x=y');
  });
  it('leaves a line tmux already rejoined alone, so the next line is not glued on', () => {
    const url = 'https://accounts.example/o/oauth2/auth?client_id=abc-123&state=xyz';
    expect(lastLink(`Sign in here:\n${url}\nWaiting for authentication...`, 20)).toBe(url);
  });
  it('does not join ordinary short lines', () => {
    expect(lastLink('https://a.example/x\nnext line', 80)).toBe('https://a.example/x');
  });
  it('ignores non-web schemes and returns null when there is nothing', () => {
    expect(lastLink('javascript:alert(1) file:///etc/passwd')).toBeNull();
    expect(lastLink('no links here')).toBeNull();
  });
});

describe('linkLabel', () => {
  it('shows host and path', () => {
    expect(linkLabel('https://accounts.google.com/o/oauth2/auth?x=1')).toBe('accounts.google.com/o/oauth2/auth?x=1');
    expect(linkLabel('https://example.com/')).toBe('example.com');
  });
});
