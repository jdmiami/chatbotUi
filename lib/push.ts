import 'server-only';
import crypto from 'node:crypto';
import { aiBase, aiToken, findAiPod } from './ai';

/**
 * Notifications from the AI machine ("turning off in 10 minutes"). The machine sends them; its
 * signing key is worked out from the gateway secret (same as ai/gate/src/push.js), so browsers can
 * get the public key here even while the machine is off.
 */
const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

export function pushPublicKey(secret = process.env.LINUX_GATEWAY_SECRET || ''): string | null {
  if (secret.length < 32) return null;
  for (let i = 0; ; i++) {
    const d = crypto.createHmac('sha256', secret).update(`orbit-vapid-v1:${i}`).digest();
    const n = BigInt(`0x${d.toString('hex')}`);
    if (n === 0n || n >= N) continue;
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(d);
    return ecdh.getPublicKey().toString('base64url');
  }
}

/** Signs a browser up on the AI machine (or stops it). Throws when the machine is off. */
export async function aiPush(user: string, method: 'POST' | 'DELETE', body: { subscription?: unknown; endpoint?: string }) {
  const pod = await findAiPod();
  if (!pod || pod.status !== 'RUNNING') throw new Error('The AI machine is not on.');
  const res = await fetch(`${aiBase(pod.id)}/_orbit/push`, {
    method,
    headers: { authorization: `Bearer ${await aiToken(user, 'orbit-ai')}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const out = (await res.json().catch(() => ({}))) as { error?: string; devices?: number };
  if (!res.ok) throw new Error(out.error || `The AI machine answered ${res.status}.`);
  return out;
}
