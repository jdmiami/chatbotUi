/** MagStyle: the small-caps line over a machine banner, by machine state (hidden in the classic look). */
export const BANNER_KICKER: Record<string, string> = {
  off: 'The machine is resting',
  starting: 'Waking up',
  downloading: 'First start',
  unconfigured: 'Not set up',
  error: 'A problem',
};

/** The short line a hidden machine notice folds into (ui/MachineNotice). */
export function machineLabel(state: string | undefined, name = 'AI machine') {
  if (state === 'starting' || state === 'downloading') return `${name} waking up`;
  if (state === 'unconfigured') return `${name} not set up`;
  if (state === 'error') return `${name}: a problem`;
  return `${name} off`;
}
