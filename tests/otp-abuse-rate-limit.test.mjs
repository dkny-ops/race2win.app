import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

async function loadOtpAbuse({ env, rpc = async () => ({ data: true, error: null }), configured = true } = {}) {
  const source = await read("lib/auth/otp-abuse.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("exports", "module", "require", "process", output)(compiledModule.exports, compiledModule, (name) => {
    if (name === "server-only") return {};
    if (name === "node:crypto") return awaitableCrypto;
    if (name === "@/lib/supabase/admin") return {
      isAdminConfigured: () => configured,
      createAdminClient: () => ({ rpc }),
    };
    throw new Error(`Unexpected module: ${name}`);
  }, { env: env ?? {} });
  return compiledModule.exports;
}

const awaitableCrypto = await import("node:crypto");

async function loadRoute(path, mocks) {
  const source = await read(path);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("exports", "module", "require", "process", output)(compiledModule.exports, compiledModule, (name) => {
    if (!(name in mocks)) throw new Error(`Unexpected module: ${name}`);
    return mocks[name];
  }, { env: { NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable" } });
  return compiledModule.exports;
}

function responseFactory(body, init = {}) {
  return { body, status: init.status ?? 200, cookies: { set() {} } };
}

test("OTP abuse buckets are opaque HMACs, action-separated, and fail closed without a valid key", async () => {
  const key = "a".repeat(48);
  const { deriveOtpAbuseBuckets, consumeOtpAbuseLimit } = await loadOtpAbuse({ env: { RTW_ABUSE_HMAC_KEY: key } });
  const requestBuckets = deriveOtpAbuseBuckets("otp_request", "Alice@Example.test");
  const normalizedBuckets = deriveOtpAbuseBuckets("otp_request", " alice@example.test ");
  const verifyBuckets = deriveOtpAbuseBuckets("otp_verify", "alice@example.test");
  assert.deepEqual(requestBuckets, normalizedBuckets);
  assert.match(requestBuckets.emailBucketHmac, /^[0-9a-f]{64}$/);
  assert.match(requestBuckets.globalShardBucketHmac, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(requestBuckets.emailBucketHmac, /alice|example/i);
  assert.notEqual(requestBuckets.emailBucketHmac, verifyBuckets.emailBucketHmac);
  assert.equal(await consumeOtpAbuseLimit("otp_request", "alice@example.test"), "allowed");

  const missingKey = await loadOtpAbuse({ env: {} });
  const shortKey = await loadOtpAbuse({ env: { RTW_ABUSE_HMAC_KEY: "short" } });
  assert.equal(missingKey.deriveOtpAbuseBuckets("otp_request", "alice@example.test"), null);
  assert.equal(await shortKey.consumeOtpAbuseLimit("otp_request", "alice@example.test"), "unavailable");
});

test("OTP limiter calls only its server RPC with HMAC buckets and fails closed on database errors", async () => {
  const calls = [];
  const { consumeOtpAbuseLimit } = await loadOtpAbuse({
    env: { RTW_ABUSE_HMAC_KEY: "b".repeat(48) },
    rpc: async (name, args) => { calls.push({ name, args }); return { data: false, error: null }; },
  });
  assert.equal(await consumeOtpAbuseLimit("otp_verify", "player@example.test"), "blocked");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "rtw_consume_pre_auth_otp_rate_limit");
  assert.equal(calls[0].args.p_action, "otp_verify");
  assert.match(calls[0].args.p_email_bucket_hmac, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(calls[0].args), /player@example\.test/);

  const unavailable = await loadOtpAbuse({
    env: { RTW_ABUSE_HMAC_KEY: "c".repeat(48) },
    rpc: async () => ({ data: null, error: { code: "08006" } }),
  });
  assert.equal(await unavailable.consumeOtpAbuseLimit("otp_request", "player@example.test"), "unavailable");
});

test("request and verify routes do not call Supabase Auth when abuse control blocks or fails", async () => {
  const next = { NextResponse: { json: responseFactory } };
  const observability = { createSecurityRequestId: () => "safe-id", logSecurityEvent() {} };
  const body = { readBoundedJson: async () => ({ email: "person@example.test", next: "/" }) };

  let requestProviderCalls = 0;
  const requestRoute = await loadRoute("app/api/auth/request-code/route.ts", {
    "next/server": next,
    "@/lib/supabase/server": { createClient: async () => { requestProviderCalls += 1; return {}; }, isSupabaseConfigured: () => true },
    "@/lib/observability/security-event": observability,
    "@/lib/auth/post-auth-path": { safePostAuthPath: () => "/" },
    "@/lib/auth/otp-abuse": { consumeOtpAbuseLimit: async () => "blocked" },
    "@/lib/competition/request-body": body,
    "@/lib/security/turnstile": { verifyTurnstileToken: async () => ({ status: "unavailable", reason: "disabled" }) },
  });
  const requestResponse = await requestRoute.POST(new Request("https://example.test/request", { method: "POST" }));
  assert.equal(requestResponse.status, 202);
  assert.equal(requestResponse.body.nextStep, false);
  assert.match(requestResponse.body.message, /If this email can receive/i);
  assert.equal(requestProviderCalls, 0);

  let verifyProviderCalls = 0;
  const verifyRoute = await loadRoute("app/api/auth/verify-code/route.ts", {
    "@supabase/ssr": { createServerClient: () => { verifyProviderCalls += 1; return {}; } },
    "next/server": next,
    "@/lib/observability/security-event": observability,
    "@/lib/auth/post-auth-path": { safePostAuthPath: () => "/" },
    "@/lib/auth/otp-abuse": { consumeOtpAbuseLimit: async () => "unavailable" },
    "@/lib/competition/request-body": { readBoundedJson: async () => ({ token: "123456" }) },
  });
  const verifyRequest = new Request("https://example.test/verify", { method: "POST" });
  Object.defineProperty(verifyRequest, "cookies", { value: { get: () => ({ value: "person@example.test" }), getAll: () => [] } });
  const verifyResponse = await verifyRoute.POST(verifyRequest);
  assert.equal(verifyResponse.status, 400);
  assert.match(verifyResponse.body.message, /invalid or expired/i);
  assert.equal(verifyProviderCalls, 0);
});

test("migration keeps pre-auth rate limiting private, atomic, bounded, and service-only", async () => {
  const migration = await read("supabase/migrations/20261002000100_add_pre_auth_otp_abuse_rate_limits.sql");
  assert.match(migration, /create table private\.pre_auth_otp_rate_limits/);
  assert.match(migration, /bucket_hmac text not null check \(bucket_hmac ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(migration, /alter table private\.pre_auth_otp_rate_limits enable row level security/);
  assert.match(migration, /revoke all on table private\.pre_auth_otp_rate_limits from public, anon, authenticated/);
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /on conflict \(action, scope, bucket_hmac\) do update/g);
  assert.match(migration, /limit 100/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /p_action is null/);
  assert.match(migration, /p_email_bucket_hmac is null/);
  assert.match(migration, /p_global_shard_bucket_hmac is null/);
  assert.match(migration, /alter function public\.rtw_consume_pre_auth_otp_rate_limit\(text, text, text\) owner to postgres/);
  assert.match(migration, /revoke all on function public\.rtw_consume_pre_auth_otp_rate_limit\(text, text, text\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.rtw_consume_pre_auth_otp_rate_limit\(text, text, text\) to service_role/);
  assert.doesNotMatch(migration, /grant execute[^\n]*to (anon|authenticated)/);
  assert.doesNotMatch(migration, /\n\s*(email|otp|ip_address|cookie)\s+(text|inet|jsonb)/i);
  const globalInsert = migration.indexOf("p_action, 'global_shard', p_global_shard_bucket_hmac");
  const emailInsert = migration.indexOf("p_action, 'email', p_email_bucket_hmac");
  assert.ok(globalInsert >= 0 && emailInsert > globalInsert, "global admission must occur before creating an email bucket");
  assert.match(migration, /set request_count = greatest\(bucket\.request_count - 1, 0\)/);
});

test("OTP routes preserve neutral public responses and never trust client rate counters", async () => {
  const [requestRoute, verifyRoute, abuse] = await Promise.all([
    read("app/api/auth/request-code/route.ts"),
    read("app/api/auth/verify-code/route.ts"),
    read("lib/auth/otp-abuse.ts"),
  ]);
  assert.match(requestRoute, /consumeOtpAbuseLimit\("otp_request", email\)/);
  assert.match(verifyRoute, /consumeOtpAbuseLimit\("otp_verify", email\)/);
  assert.match(requestRoute, /If this email can receive a sign-in code/);
  assert.match(verifyRoute, /That code is invalid or expired/);
  assert.doesNotMatch(`${requestRoute}\n${verifyRoute}`, /localStorage|x-forwarded-for|request\.headers\.get\([^)]*ip/i);
  assert.match(abuse, /createAdminClient\(\)\.rpc\("rtw_consume_pre_auth_otp_rate_limit"/);
});
