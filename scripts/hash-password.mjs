// Usage: npm run hash-password -- "your password"
// Prints the value for AUTH_PASSWORD_HASH (bcrypt, base64-encoded).
import bcrypt from 'bcryptjs';

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-password -- "your password"');
  process.exit(1);
}
if (password.length < 12) console.warn('Warning: use at least 12 characters for a remote desktop login.');
const hash = await bcrypt.hash(password, 12);
console.log(Buffer.from(hash).toString('base64'));
