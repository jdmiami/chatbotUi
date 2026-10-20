// Phone and computer notifications (Web Push) from the AI machine, e.g. "turning off in 10 minutes".
// The pushes carry no message (so nothing needs encrypting): Orbit's service worker shows the text.
// The signing key (VAPID) is worked out from the gateway secret, so the site can hand browsers the
// same public key while this machine is off, and nothing new has to be stored or shown.
import crypto from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
// The order of the P-256 curve: a private key must be below it.
const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

/** Same derivation as the site's lib/push.ts. */
export function vapidKeys(secret) {
  for (let i = 0; ; i++) {
    const d = crypto.createHmac('sha256', secret).update(`orbit-vapid-v1:${i}`).digest();
    const n = BigInt(`0x${d.toString('hex')}`);
    if (n === 0n || n >= N) continue;
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(d);
    const pub = ecdh.getPublicKey(); // 65 bytes: 04 | x | y
    const key = crypto.createPrivateKey({
      key: { kty: 'EC', crv: 'P-256', d: b64url(d), x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33)) },
      format: 'jwk',
    });
    return { publicKey: b64url(pub), privateKey: key };
  }
}

export function vapidHeader({ endpoint, keys, subject, now = Date.now() }) {
  const enc = (o) => b64url(JSON.stringify(o));
  const head = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`;
  const sig = crypto.sign('sha256', Buffer.from(head), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${b64url(sig)}, k=${keys.publicKey}`;
}

/** Only real push services (https), so a saved address can't make the machine call anything else. */
export function validSubscription(sub) {
  try {
    const u = new URL(sub?.endpoint);
    return u.protocol === 'https:' && sub.endpoint.length < 1024;
  } catch {
    return false;
  }
}

/**
 * `load`/`save` keep the list of subscribed browsers (in R2 when the disk is wiped at each stop).
 */
export function createPush({ secret, subject, load = async () => [], save = async () => {}, fetchImpl = fetch, log = console, max = 10 }) {
  const keys = vapidKeys(secret);
  let subs = null;
  const all = async () => (subs ??= ((await load().catch(() => null)) || []).filter(validSubscription));

  return {
    publicKey: keys.publicKey,
    async add(sub) {
      if (!validSubscription(sub)) throw new Error('That is not a push subscription.');
      const list = (await all()).filter((s) => s.endpoint !== sub.endpoint);
      subs = [...list, { endpoint: sub.endpoint }].slice(-max);
      await save(subs);
      return subs.length;
    },
    async remove(endpoint) {
      subs = (await all()).filter((s) => s.endpoint !== endpoint);
      await save(subs);
    },
    async count() {
      return (await all()).length;
    },
    /** Wakes every subscribed browser. Ones the push service says are gone are dropped. */
    async send({ ttlSeconds = 600 } = {}) {
      const list = await all();
      let sent = 0;
      const gone = [];
      await Promise.all(
        list.map(async (s) => {
          try {
            const res = await fetchImpl(s.endpoint, {
              method: 'POST',
              headers: { authorization: vapidHeader({ endpoint: s.endpoint, keys, subject }), ttl: String(ttlSeconds), urgency: 'high', 'content-length': '0' },
              signal: AbortSignal.timeout(15_000),
            });
            if (res.status === 404 || res.status === 410) gone.push(s.endpoint);
            else if (res.ok) sent++;
            else log.warn?.(`[gate] push service answered ${res.status}`);
          } catch (err) {
            log.warn?.(`[gate] could not send a notification: ${err.message}`);
          }
        }),
      );
      if (gone.length) {
        subs = list.filter((s) => !gone.includes(s.endpoint));
        await save(subs).catch(() => {});
      }
      return sent;
    },
  };
}
