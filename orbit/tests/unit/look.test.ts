import { describe, expect, it } from 'vitest';
import { isExplain, screenText } from '../../src/shell/orb/look';

describe('the orb looking at the screen', () => {
  it('knows an explain request when it hears one', () => {
    for (const g of ['Explain this screen', 'what does this error mean?', "what's on my screen", 'summarize this page', 'What am I looking at']) expect(isExplain(g)).toBe(true);
    for (const g of ['Open Terminal', 'dark mode', 'make a picture of a fox']) expect(isExplain(g)).toBe(false);
  });

  it('reads visible text top to bottom, never passwords, private boxes or its own UI', () => {
    document.body.innerHTML = `
      <h1>Build failed</h1>
      <p>Error: missing module</p>
      <input type="password" value="hunter2">
      <textarea>my note</textarea>
      <div data-private><p>secret stuff</p></div>
      <div class="orb-layer"><p>orb says hi</p></div>`;
    let top = 0;
    for (const el of document.querySelectorAll('*')) {
      const t = (top += 30);
      (el as HTMLElement).getBoundingClientRect = () => ({ top: t, bottom: t + 20, left: 10, right: 200, width: 190, height: 20 }) as DOMRect;
    }
    const text = screenText();
    expect(text).toContain('Build failed');
    expect(text).toContain('Error: missing module');
    expect(text).toContain('[typed] my note');
    expect(text).not.toMatch(/hunter2|secret stuff|orb says hi/);
    expect(text.indexOf('Build failed')).toBeLessThan(text.indexOf('Error'));
  });
});
