import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/global.css';
import './styles/motion.css';
import './styles/glass.css';
import './styles/o5.css';
import { MotionProvider } from './motion/MotionProvider';
import { useApplySettings } from './hooks/useApplySettings';
import { Toasts } from './shell/Toasts';
import FlipbookApp from './apps/flipbook/FlipbookApp';

/**
 * Flipbook on its own: its own address, no sign-in, its own icon on the home screen, and it works
 * offline once opened. Everything stays on the device (drawings in IndexedDB); it talks to no server.
 */
function Standalone() {
  useApplySettings();
  return (
    <div className="fb-standalone">
      <FlipbookApp placement="full" isActive compact={false} />
      <Toasts />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionProvider>
      <Standalone />
    </MotionProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}));
}
