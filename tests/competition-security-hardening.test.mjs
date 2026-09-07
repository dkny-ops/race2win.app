import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const migration = await readFile(new URL("supabase/migrations/20260907000100_create_competition_foundation.sql", root), "utf8");

async function loadRequestBodyHelpers() {
  const source = await readFile(new URL("lib/competition/request-body.ts", root), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("exports", "module", output)(compiledModule.exports, compiledModule);
  return compiledModule.exports;
}

function requestFromChunks(chunks, headers = {}) {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Request("https://example.test/mutation", { method: "POST", headers, body: stream, duplex: "half" });
}

test("bounded mutation parsing handles missing metadata and rejects malformed or oversize streamed bodies", async () => {
  const { readBoundedJson, COMPETITION_MUTATION_BODY_LIMIT_BYTES } = await loadRequestBodyHelpers();
  const encoder = new TextEncoder();

  assert.deepEqual(
    await readBoundedJson(requestFromChunks([encoder.encode('{"code":"ABCDEFGH12"}')])),
    { code: "ABCDEFGH12" },
  );
  assert.equal(
    await readBoundedJson(requestFromChunks([encoder.encode("{}")], { "content-length": "not-a-number" })),
    null,
  );
  assert.equal(await readBoundedJson(requestFromChunks([encoder.encode("not-json")])), null);
  assert.equal(
    await readBoundedJson(requestFromChunks([new Uint8Array(COMPETITION_MUTATION_BODY_LIMIT_BYTES + 1)])),
    null,
  );
});

test("balance claims enforce their empty-body contract", async () => {
  const { hasEmptyBoundedBody } = await loadRequestBodyHelpers();
  assert.equal(await hasEmptyBoundedBody(new Request("https://example.test/balance", { method: "POST" })), true);
  assert.equal(await hasEmptyBoundedBody(requestFromChunks([new TextEncoder().encode("x")])), false);
});

test("database hardening covers graph serialization, referral cutoff, reversals, and shared quotas", async () => {
  assert.match(migration, /rtw:referral-graph/);
  assert.match(migration, /new\.attached_at := now\(\)/);
  assert.match(migration, /run\.completed_at >= v_referral\.attached_at/g);
  assert.match(migration, /entry_type in \('credit', 'credit_reversal', 'payout_hold'/);
  assert.match(migration, /reverses_ledger_entry_id/);
  assert.match(migration, /create function private\.reverse_provisional_winner_credit/);
  assert.match(migration, /create table private\.competition_action_rate_limits/);
  assert.match(migration, /create function public\.rtw_start_official_game_session/);
  assert.match(migration, /rtw:session-start:/);
  assert.match(migration, /rtw:competition:week:/);
  assert.match(migration, /if v_winner\.status = 'claim_started' then return true; end if;/);
});

test("new mutation routes use the bounded parser and database-backed rate gate", async () => {
  const routes = await Promise.all([
    "app/api/referrals/attach/route.ts",
    "app/api/prizes/claim/route.ts",
    "app/api/prizes/balance-claim/route.ts",
  ].map((path) => readFile(new URL(path, root), "utf8")));
  for (const route of routes) assert.doesNotMatch(route, /request\.json\(/);
  assert.match(routes[0], /readBoundedJson\(request\)/);
  assert.match(routes[1], /readBoundedJson\(request\)/);
  assert.match(routes[2], /hasEmptyBoundedBody\(request\)/);
  for (const route of routes) assert.match(route, /consumeCompetitionActionRateLimit/);

  const startRoute = await readFile(new URL("app/api/game-sessions/start/route.ts", root), "utf8");
  assert.match(startRoute, /rtw_start_official_game_session/);
  assert.doesNotMatch(startRoute, /\.from\("game_sessions"\)\s*\.insert/);
});
