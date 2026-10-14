import 'server-only';

export type Machine = { id: string; name: string; os: 'windows' | 'linux' };

type MachineConfig = Machine & { urlEnv: string; secretEnv: string };

// Each machine has its own gateway and its own shared secret, so a ticket for one machine
// can never open another.
const KNOWN: MachineConfig[] = [
  { id: 'windows', name: 'Windows PC', os: 'windows', urlEnv: 'GATEWAY_URL', secretEnv: 'GATEWAY_SECRET' },
  { id: 'linux', name: 'Linux desktop', os: 'linux', urlEnv: 'LINUX_GATEWAY_URL', secretEnv: 'LINUX_GATEWAY_SECRET' },
];

/** Gateway URL for a machine. The Linux machine's URL can be derived from its Runpod pod id. */
function urlFor(m: MachineConfig): string | undefined {
  if (process.env[m.urlEnv]) return process.env[m.urlEnv];
  if (m.id === 'linux' && process.env.LINUX_POD_ID) return `wss://${process.env.LINUX_POD_ID}-8080.proxy.runpod.net`;
  return undefined;
}

const configured = (m: MachineConfig) => Boolean(urlFor(m) && process.env[m.secretEnv]);

/** Machines whose gateway is configured, safe to send to the browser. */
export function listMachines(): Machine[] {
  return KNOWN.filter(configured).map(({ id, name, os }) => ({ id, name, os }));
}

export function getMachine(id: string): Machine | null {
  return listMachines().find((m) => m.id === id) ?? null;
}

/** Gateway URL and signing key for a machine. Server-side only. */
export function gatewayFor(id: string) {
  const m = KNOWN.find((k) => k.id === id);
  if (!m || !configured(m)) return null;
  const secret = process.env[m.secretEnv]!;
  if (secret.length < 32) throw new Error(`${m.secretEnv} must be at least 32 characters`);
  return { url: urlFor(m)!, key: new TextEncoder().encode(secret) };
}
