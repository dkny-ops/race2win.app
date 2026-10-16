// Read-only independent HTTPS connections. No DB password, Auth email or writes.
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (root.toLowerCase() !== 'c:\\users\\crist\\documents\\codex\\race2win-readiness-20261010') throw new Error('Official folder required.');
if (execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim() !== 'fix/production-readiness-20261010') throw new Error('Official branch required.');
nextEnv.loadEnvConfig(root, true, { info() {}, error() {} });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url !== 'https://lndvnufmbuzdbinapvze.supabase.co' || !key) throw new Error('TEST administrative API configuration required.');
if (!key.startsWith('sb_secret_')) {
  let payload;
  try { payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); } catch { throw new Error('Invalid key format.'); }
  if (payload.ref !== 'lndvnufmbuzdbinapvze' || payload.role !== 'service_role') throw new Error('Wrong key project or role.');
}
function read(lane) {
  return new Promise(resolveRead => {
    const agent = new https.Agent({ keepAlive: false, rejectUnauthorized: true });
    const started = Date.now();
    const request = https.get(`${url}/rest/v1/game_sessions?select=id&limit=0`, {
      agent, headers: { apikey: key, Authorization: `Bearer ${key}` },
    }, response => {
      response.resume(); // Discard all body bytes; print no rows or private diagnostics.
      response.on('end', () => { agent.destroy(); resolveRead({ lane, status: response.statusCode, started, finished: Date.now() }); });
      response.on('error', () => { agent.destroy(); resolveRead({ lane, unavailable: true }); });
    });
    request.setTimeout(10000, () => request.destroy());
    request.on('error', () => { agent.destroy(); resolveRead({ lane, unavailable: true }); });
  });
}
const results = await Promise.all([read(1), read(2)]);
const accessible = results.every(result => result.status === 200);
const transportOverlap = accessible && Math.max(...results.map(result => result.started)) < Math.min(...results.map(result => result.finished));
console.log(JSON.stringify({ testApiAccessible: accessible, separateHttpsAgentsConfigured: true,
  independentConnectionsEstablished: accessible,
  transportOverlapObserved: transportOverlap, results,
  limitation: 'Read-only transport check; does not prove overlapping database transactions or mutation idempotency.' }, null, 2));
if (!accessible) process.exitCode = 2;
