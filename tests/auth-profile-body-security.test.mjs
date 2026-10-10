import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);

async function loadBoundedBody() {
  const source = await readFile(new URL("lib/competition/request-body.ts", root), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiledModule = { exports: {} };
  new Function("exports", "module", "require", output)(compiledModule.exports, compiledModule, (name) => {
    if (name === "server-only") return {};
    throw new Error(`Unexpected module: ${name}`);
  });
  return compiledModule.exports;
}

async function loadRoute(path, mocks) {
  const source = await readFile(new URL(path, root), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiledModule = { exports: {} };
  new Function("exports", "module", "require", "process", output)(compiledModule.exports, compiledModule, (name) => {
    if (!(name in mocks)) throw new Error(`Unexpected module: ${name}`);
    return mocks[name];
  }, { env: {} });
  return compiledModule.exports;
}

function responseFactory(body, init = {}) {
  return { body, status: init.status ?? 200, cookies: { set() {} } };
}

function streamedRequest(payload) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(payload);
      controller.close();
    },
  });
  return new Request("https://example.test/mutation", { method: "POST", body: stream, duplex: "half" });
}

test("oversized or malformed Auth/Profile bodies fail before their sensitive provider or profile operations", async () => {
  const { readBoundedJson, COMPETITION_MUTATION_BODY_LIMIT_BYTES } = await loadBoundedBody();
  const next = { NextResponse: { json: responseFactory } };
  const observability = { createSecurityRequestId: () => "server-request-id", logSecurityEvent() {} };
  const body = { readBoundedJson };
  const oversized = () => streamedRequest(new Uint8Array(COMPETITION_MUTATION_BODY_LIMIT_BYTES + 1));

  let requestCodeProviderCalls = 0;
  const requestCode = await loadRoute("app/api/auth/request-code/route.ts", {
    "next/server": next,
    "@/lib/supabase/server": { createClient: async () => { requestCodeProviderCalls += 1; return {}; }, isSupabaseConfigured: () => true },
    "@/lib/observability/security-event": observability,
    "@/lib/auth/post-auth-path": { safePostAuthPath: () => "/" },
    "@/lib/auth/otp-abuse": { consumeOtpAbuseLimit: async () => "allowed" },
    "@/lib/competition/request-body": body,
    "@/lib/security/turnstile": { verifyTurnstileToken: async () => ({ status: "unavailable", reason: "disabled" }) },
  });
  const requestCodeResponse = await requestCode.POST(oversized());
  assert.equal(requestCodeResponse.status, 202);
  assert.equal(requestCodeResponse.body.nextStep, false);
  assert.equal(requestCodeProviderCalls, 0);

  let verifyProviderCalls = 0;
  const verifyCode = await loadRoute("app/api/auth/verify-code/route.ts", {
    "@supabase/ssr": { createServerClient: () => { verifyProviderCalls += 1; return {}; } },
    "next/server": next,
    "@/lib/observability/security-event": observability,
    "@/lib/auth/post-auth-path": { safePostAuthPath: () => "/" },
    "@/lib/auth/otp-abuse": { consumeOtpAbuseLimit: async () => "allowed" },
    "@/lib/competition/request-body": body,
  });
  const verifyRequest = oversized();
  Object.defineProperty(verifyRequest, "cookies", { value: { get: () => ({ value: "test@example.test" }), getAll: () => [] } });
  const verifyResponse = await verifyCode.POST(verifyRequest);
  assert.equal(verifyResponse.status, 400);
  assert.equal(verifyProviderCalls, 0);

  let profileAccessCalls = 0;
  const profile = await loadRoute("app/api/profile/route.ts", {
    "next/server": next,
    "@/lib/supabase/server": { getVerifiedUserContext: async () => { profileAccessCalls += 1; return null; } },
    "@/lib/profile-validation": { EMAIL_PATTERN: /^.+$/, USERNAME_PATTERN: /^.+$/, normalizePayPalEmail: (value) => value, normalizeUsername: (value) => value },
    "@/lib/observability/security-event": observability,
    "@/lib/competition/request-body": body,
  });
  const profileResponse = await profile.PATCH(oversized());
  assert.equal(profileResponse.status, 400);
  assert.equal(profileAccessCalls, 0);
});
