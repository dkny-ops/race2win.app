import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
const root = new URL("../", import.meta.url);
const source = await readFile(new URL("lib/competition/flappy-ranking.ts", root), "utf8");
const routeSource = await readFile(new URL("app/api/flappy-race/leaderboard/route.ts", root), "utf8");
function compile(text, require) {
  const mod = { exports: {} };
  const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function("exports", "module", "require", output)(mod.exports, mod, require);
  return mod.exports;
}
function reader({ game = { id: "flappy-only" }, entries = [], totals = [], gameError = null, totalsError = null, next = false } = {}) {
  const calls = [];
  const admin = { from(table) {
    assert.ok(["games", "weekly_tournament_totals"].includes(table), "no private profiles or writes");
    calls.push(["from", table]);
    const q = { select(columns) { calls.push(["select", columns]); return q; },
      eq(key, value) { calls.push(["eq", key, value]); return q; },
      maybeSingle: async () => ({ data: game, error: gameError }),
      in: async (key, values) => { calls.push(["in", key, values]); return { data: totals, error: totalsError }; },
    }; return q;
  } };
  const api = compile(source, name => name === "server-only" ? {} : name.endsWith("/scores") ? {
    currentNewYorkTournamentWeek: () => "2026-10-19",
    readLeaderboard: async params => {
      assert.deepEqual(params, { gameSlug: "flappy-race", week: "2026-10-19", page: 1, pageSize: 50 });
      calls.push(["public-reader"]); return { entries, hasNextPage: next };
    },
  } : name.endsWith("/admin") ? { createAdminClient: () => admin } : assert.fail(name));
  return { api, calls };
}
test("Flappy query parameters cannot select another game, player, score or week", () => {
  const { api } = reader();
  assert.equal(api.parseFlappyPage(new URLSearchParams()), 1);
  assert.equal(api.parseFlappyPage(new URLSearchParams("page=100")), 100);
  for (const query of ["page=0", "page=101", "page=-1", "page=1.5", "page=01", "page=1&page=2", "game=race-to-win", "score=999", "player=x", "week=2026-10-19"]) {
    assert.equal(api.parseFlappyPage(new URLSearchParams(query)), null, query);
  }
});
test("unregistered Flappy game returns honest empty ranking without registration or fallback", async () => {
  const { api, calls } = reader({ game: null });
  const board = await api.readFlappyRanking(1);
  assert.deepEqual(board, { game: "flappy-race", tournamentWeek: "2026-10-19", page: 1, hasNextPage: false, officialEnabled: false, entries: [] });
  assert.ok(calls.some(call => call[0] === "eq" && call[1] === "slug" && call[2] === "flappy-race"));
  assert.ok(!calls.some(call => call[0] === "public-reader"));
});
test("verified public weekly totals remain separated by trusted Flappy game ID", async () => {
  const { api, calls } = reader({ entries: [{ rank: 1, username: "ExistingPlayer", weeklyTotal: 123 }],
    totals: [{ rank_position: 1, weekly_total_score: "123", tie_break_status: "resolved" }], next: true });
  assert.deepEqual((await api.readFlappyRanking(1)).entries, [{ rank: 1, username: "ExistingPlayer", weeklyTotal: 123, reviewRequired: false }]);
  assert.ok(calls.some(call => call[0] === "eq" && call[1] === "game_id" && call[2] === "flappy-only"));
  assert.ok(calls.some(call => call[0] === "eq" && call[1] === "tournament_week_start" && call[2] === "2026-10-19"));
  assert.equal(api.FLAPPY_OFFICIAL_ENABLED, false);
});
test("exact ties remain pending and never receive an arbitrary podium rank", async () => {
  const { api } = reader({ entries: [{ rank: 1, username: "A", weeklyTotal: 50 }, { rank: 2, username: "B", weeklyTotal: 50 }],
    totals: [1, 2].map(rank_position => ({ rank_position, weekly_total_score: 50, tie_break_status: "exact_tie" })) });
  const board = await api.readFlappyRanking(1);
  assert.ok(board.entries.every(entry => entry.rank === null && entry.reviewRequired));
});
test("missing, inconsistent or invalid metadata fails closed", async () => {
  for (const totals of [[], [{ rank_position: 1, weekly_total_score: 51, tie_break_status: "resolved" }],
    [{ rank_position: 1, weekly_total_score: 50, tie_break_status: "unexpected" }],
    [{ rank_position: 1, weekly_total_score: "-1", tie_break_status: "resolved" }]]) {
    const { api } = reader({ entries: [{ rank: 1, username: "A", weeklyTotal: 50 }], totals });
    await assert.rejects(api.readFlappyRanking(1));
  }
  await assert.rejects(reader({ gameError: new Error("denied") }).api.readFlappyRanking(1), /denied/);
  await assert.rejects(reader().api.readFlappyRanking(101), /Invalid page/);
});
function route({ configured = true, read = async () => ({ entries: [], game: "flappy-race" }) } = {}) {
  const { api } = reader();
  return compile(routeSource, name => name === "next/server" ? { NextResponse: { json: (data, options = {}) => ({ data, status: options.status ?? 200, headers: options.headers }) } } :
    name.endsWith("/flappy-ranking") ? { ...api, readFlappyRanking: read } :
    name.endsWith("/admin") ? { isAdminConfigured: () => configured } : assert.fail(name));
}
test("manipulated and duplicate POST submissions are always denied without reading bodies or touching storage", async () => {
  let reads = 0;
  const api = route({ read: async () => { reads++; assert.fail("score storage called"); } });
  const request = { json() { assert.fail("untrusted body should not be consumed"); } };
  for (let i = 0; i < 3; i++) {
    const result = await api.POST(request);
    assert.equal(result.status, 403);
    assert.equal(result.data.code, "FLAPPY_OFFICIAL_DISABLED");
    assert.equal(result.headers["Cache-Control"], "private, no-store");
  }
  assert.equal(reads, 0);
});
test("ranking GET validates requests and fails closed on missing configuration or DB failure", async () => {
  assert.equal((await route().GET(new Request("https://test/api?game=race-to-win"))).status, 400);
  assert.equal((await route({ configured: false }).GET(new Request("https://test/api"))).status, 503);
  assert.equal((await route({ read: async () => { throw new Error("private database detail"); } }).GET(new Request("https://test/api"))).status, 503);
  assert.equal((await route().GET(new Request("https://test/api"))).status, 200);
});
test("shared weekly materializer retains daily top seven, NY dates and score-vector ties", async () => {
  const sql = await readFile(new URL("supabase/migrations/20260907000100_create_competition_foundation.sql", root), "utf8");
  assert.match(sql, /America\/New_York/);
  assert.match(sql, /ranked\.daily_rank <= 7/);
  assert.match(sql, /sum\(daily\.score\)/i);
  assert.match(sql, /array_agg\(run\.score order by run\.score desc,/i);
  assert.match(sql, /exact_tie/);
  // These are source-contract checks. SQL execution/RLS in production is not claimed.
});
test("Flappy UI renders public rows, review ties and podium classes without sample production data", async () => {
  const component = await readFile(new URL("components/scores/flappy-ranking.tsx", root), "utf8");
  const board = { game: "flappy-race", tournamentWeek: "2026-10-19", page: 1, hasNextPage: false, officialEnabled: false,
    entries: [{ rank: 1, username: "<Existing>", weeklyTotal: 123, reviewRequired: false },
      { rank: null, username: "Tied", weeklyTotal: 100, reviewRequired: true }] };
  let index = 0;
  const api = compile(component, name => name === "react" ? {
    useEffect() {}, useState() { return [[1, board, false][index++], () => {}]; },
  } : name === "react/jsx-runtime" ? jsx : assert.fail(name));
  const html = renderToStaticMarkup(jsx.jsx(api.FlappyRankingTable, { language: "es" }));
  assert.match(html, /ranking-row--1/);
  assert.match(html, /&lt;Existing&gt;/);
  assert.match(html, /Empate absoluto/);
  assert.doesNotMatch(html, /ranking-row--null/);
  assert.match(html, /no se guardan en el ranking/);
});
