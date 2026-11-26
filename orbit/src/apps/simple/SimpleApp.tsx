import type { AppProps } from '../types';
import { Icon } from '../../ui/Icon';
import './simple.css';

/**
 * Simple inside Orbit: the site's light page (/lite: Make, Lab, Live, AI Center, Gallery) in an
 * Orbit window, signed in the same way. "Full screen" opens it on its own and remembers it as the
 * look this device starts in (/choose); Simple's own Orbit button comes back.
 */
export default function SimpleApp({ isActive }: AppProps) {
  return (
    <div className="simple-root">
      <div className="simple-bar">
        <span className="simple-title">Simple</span>
        <button type="button" className="btn ghost small" onClick={() => window.location.assign('/choose?ui=simple')}>
          <Icon name="switcher" size={16} /> Full screen
        </button>
      </div>
      {/* Loaded once and kept while the window is open, so what you were doing stays put. */}
      <iframe className="simple-frame" src="/lite" title="Simple" data-active={isActive || undefined} allow="camera; microphone; clipboard-write; fullscreen" />
    </div>
  );
}
