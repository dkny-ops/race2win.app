// Official local launcher. No email sending, database writes or secret output.
import nextEnv from '@next/env';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const official='C:\\Users\\crist\\Documents\\Codex\\race2win-readiness-20261010';
const mode=process.argv[2]??'check';
if(!['check','start'].includes(mode)) throw new Error('Use check or start.');
function fail(message) { console.error(message); process.exit(1); }
if(root.toLowerCase()!==official.toLowerCase()) fail('Use the official readiness folder.');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
if(git('branch','--show-current')!=='fix/production-readiness-20261010') fail('Wrong branch.');
if(!/^v(?:2[2-9]|[3-9]\d)\./.test(process.version)) fail('Node >=22 required.');
// Next precedence: inherited process values win over local files. Inspect the
// effective values, not a guessed .env file. Do not import the main folder.
process.env.NODE_ENV='development';
nextEnv.loadEnvConfig(root,true,{info(){},error(){}});
const env=process.env;
if(Object.keys(env).some(name=>/^NEXT_PUBLIC_.*(?:SERVICE_ROLE|SECRET|ABUSE_HMAC)/.test(name)&&env[name])) fail('Server credential assigned to a public variable.');
if(env.NEXT_PUBLIC_SUPABASE_URL!=='https://lndvnufmbuzdbinapvze.supabase.co') fail('TEST URL missing or incorrect. No server started.');
for(const [name,value] of Object.entries(env)) {
  if(/SUPABASE|DATABASE|POSTGRES|^PG(?:HOST|USER|DATABASE|SERVICE)$/i.test(name) && value?.includes('fspszgqmwhwfoiitnerp')) fail('Production reference in effective connection settings.');
}
if(Object.keys(env).some(name=>/^(?:DATABASE_URL|DIRECT_URL|POSTGRES_|PGHOST|PGSERVICE)/.test(name)&&env[name])) fail('Alternative PostgreSQL connection configured; review before starting.');
const publicKey=env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serverKey=env.SUPABASE_SERVICE_ROLE_KEY;
if(!publicKey||!serverKey) fail('Missing TEST publishable/server credentials. Configure .env.local privately.');
for(const [key,role,prefix] of [[publicKey,'anon','sb_publishable_'],[serverKey,'service_role','sb_secret_']]) {
  if(key.startsWith(prefix)) continue;
  try {
    const payload=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());
    if(payload.ref!=='lndvnufmbuzdbinapvze'||payload.role!==role) fail('Credential project/role mismatch.');
  } catch { fail('Unrecognized credential format.'); }
}
if(!env.RTW_ABUSE_HMAC_KEY||Buffer.byteLength(env.RTW_ABUSE_HMAC_KEY)<32) fail('Missing valid server-only RTW_ABUSE_HMAC_KEY. OTP fails closed.');
if(env.TURNSTILE_ENFORCEMENT_ENABLED!=='true'&&env.TURNSTILE_ENFORCEMENT_ENABLED!=='false') fail('Set Turnstile enforcement explicitly; do not infer it from another environment.');
if(env.TURNSTILE_ENFORCEMENT_ENABLED==='true') {
  if(!env.TURNSTILE_SECRET_KEY||!env.NEXT_PUBLIC_TURNSTILE_SITE_KEY||!env.TURNSTILE_ALLOWED_HOSTNAMES?.split(',').map(x=>x.trim()).includes('localhost')||!env.TURNSTILE_ENABLED_ACTIONS?.split(',').map(x=>x.trim()).includes('otp_request')) fail('Turnstile enabled but local host/action configuration incomplete. Do not disable it to bypass failure.');
}
// Read-only Auth settings checks authenticate both keys against the TEST URL.
// Never print response bodies (especially the admin user listing).
for(const [key,path] of [[publicKey,'/auth/v1/settings'],[serverKey,'/auth/v1/admin/users?page=1&per_page=1']]) {
  let response;
  try { response=await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}${path}`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)}); }
  catch { fail('TEST credential check unavailable. No server started; no emails sent.'); }
  if(!response.ok) fail(`TEST credential check rejected (HTTP ${response.status}).`);
  await response.body?.cancel();
}
console.log(`Verified TEST credentials; branch ${git('branch','--show-current')}; commit ${git('rev-parse','--short','HEAD')}; Turnstile ${env.TURNSTILE_ENFORCEMENT_ENABLED==='true'?'enabled':'explicitly disabled'}; official URL http://localhost:3000.`);
if(mode==='start') {
  await new Promise(resolvePort=>{
    const probe=net.createServer();
    probe.once('error',()=>{
      try { execFileSync('powershell.exe',['-NoProfile','-File',resolve(root,'scripts/check-local-server.ps1')],{cwd:root,stdio:'inherit'}); } catch { console.error('Unable to confirm port owner; inspect manually before stopping anything.'); }
      fail('Port 3000 occupied/unavailable. No fallback and no process killed.');
    });
    probe.listen({port:3000,host:'::',exclusive:true},()=>probe.close(resolvePort));
  });
  const require=createRequire(import.meta.url);
  const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3000'],{cwd:root,env,stdio:'inherit'});
  child.once('error',()=>fail('Unable to start Next.'));
  child.once('exit',code=>{process.exitCode=code??1;});
}
