import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as crypto from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';

async function moduleAt(path, mocks, env = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiledModule = { exports: {} };
  new Function('exports', 'module', 'require', 'process', output)(compiledModule.exports, compiledModule, name => {
    if (!(name in mocks)) throw new Error(`Unexpected module ${name}`);
    return mocks[name];
  }, { env });
  return compiledModule.exports;
}

test('signed OTP admission binds email, timestamp, nonce and key, fails closed', async () => {
  const load = env => moduleAt('lib/auth/otp-challenge.ts', { 'server-only': {}, 'node:crypto': crypto }, env);
  const challenge = await load({ RTW_ABUSE_HMAC_KEY: 'a'.repeat(48) });
  const now = 1791663000000;
  const token = challenge.issueOtpChallenge('Alice@example.test', now);
  assert.equal(challenge.verifyOtpChallenge(' alice@example.test ', token, now), true);
  assert.equal(challenge.verifyOtpChallenge('other@example.test', token, now), false);
  assert.equal(challenge.verifyOtpChallenge('alice@example.test', token, now - 1), false);
  assert.equal(challenge.verifyOtpChallenge('alice@example.test', token, now + 600000), false);
  assert.equal(challenge.verifyOtpChallenge('alice@example.test', token.replace(/^./, '0'), now), false);
  assert.equal(challenge.verifyOtpChallenge('alice@example.test', undefined, now), false);
  assert.notEqual(challenge.issueOtpChallenge('alice@example.test', now), token);
  const rotated = await load({ RTW_ABUSE_HMAC_KEY: 'b'.repeat(48) });
  assert.equal(rotated.verifyOtpChallenge('alice@example.test', token, now), false);
  const missing = await load({});
  assert.equal(missing.issueOtpChallenge('alice@example.test', now), null);
  assert.equal(missing.verifyOtpChallenge('alice@example.test', token, now), false);
});

test('invalid OTP admission never consumes shared budget or calls Auth; valid admission still requires both', async () => {
  const env = { RTW_ABUSE_HMAC_KEY: 'c'.repeat(48), NEXT_PUBLIC_SUPABASE_URL: 'https://test.invalid', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test' };
  const helper = await moduleAt('lib/auth/otp-challenge.ts', { 'server-only': {}, 'node:crypto': crypto }, env);
  const email = 'owner@example.test';
  let budget = 0, auth = 0;
  const route = await moduleAt('app/api/auth/verify-code/route.ts', {
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200, cookies: { set() {} } }) } },
    '@supabase/ssr': { createServerClient: () => ({ auth: { verifyOtp: async () => { auth++; return { error: null }; } } }) },
    '@/lib/observability/security-event': { createSecurityRequestId: () => 'test', logSecurityEvent() {} },
    '@/lib/auth/post-auth-path': { safePostAuthPath: () => '/' },
    '@/lib/auth/otp-challenge': helper,
    '@/lib/auth/otp-abuse': { consumeOtpAbuseLimit: async () => { budget++; return 'allowed'; } },
    '@/lib/competition/request-body': { readBoundedJson: async () => ({ token: '123456' }) },
  }, env);
  const request = (challenge, recipient = email) => ({ cookies: { get: name => ({ value: name === 'rtw_otp_email' ? recipient : name === helper.OTP_CHALLENGE_COOKIE ? challenge : '/' }), getAll: () => [] } });
  const token = helper.issueOtpChallenge(email);
  for (const req of [request(undefined), request('malformed'), request(token, 'foreign@example.test')]) {
    assert.equal((await route.POST(req)).status, 400);
  }
  assert.equal(budget, 0); assert.equal(auth, 0);
  assert.equal((await route.POST(request(token))).status, 200);
  assert.equal(budget, 1); assert.equal(auth, 1);
});

test('real request issuance permits an incorrect then correct OTP retry and clears admission on success', async () => {
  const env = { RTW_ABUSE_HMAC_KEY: 'd'.repeat(48), NEXT_PUBLIC_SUPABASE_URL: 'https://test.invalid', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test' };
  const helper = await moduleAt('lib/auth/otp-challenge.ts', { 'server-only': {}, 'node:crypto': crypto }, env);
  const json = (body, init = {}) => ({ body, status: init.status ?? 200, written: [], cookies: { set(name,value,options) { response.written.push({name,value,options}); } } });
  // Each response captures its own cookie mutations.
  let response;
  const next = { NextResponse: { json: (body,init) => { response=json(body,init); return response; } } };
  const common = {
    'next/server': next,
    '@/lib/observability/security-event': { createSecurityRequestId: () => 'test',logSecurityEvent() {} },
    '@/lib/auth/post-auth-path': { safePostAuthPath: () => '/scores' },
    '@/lib/auth/otp-challenge': helper,
    '@/lib/auth/otp-abuse': { consumeOtpAbuseLimit: async () => 'allowed' },
  };
  const issuer = await moduleAt('app/api/auth/request-code/route.ts', {
    ...common,
    '@/lib/supabase/server': { isSupabaseConfigured: () => true,createClient: async () => ({ auth: { signInWithOtp: async () => ({error:null}) } }) },
    '@/lib/competition/request-body': { readBoundedJson: request => request.json() },
    '@/lib/security/turnstile': { verifyTurnstileToken: async () => ({status:'unavailable',reason:'disabled'}) },
  },env);
  const issued=await issuer.POST(new Request('http://localhost/request',{method:'POST',body:JSON.stringify({email:'Owner@Example.test'})}));
  assert.equal(issued.body.nextStep,true);
  const cookies=Object.fromEntries(issued.written.map(cookie=>[cookie.name,cookie.value]));
  const admission=issued.written.find(cookie=>cookie.name===helper.OTP_CHALLENGE_COOKIE);
  assert.equal(admission.options.httpOnly,true); assert.equal(admission.options.sameSite,'lax');
  assert.equal(helper.verifyOtpChallenge(cookies.rtw_otp_email,admission.value),true);
  let attempts=0;
  const verifier=await moduleAt('app/api/auth/verify-code/route.ts',{
    ...common,
    '@supabase/ssr': { createServerClient: () => ({ auth: { verifyOtp: async ({email}) => { assert.equal(email,'owner@example.test'); return {error:++attempts===1?{message:'incorrect'}:null}; } } }) },
    '@/lib/competition/request-body': { readBoundedJson: async () => ({token:'123456'}) },
  },env);
  const req={cookies:{get:name=>({value:cookies[name]}),getAll:()=>[]}};
  const incorrect=await verifier.POST(req);
  assert.equal(incorrect.status,400); assert.equal(incorrect.written.length,0);
  const correct=await verifier.POST(req);
  assert.equal(correct.status,200);
  assert.ok(correct.written.some(cookie=>cookie.name===helper.OTP_CHALLENGE_COOKIE && cookie.value==='' && cookie.options.maxAge===0));
});
