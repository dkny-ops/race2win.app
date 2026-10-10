import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

async function loadRequestCodeRoute({ turnstileDecision, abuseDecision = "allowed", providerError = null, providerThrow = null } = {}) {
  const source = await read("app/api/auth/request-code/route.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls = { turnstile: 0, abuse: 0, auth: 0, logs: [] };
  const compiledModule = { exports: {} };
  new Function("exports", "module", "require", "process", output)(compiledModule.exports, compiledModule, (name) => {
    if (name === "next/server") return { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200, cookies: { set() {} } }) } };
    if (name === "@/lib/supabase/server") return {
      isSupabaseConfigured: () => true,
      createClient: async () => ({ auth: { signInWithOtp: async () => { calls.auth += 1; if (providerThrow) throw providerThrow; return { error: providerError }; } } }),
    };
    if (name === "@/lib/observability/security-event") return { createSecurityRequestId: () => "safe-request-id", logSecurityEvent: (event) => calls.logs.push(event) };
    if (name === "@/lib/auth/post-auth-path") return { safePostAuthPath: () => "/" };
    if (name === "@/lib/auth/otp-abuse") return { consumeOtpAbuseLimit: async () => { calls.abuse += 1; return abuseDecision; } };
    if (name === "@/lib/competition/request-body") return { readBoundedJson: async (request) => request.json() };
    if (name === "@/lib/security/turnstile") return { verifyTurnstileToken: async () => { calls.turnstile += 1; return turnstileDecision; } };
    throw new Error(`Unexpected module: ${name}`);
  }, { env: {} });
  return { POST: compiledModule.exports.POST, calls };
}

function request(token) {
  return new Request("https://example.test/api/auth/request-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "person@example.test", next: "/", turnstileToken: token }),
  });
}

test("disabled Turnstile retains the prior OTP request behavior", async () => {
  const { POST, calls } = await loadRequestCodeRoute({ turnstileDecision: { status: "unavailable", reason: "disabled" } });
  const response = await POST(request(undefined));
  assert.equal(response.status, 202);
  assert.equal(response.body.nextStep, true);
  assert.equal(calls.turnstile, 1);
  assert.equal(calls.abuse, 1);
  assert.equal(calls.auth, 1);
});

test("a valid Turnstile result is necessary when enabled but never bypasses OTP rate limits", async () => {
  const allowed = await loadRequestCodeRoute({ turnstileDecision: { status: "verified" } });
  const allowedResponse = await allowed.POST(request("opaque-token"));
  assert.equal(allowedResponse.body.nextStep, true);
  assert.equal(allowed.calls.abuse, 1);
  assert.equal(allowed.calls.auth, 1);

  const limited = await loadRequestCodeRoute({ turnstileDecision: { status: "verified" }, abuseDecision: "blocked" });
  const limitedResponse = await limited.POST(request("opaque-token"));
  assert.equal(limitedResponse.status, 202);
  assert.equal(limitedResponse.body.nextStep, false);
  assert.equal(limited.calls.abuse, 1);
  assert.equal(limited.calls.auth, 0);
});

test("OTP provider diagnostics distinguish a response, a provider throttle, and transport unavailability without logging private provider detail", async () => {
  const cases = [
    { providerError: { status: 400, message: "recipient@example.test provider detail" }, expected: "provider_rejected" },
    { providerError: { status: 429, message: "recipient@example.test provider detail" }, expected: "provider_rate_limited" },
    { providerError: { status: 500, message: "recipient@example.test provider detail" }, expected: "provider_unavailable" },
    { providerThrow: new TypeError("network failure for recipient@example.test"), expected: "provider_unavailable" },
  ];
  for (const testCase of cases) {
    const { POST, calls } = await loadRequestCodeRoute({ turnstileDecision: { status: "unavailable", reason: "disabled" }, ...testCase });
    const response = await POST(request(undefined));
    assert.equal(response.status, 202);
    assert.equal(response.body.nextStep, false);
    assert.equal(calls.auth, 1);
    assert.equal(calls.logs.at(-1)?.reason, testCase.expected);
    assert.doesNotMatch(JSON.stringify(calls.logs), /recipient@example\.test|provider detail|network failure/i);
  }
});

test("missing, invalid, reused, action-mismatched, hostname-mismatched, unavailable, or incomplete Turnstile states never call OTP Auth", async () => {
  const decisions = [
    { status: "rejected", reason: "missing_token" },
    { status: "rejected", reason: "provider_rejected" },
    { status: "rejected", reason: "expired_or_reused" },
    { status: "rejected", reason: "action_mismatch" },
    { status: "rejected", reason: "hostname_mismatch" },
    { status: "unavailable", reason: "provider_unavailable" },
    { status: "unavailable", reason: "missing_configuration" },
  ];
  for (const turnstileDecision of decisions) {
    const { POST, calls } = await loadRequestCodeRoute({ turnstileDecision });
    const response = await POST(request("opaque-token"));
    assert.equal(response.status, 202);
    assert.equal(response.body.nextStep, false);
    assert.equal(calls.abuse, 0);
    assert.equal(calls.auth, 0);
    assert.equal(calls.logs.length, 1);
    assert.doesNotMatch(JSON.stringify(calls.logs), /opaque-token|person@example\.test/i);
  }
});

test("the mobile form uses a public key only, a responsive widget, and a fixed OTP request action", async () => {
  const [form, page, widget, css, route] = await Promise.all([
    read("app/sign-in/sign-in-form.tsx"),
    read("app/sign-in/page.tsx"),
    read("app/sign-in/turnstile-widget.tsx"),
    read("app/globals.css"),
    read("app/api/auth/request-code/route.ts"),
  ]);
  assert.match(form, /turnstileToken: turnstileSiteKey \? turnstileToken : undefined/);
  assert.match(form, /Complete the verification challenge/);
  assert.match(form, /submitInFlightRef\.current/);
  assert.match(page, /getTurnstileRequestWidgetConfiguration\(\)/);
  assert.match(page, /turnstileSiteKey=\{turnstile\?\.siteKey\}/);
  assert.match(widget, /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(widget, /action: "otp_request"/);
  assert.match(widget, /size: "flexible"/);
  assert.match(widget, /"expired-callback": clearTokenAndReset/);
  assert.match(widget, /"error-callback": clearTokenAndReset/);
  assert.doesNotMatch(`${form}\n${widget}`, /TURNSTILE_SECRET_KEY|TURNSTILE_ENFORCEMENT_ENABLED|human=true|captchaPassed=true/);
  assert.match(css, /\.turnstile-widget\{[^}]*max-width:100%[^}]*\}/);
  assert.match(route, /verifyTurnstileToken\(turnstileToken, "otp_request"\)/);
});
