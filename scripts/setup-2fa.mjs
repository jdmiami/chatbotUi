// Usage: npm run setup-2fa -- your-username
// Prints a TOTP_SECRET and a setup link for Google Authenticator, 1Password, Authy, etc.
import { TOTP, Secret } from 'otpauth';

const label = process.argv[2] || 'admin';
const secret = new Secret({ size: 20 });
const totp = new TOTP({ issuer: 'Remote Desktop', label, secret, digits: 6, period: 30 });

console.log('TOTP_SECRET=' + secret.base32);
console.log('\nIn your authenticator app choose "Enter a setup key" and paste the secret above,');
console.log('or open this link on your phone:\n' + totp.toString());
