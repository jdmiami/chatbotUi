#!/usr/bin/env node
// Makes new passwords and secrets for your workspace, right on the Linux machine, so they never
// pass through anyone else. Nothing is saved or logged; copy what it prints into Vercel or Runpod.
//
//   workspace-secrets site-password   asks for a new sign-in password (hidden, twice) and prints
//                                     the value for AUTH_PASSWORD_HASH in Vercel
//   workspace-secrets random          prints a new random secret (for SESSION_SECRET,
//                                     LINUX_GATEWAY_SECRET / GATEWAY_SECRET, DESKTOP_PASSWORD)
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const cmd = process.argv[2];

function randomSecret(length = 48) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length * 2)) {
      if (byte < alphabet.length * 4) out += alphabet[byte % alphabet.length]; // unbiased
      if (out.length === length) break;
    }
  }
  return out;
}

/** Reads a line from the terminal without showing it. */
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error('Run this in a terminal.'));
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

if (cmd === 'random') {
  console.log(randomSecret());
} else if (cmd === 'site-password') {
  const first = await askHidden('New sign-in password (at least 12 characters): ');
  if (first.length < 12) {
    console.error('That is shorter than 12 characters. Nothing was changed; run it again.');
    process.exit(1);
  }
  const second = await askHidden('Type it again: ');
  if (first !== second) {
    console.error("The two entries don't match. Nothing was changed; run it again.");
    process.exit(1);
  }
  const hash = await bcrypt.hash(first, 12);
  console.log('\nPut this in Vercel as AUTH_PASSWORD_HASH (Production), then redeploy:\n');
  console.log(Buffer.from(hash).toString('base64'));
} else {
  console.log('Usage:\n  workspace-secrets site-password   new sign-in password for your site\n  workspace-secrets random          new random secret');
  process.exit(cmd ? 1 : 0);
}
