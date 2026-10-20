/**
 * The "AI machine turns off in 10 minutes" banner: shows inside the last 10 minutes, keeps the
 * machine on with one tap, and stays away otherwise.
 */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiOffWarning } from '../../src/shell/AiOffWarning';

function serve(offInMinutes: number | null, state = 'on') {
  const calls: { url: string; body?: unknown }[] = [];
  let offAt = offInMinutes === null ? null : new Date(Date.now() + offInMinutes * 60_000).toISOString();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (body?.action === 'extend') offAt = new Date(Date.now() + 40 * 60_000).toISOString();
      return new Response(JSON.stringify({ machines: [{ id: 'ai', state, offAt }] }), { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AI machine turn-off warning', () => {
  it('shows in the last 10 minutes and keeps the machine on', async () => {
    const calls = serve(8);
    render(createElement(AiOffWarning));
    await screen.findByTestId('ai-offwarn');
    expect(screen.getByText(/turns off in 8 min/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep on 30 more min' }));
    await waitFor(() => expect(calls.some((c) => (c.body as { action?: string })?.action === 'extend')).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('ai-offwarn')).toBeNull());
  });

  it('stays hidden with more time left, or when the machine is off', async () => {
    serve(15);
    render(createElement(AiOffWarning));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('ai-offwarn')).toBeNull();
    cleanup();
    serve(5, 'off');
    render(createElement(AiOffWarning));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('ai-offwarn')).toBeNull();
  });

  it('"Let it rest" hides it', async () => {
    serve(3);
    render(createElement(AiOffWarning));
    fireEvent.click(await screen.findByRole('button', { name: 'Let it rest' }));
    expect(screen.queryByTestId('ai-offwarn')).toBeNull();
  });
});
