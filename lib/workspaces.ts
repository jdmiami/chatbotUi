// Where each workspace lives on this site, and the cookie that remembers the user's choice.
export const WORKSPACES = {
  orbit: '/orbit',
  ai: '/ai',
  code: '/code',
  linux: '/desktop/linux',
  windows: '/desktop/windows',
} as const;
export type WorkspaceId = keyof typeof WORKSPACES;
export const PREF_COOKIE = 'ws_pref';

export function isWorkspace(value: unknown): value is WorkspaceId {
  return typeof value === 'string' && Object.hasOwn(WORKSPACES, value);
}
