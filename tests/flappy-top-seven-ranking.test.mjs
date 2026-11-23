import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migration = await readFile(new URL("supabase/migrations/20261123031521_fix_flappy_top_seven_score_vector.sql", root), "utf8");

test("Flappy ranking uses precisely the seven daily counting runs for both total and tie-break", () => {
  assert.match(migration, /sum\(d\.score\)\s+filter\(where d\.daily_rank<=7\)/i);
  assert.match(migration, /array_agg\(d\.score order by d\.score desc,d\.session_id\)\s+filter\(where d\.daily_rank<=7\) score_vector/i);
  assert.doesNotMatch(migration, /score\s*>\s*1|score\s*>=\s*1|score\s*<>\s*1/i);
  assert.match(migration, /revoke all on function private\.flappy_standings\(date\) from public, anon, authenticated, service_role/i);
});
