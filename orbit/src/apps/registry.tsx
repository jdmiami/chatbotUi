import type { ComponentType } from 'react';
import type { AppId } from '../state/shell';
import { Icon, type IconName } from '../ui/Icon';
import type { AppProps } from './types';
import TerminalApp from './terminal/TerminalApp';
import EditorApp from './editor/EditorApp';
import AgentApp from './agent/AgentApp';
import SettingsApp from './settings/SettingsApp';

export interface AppMeta {
  id: AppId;
  name: string;
  /** Short accessible description used in the dock/home labels. */
  description: string;
  icon: IconName;
  /** Icon tile background (gradient) and glyph colour. */
  tile: string;
  glyph: string;
  component: ComponentType<AppProps>;
}

export const APPS: Record<AppId, AppMeta> = {
  terminal: {
    id: 'terminal',
    name: 'Terminal',
    description: 'Shell on the Ubuntu host (simulated in demo mode)',
    icon: 'terminal',
    tile: 'linear-gradient(145deg, #1d2333, #0c0f18)',
    glyph: '#7dffb0',
    component: TerminalApp,
  },
  editor: {
    id: 'editor',
    name: 'Code',
    description: 'Code editor for project files',
    icon: 'code',
    tile: 'linear-gradient(145deg, #3a4bff, #1f2a99)',
    glyph: '#ffffff',
    component: EditorApp,
  },
  agent: {
    id: 'agent',
    name: 'Antigravity',
    description: 'Chat and session manager for the Antigravity CLI',
    icon: 'sparkle',
    tile: 'linear-gradient(145deg, #0fb39b, #0a5c78)',
    glyph: '#fff6c9',
    component: AgentApp,
  },
  settings: {
    id: 'settings',
    name: 'Settings',
    description: 'Appearance, data and about',
    icon: 'gear',
    tile: 'linear-gradient(145deg, #8a93a8, #4b5266)',
    glyph: '#ffffff',
    component: SettingsApp,
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
