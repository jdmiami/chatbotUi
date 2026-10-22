import { useEffect, useState } from 'react';
import { configureServices } from '../services';
import { AiError, getLocalAi } from '../services/ai/LocalAi';
import type { StudioDef } from './defs';
import { StudioApp } from './StudioApp';

/**
 * A studio needs no Linux machine and none of Orbit's own apps: only a signed-in member and the
 * studio's AI. Signed out goes to the sign-in page.
 */
export function StudioBoot({ studio }: { studio: StudioDef }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    configureServices('demo', { demoReason: 'chosen' });
    getLocalAi()
      .status()
      .catch((err) => {
        if (err instanceof AiError && err.status === 401) window.location.href = '/login';
      })
      .finally(() => setReady(true));
  }, []);
  return ready ? <StudioApp studio={studio} /> : <div className="st-root" aria-busy="true" />;
}
