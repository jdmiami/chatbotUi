/** The text box: a normal <textarea>, except on Chrome for iPhone/iPad, where a plain editable block
 *  keeps Chrome's passwords/cards/addresses bar away. */
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextArea, isPlainTextBox } from '../../src/ui/TextArea';

function Box(props: { onKey?: (k: string) => void }) {
  const [v, setV] = useState('');
  return createElement('div', null,
    createElement(TextArea, { value: v, onChange: (e) => setV(e.target.value), placeholder: 'Describe it', 'aria-label': 'Describe it', onKeyDown: (e) => props.onKey?.(e.key) }),
    createElement('button', { onClick: () => setV('a chip') }, 'chip'),
    createElement('output', null, v));
}

afterEach(() => { cleanup(); delete document.documentElement.dataset.textbox; vi.unstubAllGlobals(); });

describe('TextArea', () => {
  it('is a normal textarea outside Chrome on iOS', () => {
    render(createElement(Box));
    expect(screen.getByLabelText('Describe it').tagName).toBe('TEXTAREA');
  });

  it('detects Chrome on iPhone from its user agent', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1' });
    expect(isPlainTextBox()).toBe(true);
  });

  it('on Chrome for iOS is a plain text box with the same value, change and key behaviour', () => {
    document.documentElement.dataset.textbox = 'plain';
    const keys: string[] = [];
    render(createElement(Box, { onKey: (k) => keys.push(k) }));
    const box = screen.getByRole('textbox', { name: 'Describe it' });
    expect(box.tagName).toBe('DIV');
    expect(box.getAttribute('data-placeholder')).toBe('Describe it');
    box.textContent = 'a lighthouse';
    fireEvent.input(box);
    expect(document.querySelector('output')!.textContent).toBe('a lighthouse');
    expect((box as unknown as HTMLTextAreaElement).value).toBe('a lighthouse');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(keys).toEqual(['Enter']);
    fireEvent.click(screen.getByText('chip'));
    expect(box.textContent).toBe('a chip');
  });
});
