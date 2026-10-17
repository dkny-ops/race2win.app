import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../lib/competition/scores.ts', import.meta.url), 'utf8');
function scores(rows = []) {
  let profileIds = [];
  const admin = { from(table) {
    const q = { select() { return q; }, eq() { return q; }, order() { return q; },
      maybeSingle: async () => ({ data: { id: 'game', slug: 'race-to-win', display_name: 'Race To Win' }, error: null }),
      range: async (from, to) => ({ data: rows.slice(from, to + 1), error: null }),
      in: async (_field, ids) => { profileIds = ids; return { data: ids.filter(id => id !== 'private').map(id => ({ user_id: id, username: `Racer ${id}` })), error: null }; },
    }; return q;
  } };
  const compiled = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports','module','require',output)(compiled.exports, compiled, name => name === 'server-only' ? {} : name.includes('/routes') ? { RACE_TO_WIN_GAME_SLUG: 'race-to-win' } : { createAdminClient: () => admin });
  return { ...compiled.exports, profileIds: () => profileIds };
}
test('world pages return 50 entries and detect continuation from the database row', async () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({ player_id: String(i), rank_position: i + 1, weekly_total_score: 10000 - i }));
  const api = scores(rows);
  const first = await api.readLeaderboard({ gameSlug: 'race-to-win', week: '2026-10-12', page: 1, pageSize: 50 });
  assert.equal(first.entries.length, 50);
  assert.equal(first.hasNextPage, true);
  const second = await api.readLeaderboard({ gameSlug: 'race-to-win', week: '2026-10-12', page: 2, pageSize: 50 });
  assert.deepEqual(second.entries.map(x => x.rank), [51]);
  assert.equal(second.hasNextPage, false);
});
test('private usernames do not stop pagination or expose player identifiers', async () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({ player_id: i === 49 ? 'private' : String(i), rank_position: i + 1, weekly_total_score: 10000 - i }));
  const api = scores(rows);
  const result = await api.readLeaderboard({ gameSlug: 'race-to-win', week: '2026-10-12', page: 1, pageSize: 50 });
  assert.equal(result.hasNextPage, true);
  assert.equal(result.entries.length, 49);
  assert.ok(result.entries.every(x => Object.keys(x).sort().join(',') === 'rank,username,weeklyTotal'));
});
test('New York week respects Sunday/Monday and DST; default page size is 50', () => {
  const api = scores();
  assert.equal(api.currentNewYorkTournamentWeek(new Date('2026-10-19T03:59:59Z')), '2026-10-12');
  assert.equal(api.currentNewYorkTournamentWeek(new Date('2026-10-19T04:00:00Z')), '2026-10-19');
  assert.equal(api.currentNewYorkTournamentWeek(new Date('2026-11-02T05:00:00Z')), '2026-11-02');
  assert.equal(api.parseLeaderboardRequest(new URLSearchParams()).pageSize, 50);
  assert.equal(api.parseLeaderboardRequest(new URLSearchParams('pageSize=51')), null);
  assert.equal(api.parseLeaderboardRequest(new URLSearchParams('page=0')), null);
});
