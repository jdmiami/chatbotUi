import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/fraunces/opsz-italic.css';
import '@fontsource-variable/inter/index.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Orbit',
  description: 'Orbit: your machines, AI and desktops from any browser.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0d0c0b' },
    { media: '(prefers-color-scheme: light)', color: '#f5f1e9' },
  ],
};

// Reads the Motion and Theme settings saved by Orbit (same site, same browser) so these pages move and
// look the same way. Auto motion = full unless the device asks for less; system theme follows the device.
// Runs before first paint.
const SETTINGS_SCRIPT = `(function(){var d=document.documentElement,s={};try{s=(JSON.parse(localStorage.getItem('orbit:shell:v1')||'{}').state||{}).settings||{}}catch(e){}var m=s.motion||'system',r=matchMedia('(prefers-reduced-motion: reduce)').matches;d.dataset.motion=m==='reduce'||(m==='system'&&r)?'off':m==='lite'?'lite':'full';var t=s.theme;d.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SETTINGS_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
