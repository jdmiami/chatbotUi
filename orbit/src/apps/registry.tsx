import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { AppId } from '../state/shell';
import { Icon, type IconName } from '../ui/Icon';
import type { AppProps } from './types';

// Each app is its own download (CodeMirror and xterm are large), fetched the first time it opens.
// preloadApps() fetches them in the background once Orbit has started, so later opens are instant.
const loaders: Record<AppId, () => Promise<{ default: ComponentType<AppProps> }>> = {
  terminal: () => import('./terminal/TerminalApp'),
  editor: () => import('./editor/EditorApp'),
  agent: () => import('./agent/AgentApp'),
  ai: () => import('./ai/AiApp'),
  settings: () => import('./settings/SettingsApp'),
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
    <span
      className="glyph"
      style={{ background: app.tile, color: app.glyph, width: size, height: size }}
      aria-hidden
    >
      <IconByName name={app.icon} size={Math.round(size * 0.5)} />
    </span>
  );
}

function IconByName({ name, size }: { name: IconName; size: number }) {
  return <Icon name={name} size={size} strokeWidth={2} />;
}
