import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/motion.css';
import './styles/glass.css';
import { Boot } from './shell/Boot';
import { MotionProvider } from './motion/MotionProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionProvider>
      <Boot />
    </MotionProvider>
  </StrictMode>,
);
