import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

async function loadTurnstile(env) {
  const source = await read("lib/security/turnstile.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("exports", "module", "require", "process", output)(compiledModule.exports, compiledModule, (name) => {
    if (name === "server-only") return {};
    throw new Error(`Unexpected module: ${name}`);
  }, { env });
  return compiledModule.exports;
}

function enabledEnv(overrides = {}) {
  return {
    TURNSTILE_ENFORCEMENT_ENABLED: "true",
    TURNSTILE_SECRET_KEY: "s".repeat(32),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "public-site-key",
    TURNSTILE_ALLOWED_HOSTNAMES: "www.racetowin.app,preview.racetowin.app",
    TURNSTILE_ENABLED_ACTIONS: "otp_request,otp_verify_step_up,prize_claim,balance_claim",
    ...overrides,
  };
}

function providerResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Turnstile accepts only a provider-verified token for its configured action and hostname", async () => {
  const { verifyTurnstileToken } = await loadTurnstile(enabledEnv());
  let request;
  const result = await verifyTurnstileToken("opaque-token", "otp_request", {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return providerResponse({ success: true, action: "otp_request", hostname: "www.racetowin.app" });
    },
  });
  assert.deepEqual(result, { status: "verified" });
  assert.equal(request.url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.cache, "no-store");
  assert.match(request.init.body.toString(), /secret=/);
  assert.match(request.init.body.toString(), /response=opaque-token/);
  assert.doesNotMatch(request.init.body.toString(), /remoteip=/);
});

test("Turnstile rejects missing, oversized, provider-invalid, expired, and reused tokens without logging or storage", async () => {
  const { verifyTurnstileToken } = await loadTurnstile(enabledEnv());
  assert.deepEqual(await verifyTurnstileToken(undefined, "otp_request"), { status: "rejected", reason: "missing_token" });
  assert.deepEqual(await verifyTurnstileToken("x".repeat(2049), "otp_request"), { status: "rejected", reason: "invalid_token" });
  assert.deepEqual(await verifyTurnstileToken("invalid", "otp_request", { fetchImpl: async () => providerResponse({ success: false, "error-codes": ["invalid-input-response"] }) }), { status: "rejected", reason: "provider_rejected" });
  assert.deepEqual(await verifyTurnstileToken("reused", "otp_request", { fetchImpl: async () => providerResponse({ success: false, "error-codes": ["timeout-or-duplicate"] }) }), { status: "rejected", reason: "expired_or_reused" });
});

test("a provider token cannot be reused after Siteverify reports it consumed", async () => {
  const { verifyTurnstileToken } = await loadTurnstile(enabledEnv());
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1
      ? providerResponse({ success: true, action: "otp_request", hostname: "www.racetowin.app" })
      : providerResponse({ success: false, "error-codes": ["timeout-or-duplicate"] });
  };
  assert.deepEqual(await verifyTurnstileToken("single-use-token", "otp_request", { fetchImpl }), { status: "verified" });
  assert.deepEqual(await verifyTurnstileToken("single-use-token", "otp_request", { fetchImpl }), { status: "rejected", reason: "expired_or_reused" });
});

test("Turnstile rejects incorrect action or hostname even when the provider says success", async () => {
  const { verifyTurnstileToken } = await loadTurnstile(enabledEnv());
  assert.deepEqual(await verifyTurnstileToken("token", "otp_request", { fetchImpl: async () => providerResponse({ success: true, action: "prize_claim", hostname: "www.racetowin.app" }) }), { status: "rejected", reason: "action_mismatch" });
  assert.deepEqual(await verifyTurnstileToken("token", "otp_request", { fetchImpl: async () => providerResponse({ success: true, action: "otp_request", hostname: "attacker.example" }) }), { status: "rejected", reason: "hostname_mismatch" });
});

test("Turnstile fails closed when disabled, configured incompletely, malformed, timed out, or unavailable", async () => {
  const disabled = await loadTurnstile({});
  assert.deepEqual(await disabled.verifyTurnstileToken("token", "otp_request"), { status: "unavailable", reason: "disabled" });

  const missingSecret = await loadTurnstile(enabledEnv({ TURNSTILE_SECRET_KEY: "" }));
  assert.deepEqual(await missingSecret.verifyTurnstileToken("token", "otp_request"), { status: "unavailable", reason: "missing_configuration" });

  const missingPublicKey = await loadTurnstile(enabledEnv({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "" }));
  assert.equal(missingPublicKey.getTurnstileRequestWidgetConfiguration(), null);
  assert.deepEqual(await missingPublicKey.verifyTurnstileToken("token", "otp_request"), { status: "unavailable", reason: "missing_configuration" });

  const malformed = await loadTurnstile(enabledEnv());
  assert.deepEqual(await malformed.verifyTurnstileToken("token", "otp_request", { fetchImpl: async () => providerResponse({ action: "otp_request" }) }), { status: "unavailable", reason: "provider_unavailable" });
  assert.deepEqual(await malformed.verifyTurnstileToken("token", "otp_request", { fetchImpl: async () => { throw new Error("network"); } }), { status: "unavailable", reason: "provider_unavailable" });
  assert.deepEqual(await malformed.verifyTurnstileToken("token", "otp_request", { fetchImpl: async (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError")))) , timeoutMs: 1 }), { status: "unavailable", reason: "provider_unavailable" });
});

test("the sign-in widget configuration and server enforcement share one complete server-side activation decision", async () => {
  const enabled = await loadTurnstile(enabledEnv());
  assert.deepEqual(enabled.getTurnstileRequestWidgetConfiguration(), { siteKey: "public-site-key" });
  const disabled = await loadTurnstile(enabledEnv({ TURNSTILE_ENFORCEMENT_ENABLED: "false" }));
  assert.equal(disabled.getTurnstileRequestWidgetConfiguration(), null);
  assert.deepEqual(await disabled.verifyTurnstileToken("token", "otp_request"), { status: "unavailable", reason: "disabled" });
});

test("Turnstile stays server-only, does not expose secrets, and has no competitive or financial authority", async () => {
  const source = await read("lib/security/turnstile.ts");
  const protectedCompetitionRoutes = await Promise.all([
    read("app/api/game-sessions/start/route.ts"),
    read("app/api/game-sessions/checkpoint/route.ts"),
    read("app/api/game-sessions/finalize/route.ts"),
    read("app/api/prizes/claim/route.ts"),
    read("app/api/prizes/balance-claim/route.ts"),
    read("app/api/prizes/claimable/route.ts"),
  ]);
  assert.match(source, /import "server-only"/);
  assert.match(source, /TURNSTILE_SECRET_KEY/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_TURNSTILE_SECRET|console\.|logSecurityEvent|@\/lib\/supabase|createAdminClient|\.rpc\(/);
  assert.doesNotMatch(source, /remoteip\s*:/);
  assert.doesNotMatch(protectedCompetitionRoutes.join("\n"), /verifyTurnstileToken|TURNSTILE_/);
});
