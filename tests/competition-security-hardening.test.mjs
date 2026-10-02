import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const migration = await readFile(new URL("supabase/migrations/20260907000100_create_competition_foundation.sql", root), "utf8");
const balanceLedgerFix = await readFile(new URL("supabase/migrations/20260908000100_fix_prize_balance_ledger_debits.sql", root), "utf8");
const sharePrizePoolFix = await readFile(new URL("supabase/migrations/20260908000200_reconcile_weekly_share_prize_pool.sql", root), "utf8");
const forwardCompetitionHardening = await readFile(new URL("supabase/migrations/20260908000300_forward_competition_foundation_hardening.sql", root), "utf8");
const awardGenerationRlsHardening = await readFile(new URL("supabase/migrations/20260915000100_enable_competition_award_generations_rls.sql", root), "utf8");

async function loadRequestBodyHelpers() {
  const source = await readFile(new URL("lib/competition/request-body.ts", root), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("exports", "module", "require", output)(compiledModule.exports, compiledModule, (name) => {
    if (name === "server-only") return {};
    throw new Error("Unexpected module: " + name);
  });
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
  assert.equal(
    await readBoundedJson(requestFromChunks([encoder.encode("{}")], { "content-length": String(COMPETITION_MUTATION_BODY_LIMIT_BYTES + 1) })),
    null,
  );
  assert.equal(
    await readBoundedJson(requestFromChunks([encoder.encode("{}")], { "content-length": "999999999999999999999999999" })),
    null,
  );
  const exactBody = `{"value":"${"x".repeat(COMPETITION_MUTATION_BODY_LIMIT_BYTES - encoder.encode('{"value":""}').byteLength)}"}`;
  assert.equal(encoder.encode(exactBody).byteLength, COMPETITION_MUTATION_BODY_LIMIT_BYTES);
  assert.deepEqual(await readBoundedJson(requestFromChunks([encoder.encode(exactBody)])), { value: "x".repeat(COMPETITION_MUTATION_BODY_LIMIT_BYTES - encoder.encode('{"value":""}').byteLength) });
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

test("negative ledger events debit an existing balance without a transient negative insert", () => {
  assert.match(balanceLedgerFix, /create or replace function private\.apply_prize_ledger_entry\(\)/);
  assert.match(balanceLedgerFix, /where new\.amount_cents > 0/);
  assert.match(balanceLedgerFix, /available_cents \+ new\.amount_cents >= 0/);
  assert.match(balanceLedgerFix, /Ledger debit exceeds the available prize balance/);
  assert.doesNotMatch(balanceLedgerFix, /on conflict \(player_id\) do update[\s\S]*excluded\.available_cents/i);
});

test("Share prize reconciliation uses one versioned canonical pool and fails closed balance writes", () => {
  assert.match(sharePrizePoolFix, /allocation_revision integer not null default 1/);
  assert.match(sharePrizePoolFix, /allocation_status in \('allocated', 'requires_manual_allocation', 'superseded'\)/);
  assert.match(sharePrizePoolFix, /provisional_winners_one_active_share_allocation_idx/);
  assert.match(sharePrizePoolFix, /guard_weekly_share_prize_pool/);
  assert.match(sharePrizePoolFix, /Weekly Share prize allocation exceeds the fixed pool/);
  assert.match(sharePrizePoolFix, /reconcile_weekly_share_prize_pool/);
  assert.match(sharePrizePoolFix, /nullif\(v_winner_count, 0\)/);
  assert.match(sharePrizePoolFix, /app\.rtw_share_prize_reconcile/);
  assert.match(sharePrizePoolFix, /reverse_provisional_winner_credit/);
  assert.match(sharePrizePoolFix, /release_unsettled_payout_holds/);
  assert.match(sharePrizePoolFix, /payout\.status = 'paid'/);
  assert.match(sharePrizePoolFix, /current_setting\('app\.rtw_ledger_write', true\) is distinct from 'on'/);
  assert.match(sharePrizePoolFix, /Confirmed Share competition week is immutable/);
  assert.doesNotMatch(sharePrizePoolFix, /weekly_shares[\s\S]{0,900}on conflict \(game_id, tournament_week_start, award_type, player_id\) do nothing/i);
});

test("forward-only hardening preserves Share-week isolation and least-privilege trigger writes", () => {
  assert.match(forwardCompetitionHardening, /create or replace function private\.refresh_referral_qualification/);
  assert.match(forwardCompetitionHardening, /group by private\.week_start_for_date\(qualification_day\)/);
  assert.match(forwardCompetitionHardening, /confirmed_tournament_week_start/);
  assert.match(forwardCompetitionHardening, /private\.refresh_competition_week\(uuid, date\)/);
  assert.match(forwardCompetitionHardening, /grant insert, delete on public\.daily_top_scores to service_role/);
  assert.match(forwardCompetitionHardening, /grant select \(id, email_confirmed_at\) on auth\.users to service_role/);
  assert.match(forwardCompetitionHardening, /revoke all on function private\.refresh_referral_qualification\(uuid\) from public, anon, authenticated/);
});

test("award-generation idempotency ledger is RLS-protected without browser policies", () => {
  assert.match(awardGenerationRlsHardening, /alter table private\.competition_award_generations enable row level security/i);
  assert.doesNotMatch(awardGenerationRlsHardening, /create policy/i);
  assert.doesNotMatch(awardGenerationRlsHardening, /grant\s+.+\s+to\s+(anon|authenticated|public)/i);
});

test("competition forward migrations follow the immutable historical foundation", async () => {
  const migrationFiles = (await readdir(new URL("supabase/migrations/", root)))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const requiredChain = [
    "20260904000100_create_profiles.sql",
    "20260905000100_create_authoritative_game_sessions.sql",
    "20260907000100_create_competition_foundation.sql",
    "20260908000100_fix_prize_balance_ledger_debits.sql",
    "20260908000200_reconcile_weekly_share_prize_pool.sql",
    "20260908000300_forward_competition_foundation_hardening.sql",
  ];
  for (const migrationFile of requiredChain) assert.ok(migrationFiles.includes(migrationFile));
  const indexes = requiredChain.map((migrationFile) => migrationFiles.indexOf(migrationFile));
  assert.ok(indexes.every((index, position) => position === 0 || index > indexes[position - 1]));
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

test("Auth and profile mutation routes use the shared streamed parser before sensitive providers or profile access", async () => {
  const [requestCode, verifyCode, profile] = await Promise.all([
    readFile(new URL("app/api/auth/request-code/route.ts", root), "utf8"),
    readFile(new URL("app/api/auth/verify-code/route.ts", root), "utf8"),
    readFile(new URL("app/api/profile/route.ts", root), "utf8"),
  ]);
  for (const route of [requestCode, verifyCode, profile]) {
    assert.match(route, /@\/lib\/competition\/request-body/);
    assert.match(route, /readBoundedJson\(request\)/);
    assert.doesNotMatch(route, /request\.json\(/);
  }
  assert.ok(requestCode.indexOf("readBoundedJson(request)") < requestCode.indexOf("signInWithOtp"));
  assert.ok(verifyCode.indexOf("readBoundedJson(request)") < verifyCode.indexOf("verifyOtp"));
  const profilePatch = profile.slice(profile.indexOf("export async function PATCH"));
  assert.ok(profilePatch.indexOf("readBoundedJson(request)") < profilePatch.indexOf("const context = await readOrCreateProfile()"));
  assert.match(requestCode, /If this email can receive a sign-in code, check your inbox shortly\./);
  assert.match(verifyCode, /That code is invalid or expired\. Request a new code and try again\./);
  assert.doesNotMatch(`${requestCode}\n${verifyCode}\n${profile}`, /console\.(?:log|warn|error)\([^\n]*(?:email|token|otp|paypal|cookie)/i);
});
