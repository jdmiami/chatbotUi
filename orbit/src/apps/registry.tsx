import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { AppId } from '../state/shell';
import type { IconName } from '../ui/Icon';
import { AppArt } from '../ui/AppArt';
import type { AppProps } from './types';

// Each app is its own download (CodeMirror and xterm are large), fetched the first time it opens.
// preloadApps() fetches them in the background once Orbit has started, so later opens are instant.
const loaders: Record<AppId, () => Promise<{ default: ComponentType<AppProps> }>> = {
  terminal: () => import('./terminal/TerminalApp'),
  editor: () => import('./editor/EditorApp'),
  agent: () => import('./agent/AgentApp'),
  ai: () => import('./ai/AiApp'),
  store: () => import('./store/StoreApp'),
  soreal: () => import('./soreal/SoRealApp'),
  lab: () => import('./lab/LabApp'),
  settings: () => import('./settings/SettingsApp'),
  playground: () => import('./portal/PortalApp').then((m) => ({ default: m.PlaygroundApp })),
  vscode: () => import('./portal/PortalApp').then((m) => ({ default: m.VsCodeApp })),
  desktop: () => import('./portal/PortalApp').then((m) => ({ default: m.DesktopApp })),
  windows: () => import('./portal/PortalApp').then((m) => ({ default: m.WindowsApp })),
};

export function preloadApps() {
  Object.values(loaders).forEach((load) => void load().catch(() => {}));
}

export interface AppMeta {
  id: AppId;
  name: string;
  /** Short accessible description used in the dock/home labels. */
  description: string;
  icon: IconName;
  /** Icon tile background (gradient) and glyph colour. */
  tile: string;
  glyph: string;
  component: LazyExoticComponent<ComponentType<AppProps>>;
}

export const APPS: Record<AppId, AppMeta> = {
  terminal: {
    id: 'terminal',
    name: 'Terminal',
    description: 'Shell on your Linux machine (simulated in demo mode)',
    icon: 'terminal',
    tile: 'linear-gradient(145deg, #1d2333, #0c0f18)',
    glyph: '#7dffb0',
    component: lazy(loaders.terminal),
  },
  editor: {
    id: 'editor',
    name: 'Code',
    description: 'Code editor for project files',
    icon: 'code',
    tile: 'linear-gradient(145deg, #3a4bff, #1f2a99)',
    glyph: '#ffffff',
    component: lazy(loaders.editor),
  },
  agent: {
    id: 'agent',
    name: 'Antigravity',
    description: 'Chat and session manager for the Antigravity CLI',
    icon: 'sparkle',
    tile: 'linear-gradient(145deg, #0fb39b, #0a5c78)',
    glyph: '#fff6c9',
    component: lazy(loaders.agent),
  },
  ai: {
    id: 'ai',
    name: 'AI',
    description: 'Chat with your own open models on your GPU machine',
    icon: 'bolt',
    tile: 'linear-gradient(145deg, #8b5cf6, #2563eb 60%, #06b6d4)',
    glyph: '#ffffff',
    component: lazy(loaders.ai),
  },
  store: {
    id: 'store',
    name: 'Store',
    description: 'The AI Store: chat models, picture and video makers, with full details',
    icon: 'download',
    tile: 'linear-gradient(145deg, #f5c16c, #d9663a 55%, #6d2a5c)',
    glyph: '#ffffff',
    component: lazy(loaders.store),
  },
  soreal: {
    id: 'soreal',
    name: 'soReal',
    description: 'Say what your movie is about; the AI writes it, storyboards it and makes it',
    icon: 'film',
    tile: 'linear-gradient(145deg, #ff5f6d, #c2185b 55%, #4a148c)',
    glyph: '#fff1e0',
    component: lazy(loaders.soreal),
  },
  lab: {
    id: 'lab',
    name: 'Lab',
    description: 'Comedy or spicy videos made while your AI machine is on, scored for how viral they could go',
    icon: 'sparkle',
    tile: 'linear-gradient(145deg, #ffd36b, #ff7a59 55%, #8a2be2)',
    glyph: '#ffffff',
    component: lazy(loaders.lab),
  },
  playground: {
    id: 'playground',
    name: 'Playground',
    description: 'The full AI playground (Open WebUI) on your AI machine',
    icon: 'sliders',
    tile: 'linear-gradient(145deg, #ffb547, #f0517a)',
    glyph: '#ffffff',
    component: lazy(loaders.playground),
  },
  vscode: {
    id: 'vscode',
    name: 'VS Code',
    description: 'VS Code in the browser on your Linux machine, with an AI agent',
    icon: 'code',
    tile: 'linear-gradient(145deg, #3aa0ff, #0b4fa8)',
    glyph: '#ffffff',
    component: lazy(loaders.vscode),
  },
  desktop: {
    id: 'desktop',
    name: 'Linux desktop',
    description: 'The whole Ubuntu desktop of your Linux machine',
    icon: 'sidebar',
    tile: 'linear-gradient(145deg, #f0743e, #6b2457)',
    glyph: '#ffffff',
    component: lazy(loaders.desktop),
  },
  windows: {
    id: 'windows',
    name: 'Windows PC',
    description: 'Your Windows PC at home',
    icon: 'switcher',
    tile: 'linear-gradient(145deg, #5ad1ff, #1666d6)',
    glyph: '#ffffff',
    component: lazy(loaders.windows),
  },
  settings: {
    id: 'settings',
    name: 'Settings',
    description: 'Appearance, data and about',
    icon: 'gear',
    tile: 'linear-gradient(145deg, #8a93a8, #4b5266)',
    glyph: '#ffffff',
    component: lazy(loaders.settings),
  },
};

export function AppGlyph({ app, size = 64 }: { app: AppMeta; size?: number }) {
  return (
    <span className="glyph glyph-art" style={{ width: size, height: size }} aria-hidden>
      <AppArt id={app.id} size={size} />
    </span>
  );
}
