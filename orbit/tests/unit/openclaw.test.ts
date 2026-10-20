/**
 * OpenClaw in Orbit's agent screen: the same host API as Antigravity under /claw, plus approval
 * cards that send the owner's answer (allow once / deny) back to the Linux machine.
 */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostRunner } from '../../src/services/runner/host/HostRunner';
import type { HostClient } from '../../src/services/host/connection';
import type { TranscriptItem } from '../../src/services/runner/types';
import { Transcript } from '../../src/apps/agent/Transcript';

afterEach(cleanup);

describe('HostRunner for OpenClaw', () => {
  it('uses the /claw routes and sends approval decisions', async () => {
    const calls: { path: string; init?: RequestInit }[] = [];
    const host = {
      json: vi.fn(async (path: string, init?: RequestInit) => {
        calls.push({ path, init });
        if (path === '/claw/projects') return [{ id: '.', name: 'projects', path: '/p' }];
        return {};
      }),
      stream: vi.fn(),
    } as unknown as HostClient;
    const r = new HostRunner(host, 'claw');
    expect(r.kind).toBe('openclaw');
    expect(await r.listProjects()).toHaveLength(1);
    await r.decide('s1', 'ap-1', 'deny');
    const decide = calls.find((c) => c.path === '/claw/sessions/s1/approvals/ap-1');
    expect(decide?.init?.method).toBe('POST');
    expect(JSON.parse(String(decide?.init?.body))).toEqual({ decision: 'deny' });
    expect(calls.every((c) => c.path.startsWith('/claw/'))).toBe(true);
  });
});

describe('approval cards', () => {
  const card = (status: 'pending' | 'allowed' | 'denied' | 'expired'): TranscriptItem => ({
    kind: 'approval',
    id: `i-${status}`,
    at: 1,
    approvalId: `ap-${status}`,
    command: 'rm -rf build',
    cwd: '/home/desktop/projects',
    status,
  });
  const show = (items: TranscriptItem[], onDecide = vi.fn(async () => {})) => {
    render(
      createElement(Transcript, {
        sessionId: 's1',
        items,
        demo: false,
        hostMode: true,
        visible: true,
        now: 2,
        onCopy: () => {},
        onOpenTerminal: () => {},
        scrollSignal: 0,
        agentName: 'OpenClaw',
        onDecide,
      }),
    );
    return onDecide;
  };

  it('shows the command and where it runs, and only acts when you choose', async () => {
    const onDecide = show([card('pending')]);
    expect(screen.getByText('rm -rf build')).toBeTruthy();
    expect(screen.getByText(/in \/home\/desktop\/projects/)).toBeTruthy();
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith('ap-pending', 'allow-once'));
  });

  it('can be denied, and answered cards have no buttons', async () => {
    const onDecide = show([card('pending')]);
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith('ap-pending', 'deny'));
    cleanup();
    show([card('allowed'), card('denied'), card('expired')]);
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
    expect(screen.getByText('Allowed once')).toBeTruthy();
    expect(screen.getByText('Denied')).toBeTruthy();
    expect(screen.getByText('No longer waiting')).toBeTruthy();
  });

  it('labels replies with the agent that wrote them', () => {
    show([{ kind: 'assistant', id: 'a', at: 1, text: 'All done.' }]);
    expect(screen.getByRole('article', { name: 'OpenClaw reply' })).toBeTruthy();
  });
});
