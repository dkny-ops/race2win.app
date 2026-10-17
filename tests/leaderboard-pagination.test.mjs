import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../lib/competition/scores.ts', import.meta.url), 'utf8');
function scores(rows = [], { error = null, payload } = {}) {
  const calls = [];
  const admin = {
    from(table) {
      assert.equal(table, 'games', 'private profiles and totals must use the restricted reader');
      const q = { select() { return q; }, eq() { return q; },
        maybeSingle: async () => ({ data: { id: 'game', slug: 'race-to-win', display_name: 'Race To Win' }, error: null }),
      }; return q;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      assert.equal(name, 'rtw_read_public_leaderboard_page_metadata');
      const publicRows = rows.filter(row => row.username);
      const start = (args.p_page - 1) * args.p_page_size;
      return { error, data: payload === undefined ? { total_public_entries: publicRows.length, entries: publicRows.slice(start, start + args.p_page_size) } : payload };
    },
  };
  const compiled = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports','module','require',output)(compiled.exports, compiled, name => name === 'server-only' ? {} : name.includes('/routes') ? { RACE_TO_WIN_GAME_SLUG: 'race-to-win' } : { createAdminClient: () => admin });
  return { ...compiled.exports, calls };
}
const params = { gameSlug: 'race-to-win', week: '2026-10-12', page: 1, pageSize: 50 };

test('world reader works with profiles denied and preserves verified totals', async () => {
  const api = scores([{ rank_position: 1, username: 'Racer', weekly_total_score: '5418' }]);
  const result = await api.readLeaderboard(params);
  assert.deepEqual(result.entries, [{ rank: 1, username: 'Racer', weeklyTotal: 5418 }]);
  assert.deepEqual(api.calls, [{ name: 'rtw_read_public_leaderboard_page_metadata', args: { p_game_id: 'game', p_tournament_week_start: '2026-10-12', p_page: 1, p_page_size: 50 } }]);
  assert.equal(result.hasNextPage, false);
});
test('public pagination fills pages despite private profiles and preserves ranks', async () => {
  const rows = Array.from({ length: 52 }, (_, i) => ({ rank_position: i + 1, username: i === 0 ? null : `Racer ${i}`, weekly_total_score: 10000 - i }));
  const api = scores(rows);
  const first = await api.readLeaderboard(params);
  assert.equal(first.entries.length, 50);
  assert.equal(first.entries[0].rank, 2);
  assert.equal(first.hasNextPage, true);
  const second = await api.readLeaderboard({ ...params, page: 2 });
  assert.deepEqual(second.entries.map(x => x.rank), [52]);
  assert.equal(second.hasNextPage, false);
  assert.ok(first.entries.every(x => Object.keys(x).sort().join(',') === 'rank,username,weeklyTotal'));
  const empty = await api.readLeaderboard({ ...params, page: 3 });
  assert.deepEqual(empty.entries, []);
  assert.equal(empty.hasNextPage, false);
});
test('empty weeks and the last allowed page do not offer continuation', async () => {
  assert.equal((await scores().readLeaderboard(params)).hasNextPage, false);
  assert.equal((await scores([], { payload: { entries: [], total_public_entries: 10000 } }).readLeaderboard({ ...params, page: 100 })).hasNextPage, false);
});
test('RPC errors and malformed responses fail closed without profile fallback', async () => {
  await assert.rejects(scores([], { error: new Error('denied') }).readLeaderboard(params), /denied/);
  for (const payload of [null, {}, { entries: [], total_public_entries: 'bad' }]) {
    await assert.rejects(scores([], { payload }).readLeaderboard(params), /Invalid public leaderboard/);
  }
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
