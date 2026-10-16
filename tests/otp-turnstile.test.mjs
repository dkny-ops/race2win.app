import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

async function loadRoute(turnstileDecision) {
  const source = await read("app/api/auth/request-code/route.ts");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = { auth: [], verified: 0 };
  const compiledModule = { exports: {} };
  new Function("exports", "module", "require", output)(compiledModule.exports, compiledModule, (name) => {
    if (name === "next/server") return { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200, cookies: { set() {} } }) } };
    if (name === "@/lib/supabase/server") return { isSupabaseConfigured: () => true, createClient: async () => ({ auth: { signInWithOtp: async (arguments_) => { calls.auth.push(arguments_); return { error: null }; } } }) };
    if (name === "@/lib/observability/security-event") return { createSecurityRequestId: () => "server-request-id", logSecurityEvent() {} };
    if (name === "@/lib/auth/post-auth-path") return { safePostAuthPath: () => "/" };
    if (name === "@/lib/competition/request-body") return { readBoundedJson: async (request) => request.json() };
    if (name === "@/lib/security/turnstile") return { verifyTurnstileToken: async () => { calls.verified += 1; return turnstileDecision; } };
    throw new Error(`Unexpected dependency: ${name}`);
  });
  return { POST: compiledModule.exports.POST, calls };
}

function request(body) {
  return new Request("https://race2win.test/api/auth/request-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "player@example.test", ...body }) });
}

test("a verified Race To Win token requires a distinct token for Supabase Auth", async () => {
  const { POST, calls } = await loadRoute({ status: "verified" });
  const response = await POST(request({ turnstileToken: "app-token", supabaseCaptchaToken: "auth-token" }));
  assert.equal(response.body.nextStep, true);
  assert.equal(calls.verified, 1);
  assert.equal(calls.auth.length, 1);
  assert.equal(calls.auth[0].options.captchaToken, "auth-token");
  assert.notEqual(calls.auth[0].options.captchaToken, "app-token");
});

test("missing, reused, or rejected Turnstile tokens never invoke Supabase Auth", async () => {
  for (const body of [
    { turnstileToken: "app-token" },
    { turnstileToken: "same-token", supabaseCaptchaToken: "same-token" },
  ]) {
    const { POST, calls } = await loadRoute({ status: "verified" });
    const response = await POST(request(body));
    assert.equal(response.body.nextStep, false);
    assert.equal(calls.auth.length, 0);
  }
  const { POST, calls } = await loadRoute({ status: "rejected", reason: "expired_or_reused" });
  const response = await POST(request({ turnstileToken: "reused", supabaseCaptchaToken: "fresh" }));
  assert.equal(response.body.nextStep, false);
  assert.equal(calls.auth.length, 0);

  const invalid = await loadRoute({ status: "rejected", reason: "provider_rejected" });
  const invalidResponse = await invalid.POST(request({ turnstileToken: "invalid", supabaseCaptchaToken: "fresh" }));
  assert.equal(invalidResponse.body.nextStep, false);
  assert.equal(invalid.calls.auth.length, 0);
});

test("Turnstile verifier rejects action, hostname, and provider reuse", async () => {
  const source = await read("lib/security/turnstile.ts");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiledModule = { exports: {} };
  new Function("exports", "module", "require", "process", output)(compiledModule.exports, compiledModule, (name) => name === "server-only" ? {} : (() => { throw new Error(name); })(), {
    env: { NODE_ENV: "production", TURNSTILE_ENFORCEMENT_ENABLED: "true", TURNSTILE_SECRET_KEY: "s".repeat(32), NEXT_PUBLIC_TURNSTILE_SITE_KEY: "public-key", TURNSTILE_ALLOWED_HOSTNAMES: "racetowin.app", TURNSTILE_ENABLED_ACTIONS: "otp_request" },
  });
  const respond = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  assert.deepEqual(await compiledModule.exports.verifyTurnstileToken("token", "otp_request", { fetchImpl: async () => respond({ success: true, action: "wrong", hostname: "racetowin.app" }) }), { status: "rejected", reason: "action_mismatch" });
  assert.deepEqual(await compiledModule.exports.verifyTurnstileToken("token", "otp_request", { fetchImpl: async () => respond({ success: true, action: "otp_request", hostname: "attacker.example" }) }), { status: "rejected", reason: "hostname_mismatch" });
  assert.deepEqual(await compiledModule.exports.verifyTurnstileToken("token", "otp_request", { fetchImpl: async () => respond({ success: false, "error-codes": ["timeout-or-duplicate"] }) }), { status: "rejected", reason: "expired_or_reused" });
});

test("the mobile form uses two responsive widgets and exposes no secret", async () => {
  const [form, widget, route, css] = await Promise.all([read("app/sign-in/sign-in-form.tsx"), read("app/sign-in/turnstile-widget.tsx"), read("app/api/auth/request-code/route.ts"), read("app/globals.css")]);
  assert.equal((form.match(/<TurnstileWidget\b/g) ?? []).length, 2);
  assert.match(form, /supabaseCaptchaToken/);
  assert.match(widget, /size: "flexible"/);
  assert.match(widget, /expired-callback/);
  assert.match(route, /captchaToken: supabaseCaptchaToken/);
  assert.doesNotMatch(`${form}\n${widget}`, /TURNSTILE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(css, /\.turnstile-widget\{[^}]*max-width:100%/);
});
