import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const loggerPath = new URL("../lib/observability/security-event.ts", import.meta.url);
const source = await readFile(loggerPath, "utf8");

async function loadLoggerForTest() {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText.replace('import "server-only";\n', "");
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("security-event logger is server-only and serializes only its allowlist", async () => {
  assert.match(source, /import "server-only";/);
  const { formatSecurityEvent } = await loadLoggerForTest();
  const sensitiveValues = {
    email: "private@example.test",
    otp: "123456",
    accessToken: "access-token-value",
    refreshToken: "refresh-token-value",
    cookie: "session-cookie-value",
    authorization: "Bearer secret-value",
    paypalEmail: "payout@example.test",
    whatsapp: "+15551234567",
    apiKey: "api-key-value",
  };

  const record = formatSecurityEvent({
    eventType: "game_session.anti_cheat_rejected",
    route: "/api/game-sessions/finalize",
    requestId: "server-generated-request-id",
    reason: "replay_rejected",
    status: 409,
    ...sensitiveValues,
  });
  const parsed = JSON.parse(record);

  assert.deepEqual(Object.keys(parsed).sort(), ["eventType", "reason", "requestId", "route", "status", "timestamp"]);
  for (const value of Object.values(sensitiveValues)) assert.doesNotMatch(record, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("security-event logger never forwards caller-supplied extra fields to console", async () => {
  const { logSecurityEvent } = await loadLoggerForTest();
  const warnings = [];
  const errors = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (value) => warnings.push(String(value));
  console.error = (value) => errors.push(String(value));
  try {
    logSecurityEvent({
      eventType: "balance_claim.rejected",
      route: "/api/prizes/balance-claim",
      requestId: "server-generated-request-id",
      reason: "rate_limited",
      status: 429,
      body: { amount: 999999, token: "do-not-log" },
      password: "do-not-log",
    });
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings[0], /do-not-log|999999/);
  assert.deepEqual(Object.keys(JSON.parse(warnings[0])).sort(), ["eventType", "reason", "requestId", "route", "status", "timestamp"]);
});

test("sensitive mutation routes use server-side security events", async () => {
  const routes = [
    ["../app/api/game-sessions/start/route.ts", "game_session.start"],
    ["../app/api/game-sessions/finalize/route.ts", "game_session.anti_cheat_rejected"],
    ["../app/api/referrals/attach/route.ts", "referral.attach"],
    ["../app/api/prizes/claim/route.ts", "prize.claim"],
    ["../app/api/prizes/balance-claim/route.ts", "payout_hold.operation_failed"],
  ];
  for (const [relativePath, eventName] of routes) {
    const route = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.match(route, /createSecurityRequestId/);
    assert.match(route, /logSecurityEvent/);
    assert.match(route, new RegExp(eventName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
