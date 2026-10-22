import { useEffect, useState } from 'react';
import { configureServices } from '../services';
import type { StudioDef } from './defs';
import { StudioApp } from './StudioApp';
import { setStudioId, studioAi } from './memberApi';

/**
 * A studio needs no Linux machine and none of Orbit's own apps: only a signed-in member and the
 * studio's AI. Signed out goes to the sign-in page.
 */
export function StudioBoot({ studio }: { studio: StudioDef }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    configureServices('demo', { demoReason: 'chosen' });
    // Signed out goes to the studio's own sign-in page (memberApi does that on a 401).
    setStudioId(studio.id);
    studioAi
      .status()
      .then(() => setReady(true))
      .catch((err: { status?: number }) => err?.status !== 401 && setReady(true));
  }, [studio.id]);
  return ready ? <StudioApp studio={studio} /> : <div className="st-root" aria-busy="true" />;
}
