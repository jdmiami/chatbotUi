import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppProps } from '../types';
import { AppHeader } from '../../ui/components';
import { useShell } from '../../state/shell';
import { getLocalAi, type AiMachineStatus } from '../../services/ai/LocalAi';
import { MemeLab } from '../ai/MemeLab';
import { MachineNotice } from '../../ui/MachineNotice';
import '../agent/agent.css';
import '../ai/ai.css';

/** The Lab as its own app: the same screen as the AI app's Lab tab. */
export default function LabApp({ isActive }: AppProps) {
  const ai = useMemo(() => getLocalAi(), []);
  const toast = useShell((s) => s.toast);
  const [status, setStatus] = useState<AiMachineStatus | null>(null);
  const [powering, setPowering] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await ai.status());
    } catch {
      /* the site isn't behind Orbit (preview, tests) */
    }
  }, [ai]);
  useEffect(() => {
    if (!isActive) return;
    void refresh();
    const waking = status && status.state !== 'on' && status.state !== 'off' && status.state !== 'unconfigured';
    const t = setInterval(refresh, waking ? 5000 : 30000);
    return () => clearInterval(t);
  }, [isActive, refresh, status?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once on, the Lab stays on screen until the machine is really off: one slow or odd status answer
  // must not swap the whole Lab out and back (it looked like the page reloading).
  const wasOn = useRef(false);
  if (status?.state === 'on') wasOn.current = true;
  else if (status && status.state !== 'error') wasOn.current = false;
  const machineOn = status?.state === 'on' || wasOn.current;
  const turnOn = async () => {
    setPowering(true);
    try {
      setStatus(await ai.power('start'));
      toast('Turning the AI machine on. The Lab starts as soon as it is ready (2–4 minutes).', 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPowering(false);
    }
  };

  return (
    <div className="ag-root ai-root lab-root">
      <AppHeader title="Lab" subtitle={machineOn ? 'Your AI machine: on' : status ? `Your AI machine: ${status.state === 'starting' || status.state === 'downloading' ? 'waking up' : 'resting'}` : 'Videos made while the machine is on'} />
      <div className="lab-scroll">
        {status && !machineOn && status.state === 'off' && (
          <MachineNotice id="lab" label="AI machine off">
            <div className="ai-banner" role="status">
              <p>Turn the AI machine on and the Lab starts making videos as soon as it is ready.</p>
              <button type="button" className="btn primary" onClick={() => void turnOn()} disabled={powering}>
                {powering ? 'Turning on…' : 'Turn it on'}
              </button>
            </div>
          </MachineNotice>
        )}
        <MemeLab ai={ai} machineOn={machineOn} isActive={isActive} />
      </div>
    </div>
  );
}
