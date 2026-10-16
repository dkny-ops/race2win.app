import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(resolve(root, "supabase/migrations/20261013175035_weekly_antifraud_review_gate.sql"), "utf8");
const finalize = readFileSync(resolve(root, "app/api/game-sessions/finalize/route.ts"), "utf8");
const styles = readFileSync(resolve(root, "app/globals.css"), "utf8");

test("under-review runs are materialized from server-selected disposition and excluded from weekly eligibility", () => {
  assert.match(migration, /new\.eligibility_status := case when v_session\.anti_fraud_status = 'under_review' then 'under_review' else 'valid' end/);
  assert.match(migration, /perform private\.refresh_competition_week/);
  assert.match(migration, /perform private\.refresh_referral_qualification/);
  assert.match(migration, /insert into public\.fraud_reviews/);
  assert.match(migration, /private\.game_session_antifraud_observations/);
  assert.match(migration, /p_antifraud_status not in \('verified', 'under_review'\)/);
  assert.match(migration, /p_antifraud_status = 'under_review'.+cardinality\(v_signals\) < 2/s);
});

test("browser telemetry cannot choose a disposition, while FINALIZE persists only an allowlisted server assessment", () => {
  assert.match(finalize, /assessAntiAutomationRisk\(body\.inputs\.map/);
  assert.match(finalize, /p_antifraud_status: risk\.status === "review_required" \? "under_review" : "verified"/);
  assert.match(finalize, /p_antifraud_signals: risk\.status === "review_required" \? risk\.signals : \[\]/);
  assert.doesNotMatch(finalize, /body\.(?:antiFraud|antifraud|reviewStatus|eligibilityStatus|human)/);
});

test("review resolution is immutable, server-only, and cannot be bypassed through generic eligibility tooling", () => {
  assert.match(migration, /create table private\.antifraud_review_decisions/);
  assert.match(migration, /review_id uuid primary key/);
  assert.match(migration, /create function public\.rtw_admin_resolve_validated_run_antifraud_review/);
  assert.match(migration, /if v_existing\.decision = p_decision then return v_existing\.decision/);
  assert.match(migration, /Use the anti-fraud review resolver for this run/);
  assert.match(migration, /revoke all on function public\.rtw_admin_resolve_validated_run_antifraud_review[\s\S]+from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.rtw_admin_resolve_validated_run_antifraud_review[\s\S]+to service_role/);
  assert.match(migration, /alter table private\.game_session_antifraud_observations enable row level security/);
  assert.match(migration, /Pending anti-fraud review must use the audited resolver/);
  assert.doesNotMatch(migration, /grant\s+.+\s+to\s+(?:anon|authenticated|public)/i);
});

test("final payment state fails closed unless an explicit owner authorization exists", () => {
  assert.match(migration, /can_authorize_final_payment boolean not null default false/);
  assert.match(migration, /p_new_status = 'paid' and not exists[\s\S]+can_authorize_final_payment/);
  assert.match(migration, /Owner payment authorization is required/);
  assert.match(migration, /app\.rtw_owner_final_payment/);
  assert.match(migration, /create or replace function private\.protect_provisional_winner/);
});

test("the hourly demo is not shipped as a player route or API surface", () => {
  const hourlySurface = [
    "app/hourly-demo/page.tsx",
    "app/api/hourly-demo/start/route.ts",
    "components/hourly-demo/hourly-demo-game.tsx",
  ];
  for (const path of hourlySurface) {
    assert.equal(existsSync(resolve(root, path)), false, `${path} should be removed from the local player surface`);
  }
  assert.doesNotMatch(styles, /rtw-hourly|rtw-challenge/);
});
