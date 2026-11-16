import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migration = new URL("../supabase/migrations/20261116010000_add_jumping_race_official_score.sql", import.meta.url);

test("Jumping Race score migration is isolated, disabled, and service-only", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /insert into private\.jumping_race_control\(singleton, enabled\)\s+values \(true, false\)/i);
  assert.match(sql, /plays_consumed between 0 and 5/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /unique \(player_id, start_request_id\)/i);
  assert.match(sql, /primary key \(session_id, checkpoint_index\)/i);
  assert.match(sql, /session_id uuid primary key/i);
  assert.match(sql, /revoke all on function public\.jr_read_allowance[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.jr_read_allowance[\s\S]* to service_role/i);
  assert.doesNotMatch(sql, /(?:create|alter|insert into|update|delete from)\s+(?:private\.)?(?:prize_|payout|wallet|provisional_winner)/i);
  assert.doesNotMatch(sql, /grant .* to (?:anon|authenticated).*jr_start_session/i);
});

