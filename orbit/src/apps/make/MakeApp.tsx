import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppProps } from '../types';
import { useShell } from '../../state/shell';
import { useWorkspace } from '../../state/workspace';
import { getLocalAi, type AiMachineStatus } from '../../services/ai/LocalAi';
import type { CloudKind } from '../../services/ai/CloudMake';
import { CreateView } from '../ai/CreateView';
import { Icon } from '../../ui/Icon';
import { CloudMake } from './CloudMake';
import { CharactersScreen } from './CharactersScreen';
import { MakeDownloads } from './MakeDownloads';
import { MachineNotice } from '../../ui/MachineNotice';
import { SpeedChoice, useSpeed } from '../../ui/SpeedChoice';
import '../agent/agent.css';
import '../ai/ai.css';
import './make.css';

/**
 * Make: pictures, videos and edits, as an app of its own. A walk-through one step per screen (no
 * scrolling): swipe left for the next step, right to go back. The gallery and making in the cloud
 * open over it. Drawing lives in Live Draw ("Draw it" opens it).
 */
export default function MakeApp({ isActive }: AppProps) {
  const ai = useMemo(() => getLocalAi(), []);
  const toast = useShell((s) => s.toast);
  const launch = useShell((s) => s.launch);
  const [status, setStatus] = useState<AiMachineStatus | null>(null);
  const [powering, setPowering] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [charsOpen, setCharsOpen] = useState(false);
  const [useCharacter, setUseCharacter] = useState<{ id: string; n: number } | null>(null);
  const [seed, setSeed] = useState<{ prompt: string; kind: CloudKind; n: number } | null>(null);
  const [moved, setMoved] = useState(0);
  const speed = useSpeed(status);

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

  const notice = status && !machineOn && (status.state === 'off' || waking) && (
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
  );

  return (
    <div className="ag-root ai-root make-root">
      <MakeDownloads ai={ai} status={status} machineOn={machineOn} isActive={isActive} />
      <CreateView
        ai={ai}
        machineOn={machineOn}
        isActive={isActive}
        covered={cloudOpen || charsOpen}
        useCharacter={useCharacter}
        onCharacters={() => setCharsOpen(true)}
        onOpenMakers={openMakers}
        reloadKey={moved}
        kicker={state ? `AI machine ${state}` : undefined}
        notice={notice}
        onCloud={(s) => {
          setSeed((p) => ({ ...s, n: (p?.n ?? 0) + 1 }));
          setCloudOpen(true);
        }}
        actions={
          <>
            {status && (
              <button type="button" className="mk-top-btn" aria-label="Cloud" aria-expanded={cloudOpen} onClick={() => setCloudOpen(true)}>
                <Icon name="sparkle" size={18} />
                <span>Cloud</span>
              </button>
            )}
          </>
        }
      />
      {/* No machine on (or you'd rather): pictures and videos from the cloud, in seconds. Always
          mounted, so what waits on this device moves into the gallery once the machine is on. */}
      {status && (
        <section className="mk-screen mk-cloud" aria-label="Cloud making" hidden={!cloudOpen}>
          <header className="mk-screen-head mk-screen-head-bare">
            <button type="button" className="mk-top-btn" onClick={() => setCloudOpen(false)}>
              <Icon name="back" size={18} />
              <span>Back to making</span>
            </button>
          </header>
          <div className="mk-screen-scroll">
            <CloudMake ai={ai} machineOn={machineOn} isActive={isActive} open onOpen={() => setCloudOpen(true)} onMoved={() => setMoved((n) => n + 1)} seed={seed} />
          </div>
        </section>
      )}
      {/* Characters: made-up adults you create from words, to add to a prompt or swap in. Over the steps, like the gallery. */}
      <section className="mk-screen mk-characters" aria-label="Characters" hidden={!charsOpen}>
        <CharactersScreen
          ai={ai}
          machineOn={machineOn}
          open={charsOpen && isActive}
          reloadKey={moved}
          onClose={() => setCharsOpen(false)}
          onUse={(c) => {
            setUseCharacter((p) => ({ id: c.id, n: (p?.n ?? 0) + 1 }));
            setCharsOpen(false);
          }}
        />
      </section>
    </div>
  );
}
