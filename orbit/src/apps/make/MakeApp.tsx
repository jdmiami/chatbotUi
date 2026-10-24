import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppProps } from '../types';
import { MagCover } from '../../ui/Magazine';
import { useShell } from '../../state/shell';
import { useWorkspace } from '../../state/workspace';
import { useScrollDepth } from '../../shell/o5/depth';
import { getLocalAi, type AiMachineStatus } from '../../services/ai/LocalAi';
import { CreateView } from '../ai/CreateView';
import { CloudMake } from './CloudMake';
import { MakeDownloads } from './MakeDownloads';
import { MachineNotice } from '../../ui/MachineNotice';
import { SpeedChoice, useSpeed } from '../../ui/SpeedChoice';
import '../agent/agent.css';
import '../ai/ai.css';
import './make.css';

/**
 * Make: pictures, videos and edits, as an app of its own (it used to be a
 * tab of the AI app, beside the chat). Drawing lives in Live Draw ("Draw it" opens it). The steps are
 * the chapters of the page; the gallery closes it.
 */
export default function MakeApp({ isActive }: AppProps) {
  const ai = useMemo(() => getLocalAi(), []);
  const toast = useShell((s) => s.toast);
  const launch = useShell((s) => s.launch);
  const [status, setStatus] = useState<AiMachineStatus | null>(null);
  const [powering, setPowering] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [moved, setMoved] = useState(0);
  const speed = useSpeed(status);
  const scroller = useRef<HTMLDivElement>(null);
  useScrollDepth(scroller, isActive, 'edges');

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

  // Once on, Make stays on screen until the machine is really off: one odd status answer must not
  // swap it out and back (that looked like the page reloading).
  const wasOn = useRef(false);
  if (status?.state === 'on') wasOn.current = true;
  else if (status && status.state !== 'error') wasOn.current = false;
  const machineOn = status?.state === 'on' || wasOn.current;
  const waking = status?.state === 'starting' || status?.state === 'downloading';

  const turnOn = async () => {
    setPowering(true);
    try {
      setStatus(await ai.power('start', speed.chosen?.id));
      toast('Turning the AI machine on (2–4 minutes). Make is ready the moment it is.', 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPowering(false);
    }
  };
  const openMakers = () => {
    useWorkspace.getState().sendIntent({ app: 'store', type: 'open', shelf: 'makers' });
    launch('store');
  };
  const state = machineOn ? 'on' : waking ? 'waking up' : status ? 'resting' : null;

  return (
    <div className="ag-root ai-root make-root">
      <div className="make-scroll" ref={scroller}>
        <MakeDownloads ai={ai} status={status} machineOn={machineOn} isActive={isActive} />
        <MagCover
          kicker={<>Make{state ? ` · your AI machine is ${state}` : ''}</>}
          title="Make"
          dek="Pictures, videos and edits from a few words, a sketch or your camera. Everything you make lands in the gallery below, on every device."
        />
        {status && !machineOn && (status.state === 'off' || waking) && (
          <MachineNotice id="make" label={waking ? 'AI machine waking up' : 'AI machine off'}>
            <div className="ai-banner make-banner" role="status">
              <p>{waking ? 'Your AI machine is waking up. Make is ready the moment it is.' : 'Turn the AI machine on to make pictures and videos (2–4 minutes).'}</p>
              {!waking && (
                <>
                  <SpeedChoice {...speed} />
                  <button type="button" className="btn primary" onClick={() => void turnOn()} disabled={powering}>
                    {powering ? 'Turning on…' : 'Turn it on'}
                  </button>
                </>
              )}
            </div>
          </MachineNotice>
        )}
        {/* No machine on (or you'd rather): pictures and videos from the cloud, in seconds. */}
        {status && (
          <CloudMake
            ai={ai}
            machineOn={machineOn}
            isActive={isActive}
            open={!machineOn || cloudOpen}
            onOpen={() => setCloudOpen(true)}
            onMoved={() => setMoved((n) => n + 1)}
          />
        )}
        <CreateView ai={ai} machineOn={machineOn} isActive={isActive} onOpenMakers={openMakers} reloadKey={moved} />
      </div>
    </div>
  );
}
