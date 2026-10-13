import 'server-only';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function secret(name: string): Uint8Array {
  const value = required(name);
  if (value.length < 32) throw new Error(`${name} must be at least 32 characters`);
  return new TextEncoder().encode(value);
}

export const config = {
  get username() {
    return required('AUTH_USERNAME');
  },
  // bcrypt hash, base64-encoded so the "$" characters survive .env parsing.
  get passwordHash() {
    return Buffer.from(required('AUTH_PASSWORD_HASH'), 'base64').toString('utf8');
  },
  get totpSecret() {
    return process.env.TOTP_SECRET || '';
  },
  get sessionSecret() {
    return secret('SESSION_SECRET');
  },
  get sessionHours() {
    return Number(process.env.SESSION_HOURS || 12);
  },
  get gatewayUrl() {
    return required('GATEWAY_URL');
  },
  get gatewaySecret() {
    return secret('GATEWAY_SECRET');
  },
};
