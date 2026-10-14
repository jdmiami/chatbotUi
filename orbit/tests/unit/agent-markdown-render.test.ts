import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageBody } from '../../src/apps/agent/Transcript';

afterEach(cleanup);

describe('MessageBody', () => {
  it('renders the Markdown subset as elements', () => {
    const { container } = render(
      createElement(MessageBody, { text: '## Plan\n\n- **one**\n- two\n\nSee [docs](https://example.com).', onCopy: () => {} }),
    );
    expect(container.querySelector('.ag-h')?.textContent).toBe('Plan');
    expect(container.querySelectorAll('ul.ag-list li')).toHaveLength(2);
    expect(container.querySelector('strong')?.textContent).toBe('one');
    const link = container.querySelector('a.ag-link') as HTMLAnchorElement;
    expect(link.href).toBe('https://example.com/');
    expect(link.rel).toContain('noopener');
  });

  it('never turns reply text into HTML', () => {
    const { container } = render(
      createElement(MessageBody, { text: '<img src=x onerror="alert(1)"> **<b>bold</b>**', onCopy: () => {} }),
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });
});
