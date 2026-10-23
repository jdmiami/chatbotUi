/**
 * The "turn your machine on" message can be put away and brought back, and remembers which.
 */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MachineNotice } from '../../src/ui/MachineNotice';

const notice = (id = 'make') => createElement(MachineNotice, { id, label: 'AI machine off' }, createElement('p', null, 'Turn the AI machine on.'));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('MachineNotice', () => {
  it('hides into a pill and shows again', () => {
    render(notice());
    expect(screen.getByText('Turn the AI machine on.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide this message' }));
    expect(screen.queryByText('Turn the AI machine on.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /AI machine off/ }));
    expect(screen.getByText('Turn the AI machine on.')).toBeTruthy();
  });

  it('remembers a hidden message next time, per message', () => {
    const first = render(notice());
    fireEvent.click(screen.getByRole('button', { name: 'Hide this message' }));
    first.unmount();
    render(notice());
    expect(screen.queryByText('Turn the AI machine on.')).toBeNull();
    cleanup();
    render(notice('store'));
    expect(screen.getByText('Turn the AI machine on.')).toBeTruthy();
  });
});
