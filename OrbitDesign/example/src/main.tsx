/**
 * The sample app's entry: the CSS in the order src/styles/README.md gives, the fonts, the motion
 * provider, the app, and one orb at the end with no brain (plug one in from src/ai to let it think).
 */
import 'orbit-design/styles/tokens.css';
import 'orbit-design/styles/base.css';
import 'orbit-design/motion/motion.css';
import 'orbit-design/styles/glass.css';
import 'orbit-design/styles/o5.css';
import 'orbit-design/orb/face.css';
import 'orbit-design/orb/orb.css';
import 'orbit-design/motion/depth.css';
import 'orbit-design/styles/pages.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadFonts } from 'orbit-design/styles/fonts';
import { MotionProvider } from 'orbit-design/motion';
import { OrbCursor } from 'orbit-design/orb';
import { App } from './App';

loadFonts();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionProvider pref="system">
      <App />
      {/* brain={null}: the orb follows, points, becomes the caret and shows notes, but cannot answer. */}
      <OrbCursor brain={null} />
    </MotionProvider>
  </StrictMode>,
);
