import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

test('personal scores expose only the owner current-week pending runs and preserve official totals', async () => {
  const source = await readFile(new URL('../lib/competition/scores.ts', import.meta.url), 'utf8');
  const queries = [];
  const admin = { from(table) {
    const filters = [];
    const result = table === 'games' ? { id: 'game', slug: 'race-to-win', display_name: 'Race To Win' }
      : table === 'weekly_tournament_totals' ? { weekly_total_score: 5332, rank_position: 1 }
      : table === 'validated_runs' ? [{ game_session_id: 'saved-session', score: 13, tournament_day: '2026-10-17' }] : [];
    const q = {
      select() { return q; }, eq(key, value) { filters.push([key, value]); return q; }, order() { return q; }, limit(value) { q.bound = value; return q; },
      maybeSingle() { return Promise.resolve({ data: result, error: null }); },
      then(resolve, reject) { return Promise.resolve({ data: result, error: null }).then(resolve, reject); },
    };
    queries.push({ table, filters, q }); return q;
  } };
  const compiled = { exports: {} };
  new Function('exports', 'module', 'require', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(compiled.exports, compiled, name => name === 'server-only' ? {} : name.endsWith('/routes') ? { RACE_TO_WIN_GAME_SLUG: 'race-to-win' } : { createAdminClient: () => admin });
  const scores = await compiled.exports.readPersonalScores('authenticated-owner');
  assert.equal(scores.weeklyTotal, 5332);
  assert.deepEqual(scores.pendingRuns, [{ sessionId: 'saved-session', score: 13, tournamentDay: '2026-10-17' }]);
  const pending = queries.find(q => q.filters.some(([key, value]) => key === 'eligibility_status' && value === 'under_review'));
  assert.ok(pending);
  assert.ok(pending.filters.some(([key, value]) => key === 'player_id' && value === 'authenticated-owner'));
  assert.ok(pending.filters.some(([key, value]) => key === 'game_id' && value === 'game'));
  assert.ok(pending.filters.some(([key, value]) => key === 'tournament_week_start' && value === scores.tournamentWeek));
  assert.equal(pending.q.bound, 50);
});
