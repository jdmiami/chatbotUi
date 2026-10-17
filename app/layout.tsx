import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'My Workspace',
  description: 'Your Linux machine, Orbit and Windows PC from any browser.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0b0d12',
};

// Reads the Motion setting saved by Orbit (same site, same browser) so these pages animate the same way.
// Auto = full unless the device asks for reduced motion. Runs before first paint.
const MOTION_SCRIPT = `try{var m=((JSON.parse(localStorage.getItem('orbit:shell:v1')||'{}').state||{}).settings||{}).motion||'system';var r=matchMedia('(prefers-reduced-motion: reduce)').matches;document.documentElement.dataset.motion=m==='reduce'||(m==='system'&&r)?'off':m==='lite'?'lite':'full'}catch(e){document.documentElement.dataset.motion='full'}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
