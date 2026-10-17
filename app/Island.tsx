'use client';

import { useEffect } from 'react';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'orbit-island': { api?: string; place?: string };
    }
  }
}

/** The glass status pill (money, auto-off timers, machine stats), shared with Orbit: orbit/public/island.js. */
export default function Island() {
  useEffect(() => {
    if (document.querySelector('script[data-orbit-island]')) return;
    const s = document.createElement('script');
    s.type = 'module';
    s.src = '/orbit/island.js';
    s.dataset.orbitIsland = '';
    document.head.append(s);
  }, []);
  return <orbit-island api="/api/status" place="site" />;
}
