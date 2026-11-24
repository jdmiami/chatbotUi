/** Which look opens from the first page: Orbit (the full one) or Simple (the light one, /lite). */
export type UiChoice = 'orbit' | 'simple';
export const UI_COOKIE = 'orbit-ui';
export const uiHome = (ui: UiChoice) => (ui === 'simple' ? '/lite' : '/orbit');
export const uiChoice = (v: string | undefined): UiChoice | null => (v === 'orbit' || v === 'simple' ? v : null);
