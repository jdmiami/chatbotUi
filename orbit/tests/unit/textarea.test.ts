/** The text boxes: a normal <textarea> / <input>, except on iPhones and iPads, where a plain editable
 *  block keeps the browser's form bar (passwords, ∧ ∨ Done) away from the keyboard. */
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextArea, TextField, isPlainTextBox } from '../../src/ui/TextArea';

function Box(props: { onKey?: (k: string) => void }) {
  const [v, setV] = useState('');
  return createElement('div', null,
    createElement(TextArea, { value: v, onChange: (e) => setV(e.target.value), placeholder: 'Describe it', 'aria-label': 'Describe it', onKeyDown: (e) => props.onKey?.(e.key) }),
    createElement('button', { onClick: () => setV('a chip') }, 'chip'),
    createElement('output', null, v));
}

function Field() {
  const [v, setV] = useState('');
  return createElement('div', null,
    createElement(TextField, { value: v, onChange: (e) => setV(e.target.value), placeholder: 'Who to replace', 'aria-label': 'Who to replace', maxLength: 20 }),
    createElement('output', null, v));
}

afterEach(() => { cleanup(); delete document.documentElement.dataset.textbox; vi.unstubAllGlobals(); });

describe('TextArea', () => {
  it('is a normal textarea on a computer', () => {
    render(createElement(Box));
    expect(screen.getByLabelText('Describe it').tagName).toBe('TEXTAREA');
  });

  it('is the plain box on an iPhone or iPad: Safari, Chrome, and an iPad posing as a Mac', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 });
    expect(isPlainTextBox()).toBe(true);
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 });
    expect(isPlainTextBox()).toBe(true);
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 });
    expect(isPlainTextBox()).toBe(true);
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 });
    expect(isPlainTextBox()).toBe(false);
  });

  it('the plain box has the same value, change and key behaviour as a textarea', () => {
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

  it('text that arrived without an input event (an autocorrection on leaving) is still reported when focus leaves', () => {
    document.documentElement.dataset.textbox = 'plain';
    render(createElement(Box));
    const box = screen.getByRole('textbox', { name: 'Describe it' });
    box.focus();
    box.textContent = 'a lighthouse at dawn';
    expect(document.querySelector('output')!.textContent).toBe('');
    fireEvent.blur(box);
    expect(document.querySelector('output')!.textContent).toBe('a lighthouse at dawn');
  });
});

describe('TextField', () => {
  it('is a normal text input on a computer', () => {
    render(createElement(Field));
    const el = screen.getByLabelText('Who to replace') as HTMLInputElement;
    expect(el.tagName).toBe('INPUT');
    expect(el.type).toBe('text');
  });

  it('on an iPhone is a one-line plain box: Enter means done, a pasted line break becomes a space, the length limit holds', () => {
    document.documentElement.dataset.textbox = 'plain';
    render(createElement(Field));
    const box = screen.getByRole('textbox', { name: 'Who to replace' });
    expect(box.tagName).toBe('DIV');
    expect(box.getAttribute('aria-multiline')).toBeNull();
    expect(box.className).toContain('ta-line');
    expect(box.getAttribute('enterkeyhint')).toBe('done');
    box.focus();
    box.textContent = 'the man\nin red';
    fireEvent.input(box);
    expect(document.querySelector('output')!.textContent).toBe('the man in red');
    box.textContent = 'a very long description that goes on';
    fireEvent.input(box);
    expect(document.querySelector('output')!.textContent).toBe('a very long descript');
    const enter = fireEvent.keyDown(box, { key: 'Enter' });
    expect(enter).toBe(false);
    expect(document.activeElement).not.toBe(box);
  });
});
