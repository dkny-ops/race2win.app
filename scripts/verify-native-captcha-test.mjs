// Bounded negative checks only. No valid email, user token, or admin key is used.
import nextEnv from '@next/env';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const official = 'C:\\Users\\crist\\Documents\\Codex\\race2win-readiness-20261010';
if (root.toLowerCase() !== official.toLowerCase()) throw new Error('Use the official folder.');
if (execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim() !== 'fix/production-readiness-20261010') throw new Error('Wrong branch.');
nextEnv.loadEnvConfig(root, true, { info() {}, error() {} });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (url !== 'https://lndvnufmbuzdbinapvze.supabase.co' || !key) throw new Error('TEST public configuration required.');
if (!key.startsWith('sb_publishable_')) {
  const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  if (payload.ref !== 'lndvnufmbuzdbinapvze' || payload.role !== 'anon') throw new Error('Wrong public credential.');
}
const paths = [
  ['/otp', { email: 'not-an-email', create_user: false }],
  ['/signup', { email: 'not-an-email', password: 'Audit-invalid-address-only-123!' }],
  ['/recover', { email: 'not-an-email' }],
  ['/resend', { email: 'not-an-email', type: 'signup' }],
  ['/magiclink', { email: 'not-an-email' }],
];
let passed = 0;
for (const [path, body] of paths) {
  for (const mode of ['missing', 'invalid']) {
    let response, result;
    try {
      response = await fetch(`${url}/auth/v1${path}`, {
        method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
        // Native CAPTCHA middleware must reject before email validation.
        // A malformed email also prevents delivery if CAPTCHA is not enabled.
        body: JSON.stringify({ ...body, ...(mode === 'invalid' ? { gotrue_meta_security: { captcha_token: 'invalid-audit-captcha-token' } } : {}) }),
        signal: AbortSignal.timeout(10000),
      });
      result = await response.json();
    } catch {
      console.log('NOT VERIFIED: TEST connection unavailable. No retry.');
      process.exitCode = 2;
      break;
    }
    const verified = response.status >= 400 && response.status < 500 && result?.code === 'captcha_failed';
    console.log(`${verified ? 'PASS' : 'NOT VERIFIED'} ${path} ${mode}: HTTP ${response.status}${verified ? ' captcha_failed' : ' (non-CAPTCHA result)'}; no response body printed.`);
    if (!verified) { process.exitCode = 2; break; }
    passed++;
  }
  if (process.exitCode) break;
}
console.log(`${passed}/10 direct negative CAPTCHA checks passed. Invalid email only; no positive email test performed.`);
