import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

async function loadRoute(turnstileDecision, signInResult = { error: null }, quota = "allowed") {
  const source = await read("app/api/auth/request-code/route.ts");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = { auth: [], events: [], verified: 0, quota: 0 };
  const compiledModule = { exports: {} };
  new Function("exports", "module", "require", output)(compiledModule.exports, compiledModule, (name) => {
    if (name === "next/server") return { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200, cookies: { set() {} } }) } };
    if (name === "@/lib/supabase/server") return { isSupabaseConfigured: () => true, createClient: async () => ({ auth: { signInWithOtp: async (arguments_) => { calls.auth.push(arguments_); return signInResult; } } }) };
    if (name === "@/lib/observability/security-event") return { createSecurityRequestId: () => "server-request-id", logSecurityEvent: (event) => calls.events.push(event) };
    if (name === "@/lib/auth/post-auth-path") return { safePostAuthPath: () => "/" };
    if (name === "@/lib/competition/request-body") return { readBoundedJson: async (request) => request.json() };
    if (name === "@/lib/security/turnstile") return { verifyAdaptiveTurnstileToken: async () => { calls.verified += 1; return turnstileDecision; } };
    if (name === "@/lib/auth/otp-abuse") return { consumeOtpAbuseLimit: async () => { calls.quota += 1; return quota; } };
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

test("OTP security events distinguish Siteverify rejection from Supabase Auth rejection without logging tokens", async () => {
  const siteverify = await loadRoute({ status: "rejected", reason: "hostname_mismatch" });
  await siteverify.POST(request({ turnstileToken: "app-token", supabaseCaptchaToken: "auth-token" }));
  assert.equal(siteverify.calls.events.at(-1).reason, "turnstile_hostname_mismatch");
  assert.doesNotMatch(JSON.stringify(siteverify.calls.events), /app-token|auth-token/);

  const supabase = await loadRoute({ status: "verified" }, { error: { message: "provider failure" } });
  await supabase.POST(request({ turnstileToken: "app-token", supabaseCaptchaToken: "auth-token" }));
  assert.equal(supabase.calls.events.at(-1).reason, "supabase_otp_rejected");
  assert.doesNotMatch(JSON.stringify(supabase.calls.events), /provider failure|app-token|auth-token/);
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

test("the local environment template includes the server-controlled midrun Turnstile switch", async () => {
  const template = await read(".env.example");
  for (const key of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    "TURNSTILE_SECRET_KEY",
    "TURNSTILE_ENFORCEMENT_ENABLED",
    "TURNSTILE_MIDRUN_ENABLED",
    "TURNSTILE_ALLOWED_HOSTNAMES",
    "TURNSTILE_ENABLED_ACTIONS",
    "NEXT_PUBLIC_TURNSTILE_ADAPTIVE_SITE_KEY",
    "TURNSTILE_ADAPTIVE_SECRET_KEY",
    "RTW_ABUSE_HMAC_KEY",
  ]) {
    assert.match(template, new RegExp(`^${key}=`, "m"));
  }
});

async function loadVerifier(overrides = {}, diagnosticLogs = []) {
  const source = await read("lib/security/turnstile.ts");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} };
  new Function("exports", "module", "require", "process", "console", output)(compiled.exports, compiled, () => ({}), { env: {
    NODE_ENV: "production", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "original-public", TURNSTILE_SECRET_KEY: "original-secret-".repeat(3),
    NEXT_PUBLIC_TURNSTILE_ADAPTIVE_SITE_KEY: "adaptive-public", TURNSTILE_ADAPTIVE_SECRET_KEY: "adaptive-secret-".repeat(3),
    TURNSTILE_ALLOWED_HOSTNAMES: "racetowin.app,www.racetowin.app", TURNSTILE_ENFORCEMENT_ENABLED: "true",
    TURNSTILE_ENABLED_ACTIONS: "otp_request,weekly_leader_verification", TURNSTILE_MIDRUN_ENABLED: "true", ...overrides,
  } }, { warn: (...args) => diagnosticLogs.push(args) });
  return compiled.exports;
}

const success = { success: true, action: "otp_request", hostname: "www.racetowin.app" };
const provider = (body) => async () => new Response(JSON.stringify(body));

test("Managed uses its separate secret, action and public key; legacy disable switches cannot bypass OTP", async () => {
  const api = await loadVerifier({ TURNSTILE_ENFORCEMENT_ENABLED: "false", TURNSTILE_ENABLED_ACTIONS: "" });
  assert.deepEqual(api.getAdaptiveTurnstileRequestWidgetConfiguration(), { siteKey: "adaptive-public", supabaseSiteKey: "original-public" });
  const result = await api.verifyAdaptiveTurnstileToken("fresh", { fetchImpl: async (url, options) => {
    assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.equal(options.body.get("secret"), "adaptive-secret-".repeat(3));
    assert.equal(options.body.get("response"), "fresh");
    assert.equal(options.cache, "no-store");
    return new Response(JSON.stringify(success));
  } });
  assert.deepEqual(result, { status: "verified" });
  assert.deepEqual(await api.verifyAdaptiveTurnstileToken(undefined), { status: "rejected", reason: "missing_token" });
});

test("Managed rejects invalid, expired/reused, wrong-host and wrong-action tokens", async () => {
  const api = await loadVerifier();
  for (const [response, reason] of [
    [{ success: false, "error-codes": ["invalid-input-response"] }, "provider_rejected"],
    [{ success: false, "error-codes": ["timeout-or-duplicate"] }, "expired_or_reused"],
    [{ ...success, hostname: "attacker.example" }, "hostname_mismatch"],
    [{ ...success, action: "midrun_human_check" }, "action_mismatch"],
    [{ ...success, hostname: undefined }, "hostname_mismatch"],
    [{ ...success, action: undefined }, "action_mismatch"],
  ]) assert.deepEqual(await api.verifyAdaptiveTurnstileToken("token", { fetchImpl: provider(response) }), { status: "rejected", reason });
  let calls = 0;
  const seen = new Set();
  const singleUse = async (_url, options) => {
    calls++;
    const token = options.body.get("response");
    if (seen.has(token)) return new Response(JSON.stringify({ success: false, "error-codes": ["timeout-or-duplicate"] }));
    seen.add(token);
    return new Response(JSON.stringify(success));
  };
  assert.deepEqual(await api.verifyAdaptiveTurnstileToken("single-use", { fetchImpl: singleUse }), { status: "verified" });
  assert.deepEqual(await api.verifyAdaptiveTurnstileToken("single-use", { fetchImpl: singleUse }), { status: "rejected", reason: "expired_or_reused" });
  assert.equal(calls, 2, "No cached successful verification may authorize a replay");
  assert.deepEqual(await api.verifyAdaptiveTurnstileToken("x".repeat(2049)), { status: "rejected", reason: "invalid_token" });
});

test("Managed fails closed on missing configuration, timeout, HTTP failure and malformed provider responses", async () => {
  for (const overrides of [
    { TURNSTILE_ADAPTIVE_SECRET_KEY: "" }, { NEXT_PUBLIC_TURNSTILE_ADAPTIVE_SITE_KEY: "" },
    { NEXT_PUBLIC_TURNSTILE_ADAPTIVE_SITE_KEY: "original-public" }, { TURNSTILE_ALLOWED_HOSTNAMES: "*.racetowin.app" },
  ]) {
    const api = await loadVerifier(overrides);
    assert.equal(api.getAdaptiveTurnstileRequestWidgetConfiguration(), null);
    assert.deepEqual(await api.verifyAdaptiveTurnstileToken("token"), { status: "unavailable", reason: "missing_configuration" });
  }
  const api = await loadVerifier();
  for (const fetchImpl of [
    async () => { throw new Error("network failure"); },
    async () => new Response("down", { status: 503 }),
    async () => new Response("invalid JSON"), provider({ success: "true" }), provider(null),
    async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true })),
  ]) assert.deepEqual(await api.verifyAdaptiveTurnstileToken("token", { fetchImpl, timeoutMs: 5 }), { status: "unavailable", reason: "provider_unavailable" });
});

test("Managed diagnostics log only bounded failure metadata, never provider payloads or credentials", async () => {
  const logs = [];
  const api = await loadVerifier({}, logs);
  await api.verifyAdaptiveTurnstileToken("private-token", { fetchImpl: async () => new Response(JSON.stringify({
    "error-codes": ["invalid-input-secret", "arbitrary-private-provider-message"], secret: "private-secret", token: "private-token",
  }), { status: 400 }) });
  assert.deepEqual(logs, [["adaptive_siteverify_unavailable", { stage: "http", status: 400, providerCodes: ["invalid-input-secret"] }]]);
  assert.doesNotMatch(JSON.stringify(logs), /private-token|private-secret|arbitrary-private-provider-message|adaptive-secret/);
});

test("OTP never calls Auth on Siteverify failure, legacy disabled decisions, missing second token or quota failure", async () => {
  for (const decision of [
    { status: "unavailable", reason: "provider_unavailable" }, { status: "unavailable", reason: "missing_configuration" },
    { status: "unavailable", reason: "disabled" }, { status: "rejected", reason: "missing_token" },
  ]) {
    const route = await loadRoute(decision);
    const response = await route.POST(request({ turnstileToken: "fresh", supabaseCaptchaToken: "independent" }));
    assert.equal(response.body.nextStep, false);
    assert.equal(route.calls.auth.length, 0);
    assert.equal(route.calls.quota, 0);
  }
  for (const quota of ["blocked", "unavailable"]) {
    const route = await loadRoute({ status: "verified" }, { error: null }, quota);
    const response = await route.POST(request({ turnstileToken: "fresh", supabaseCaptchaToken: "independent" }));
    assert.equal(response.status, quota === "blocked" ? 429 : 503);
    assert.equal(route.calls.auth.length, 0);
  }
});

test("legacy midrun and leaderboard still use original credentials and original enforcement behavior", async () => {
  const api = await loadVerifier();
  for (const action of ["midrun_human_check", "weekly_leader_verification"]) {
    assert.deepEqual(api.getTurnstileWidgetConfiguration(action), { siteKey: "original-public" });
    assert.deepEqual(await api.verifyTurnstileToken("legacy-token", action, { fetchImpl: async (_url, options) => {
      assert.equal(options.body.get("secret"), "original-secret-".repeat(3));
      return new Response(JSON.stringify({ ...success, action }));
    } }), { status: "verified" });
  }
  const disabled = await loadVerifier({ TURNSTILE_ENFORCEMENT_ENABLED: "false" });
  assert.equal(disabled.getTurnstileWidgetConfiguration("midrun_human_check"), null);
  assert.deepEqual(await disabled.verifyTurnstileToken("token", "midrun_human_check"), { status: "unavailable", reason: "disabled" });
  const midrun = await read("components/game/race-to-win/midrun-human-check.tsx");
  assert.match(midrun, /size: "invisible", execution: "execute"/);
  assert.doesNotMatch(midrun, /ADAPTIVE|adaptiveSiteKey/);
  assert.match(await read("app/sign-in/sign-in-form.tsx"), /siteKey=\{adaptiveSiteKey\} adaptive/);
});
