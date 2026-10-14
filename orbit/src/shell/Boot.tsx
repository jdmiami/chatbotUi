import { useCallback, useEffect, useRef, useState } from 'react';
import { configureServices } from '../services';
import { checkConnection, setMachinePower, type MachineStatus } from '../services/host/connection';
import { useApplySettings } from '../hooks/useApplySettings';
import { Shell } from './Shell';

type Phase =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'off'; machine: MachineStatus }
  | { kind: 'starting'; machine: MachineStatus; since: number }
  | { kind: 'problem'; message: string; machine?: MachineStatus };

/**
 * Decides, before any app mounts, whether Orbit runs against the real Linux machine or in demo
 * mode, and handles the "machine is off / starting" states with visible controls.
 */
export function Boot() {
  useApplySettings();
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [busy, setBusy] = useState(false);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enterDemo = useCallback((reason: 'machine-off' | 'no-backend' | 'unreachable' | 'chosen') => {
    configureServices('demo', { demoReason: reason });
    setPhase({ kind: 'ready' });
  }, []);

  const check = useCallback(async () => {
    const result = await checkConnection();
    if (result.kind === 'no-backend') return enterDemo('no-backend');
    if (result.kind === 'signed-out') {
      window.location.href = '/login';
      return;
    }
    const { machine, session, reachable } = result;
    if (reachable && session) {
      configureServices('host', { session });
      setPhase({ kind: 'ready' });
      return;
    }
    if (machine.state === 'off') return setPhase({ kind: 'off', machine });
    if (machine.state === 'starting' || machine.state === 'on' || machine.state === 'unknown') {
      setPhase((p) => ({ kind: 'starting', machine, since: p.kind === 'starting' ? p.since : Date.now() }));
      poll.current = setTimeout(() => void check(), 5000);
      return;
    }
    setPhase({
      kind: 'problem',
      machine,
      message:
        machine.state === 'unconfigured'
          ? 'No Linux machine is set up for this site yet.'
          : (machine.detail ?? 'The Linux machine reported a problem.'),
    });
  }, [enterDemo]);

  useEffect(() => {
    void check().catch((err: Error) => setPhase({ kind: 'problem', message: err.message }));
    return () => {
      if (poll.current) clearTimeout(poll.current);
    };
  }, [check]);

  if (phase.kind === 'ready') return <Shell />;

  const turnOn = async () => {
    setBusy(true);
    try {
      const machine = await setMachinePower('start');
      setPhase({ kind: 'starting', machine, since: Date.now() });
      poll.current = setTimeout(() => void check(), 5000);
    } catch (err) {
      setPhase({ kind: 'problem', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const cost = (m?: MachineStatus) => (m?.costPerHour != null ? ` ($${m.costPerHour.toFixed(2)}/hour)` : '');

  return (
    <div className="boot shell" role="main">
      <div className="boot-card glass">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={56} height={56} className="boot-logo" />
        <h1>Orbit</h1>
        {phase.kind === 'checking' && (
          <p className="boot-status" role="status">
            <span className="boot-spinner" aria-hidden /> Connecting to your Linux machine…
          </p>
        )}
        {phase.kind === 'off' && (
          <>
            <p role="status">Your Linux machine is off.</p>
            <p className="muted">Orbit&apos;s Terminal, Code and Antigravity run on it. Your saved files are kept while it&apos;s off.</p>
            {phase.machine.canControl ? (
              <button type="button" className="btn primary block" onClick={turnOn} disabled={busy}>
                {busy ? 'Turning on…' : `Turn on${cost(phase.machine)}`}
              </button>
            ) : (
              <p className="muted">Turn it on from the workspace page or the Runpod console.</p>
            )}
            <button type="button" className="btn ghost block" onClick={() => enterDemo('machine-off')}>
              Use demo mode instead
            </button>
          </>
        )}
        {phase.kind === 'starting' && (
          <>
            <p className="boot-status" role="status">
              <span className="boot-spinner" aria-hidden /> Starting your Linux machine…
            </p>
            <p className="muted">
              Usually ready in 1–3 minutes (longer the very first time). This screen continues by itself.
              {Date.now() - phase.since > 60_000 ? ` Waiting ${Math.round((Date.now() - phase.since) / 60000)} min so far.` : ''}
            </p>
            <button type="button" className="btn ghost block" onClick={() => enterDemo('unreachable')}>
              Use demo mode while waiting
            </button>
          </>
        )}
        {phase.kind === 'problem' && (
          <>
            <p role="alert">{phase.message}</p>
            <button type="button" className="btn primary block" onClick={() => void check()}>
              Try again
            </button>
            <button type="button" className="btn ghost block" onClick={() => enterDemo('unreachable')}>
              Use demo mode
            </button>
          </>
        )}
        <a className="btn ghost block" href="/?choose=1">
          Switch workspace
        </a>
      </div>
    </div>
  );
}
