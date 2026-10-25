import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
async function compile(path, mocks, env = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} };
  new Function("exports", "module", "require", "process", output)(compiled.exports, compiled, (name) => {
    if (name === "server-only") return {};
    if (name === "node:crypto") return require(name);
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, { env });
  return compiled.exports;
}

test("shared OTP quota derives normalized, action-separated HMAC buckets without storing email or IP", async () => {
  const calls = [];
  const api = await compile("lib/auth/otp-abuse.ts", {
    "@/lib/supabase/admin": { isAdminConfigured: () => true, createAdminClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: true, error: null }; } }) },
  }, { RTW_ABUSE_HMAC_KEY: "test-secret-".repeat(4) });
  const a = api.deriveOtpAbuseBuckets("otp_request", " Player@Example.test ");
  const b = api.deriveOtpAbuseBuckets("otp_request", "player@example.test");
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, api.deriveOtpAbuseBuckets("otp_verify", "player@example.test"));
  assert.match(a.emailBucketHmac, /^[0-9a-f]{64}$/);
  assert.match(a.globalShardBucketHmac, /^[0-9a-f]{64}$/);
  assert.equal(await api.consumeOtpAbuseLimit("otp_request", "player@example.test"), "allowed");
  assert.equal(calls[0].name, "rtw_consume_pre_auth_otp_rate_limit");
  assert.doesNotMatch(JSON.stringify(calls), /player@|test-secret/);
});

test("quota rejects denied RPCs and fails closed on config, database and unexpected response failures", async () => {
  for (const [result, expected] of [[{ data: false }, "blocked"], [{ data: null }, "unavailable"], [{ data: true, error: {} }, "unavailable"], [new Error("database down"), "unavailable"]]) {
    const api = await compile("lib/auth/otp-abuse.ts", { "@/lib/supabase/admin": {
      isAdminConfigured: () => true, createAdminClient: () => ({ rpc: async () => { if (result instanceof Error) throw result; return result; } }),
    } }, { RTW_ABUSE_HMAC_KEY: "x".repeat(32) });
    assert.equal(await api.consumeOtpAbuseLimit("otp_request", "player@example.test"), expected);
  }
  const missing = await compile("lib/auth/otp-abuse.ts", { "@/lib/supabase/admin": {} }, {});
  assert.equal(await missing.consumeOtpAbuseLimit("otp_request", "player@example.test"), "unavailable");
});

test("OTP code verification cannot call Auth when its shared quota rejects or is unavailable", async () => {
  for (const decision of ["blocked", "unavailable", "allowed"]) {
    let authCalls = 0;
    const api = await compile("app/api/auth/verify-code/route.ts", {
      "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200, cookies: { set() {} } }) } },
      "@supabase/ssr": { createServerClient: () => ({ auth: { verifyOtp: async () => { authCalls++; return { error: null }; } } }) },
      "@/lib/observability/security-event": { createSecurityRequestId: () => "id", logSecurityEvent() {} },
      "@/lib/auth/post-auth-path": { safePostAuthPath: () => "/" },
      "@/lib/competition/request-body": { readBoundedJson: async () => ({ token: "123456" }) },
      "@/lib/auth/otp-abuse": { consumeOtpAbuseLimit: async (action, email) => { assert.equal(action, "otp_verify"); assert.equal(email, "player@example.test"); return decision; } },
    }, { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-test" });
    const response = await api.POST({ cookies: { get: () => ({ value: "player@example.test" }) } });
    assert.equal(authCalls, decision === "allowed" ? 1 : 0);
    assert.equal(response.status, decision === "allowed" ? 200 : decision === "blocked" ? 429 : 503);
  }
});
