import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("lib/competition/flappy-personal-score.ts", root), "utf8");
const routeSource = await readFile(new URL("app/api/flappy-race/personal/route.ts", root), "utf8");
const migration = await readFile(new URL("supabase/migrations/20261026162643_flappy_personal_weekly_score.sql", root), "utf8");

function compile(text, require) {
  const mod = { exports: {} };
  new Function("exports", "module", "require", ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(mod.exports, mod, require);
  return mod.exports;
}

function dayAt(index) {
  const date = new Date("2026-10-26T12:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

const valid = {
  week: "2026-10-26",
  weeklyTotal: 18,
  days: Array.from({ length: 7 }, (_, index) => {
    const scores = index === 0 ? [8, 5] : index === 1 ? [5] : [];
    return { day: dayAt(index), topScores: scores, dailyTotal: scores.reduce((sum, score) => sum + score, 0) };
  }),
};

function reader({ data, error = null } = {}) {
  const calls = [];
  const api = compile(source, (name) => name === "server-only" ? {} :
    name.endsWith("/scores") ? { currentNewYorkTournamentWeek: () => "2026-10-26" } :
    name.endsWith("/admin") ? { createAdminClient: () => ({
      async rpc(fn, args) { calls.push([fn, args]); return { data, error }; },
    }) : assert.fail(name));
  return { api, calls };
}

test("personal Flappy score reads only server-selected player and current New York week", async () => {
  const player = "11111111-1111-4111-8111-111111111111";
  const { api, calls } = reader({ data: valid });
  const result = await api.readFlappyPersonalWeek(player);
  assert.equal(result.weeklyTotal, 18);
  assert.deepEqual(calls, [[ "flappy_read_personal_week", { p_player: player, p_week: "2026-10-26" } ]]);
});

test("personal Flappy score rejects malformed, inflated and non-counting metadata", async () => {
  const player = "11111111-1111-4111-8111-111111111111";
  for (const data of [
    null,
    { ...valid, weeklyTotal: 19 },
    { ...valid, days: valid.days.slice(0, 6) },
    { ...valid, days: [{ ...valid.days[0], topScores: [5, 8] }, ...valid.days.slice(1)] },
    { ...valid, days: [{ ...valid.days[0], topScores: Array(8).fill(1), dailyTotal: 8 }, ...valid.days.slice(1)] },
  ]) await assert.rejects(reader({ data }).api.readFlappyPersonalWeek(player));
  await assert.rejects(reader({ data: valid }).api.readFlappyPersonalWeek("player-from-client"));
});

function route({ player = "11111111-1111-4111-8111-111111111111", configured = true, read = async () => valid } = {}) {
  return compile(routeSource, (name) =>
    name === "next/server" ? { NextResponse: { json: (data, options = {}) => ({ data, status: options.status ?? 200, headers: options.headers }) } } :
    name.endsWith("/server") ? { getVerifiedPlayerId: async () => player } :
    name.endsWith("/flappy-personal-score") ? { readFlappyPersonalWeek: read } :
    name.endsWith("/admin") ? { isAdminConfigured: () => configured } :
    name.endsWith("/security-event") ? { createSecurityRequestId: () => "request", logSecurityEvent() {} } : assert.fail(name));
}

test("personal endpoint derives identity server-side and fails closed", async () => {
  let selected = "";
  const endpoint = route({ read: async (player) => { selected = player; return valid; } });
  const result = await endpoint.GET();
  assert.equal(result.status, 200);
  assert.equal(selected, "11111111-1111-4111-8111-111111111111");
  assert.equal((await route({ player: null }).GET()).status, 401);
  assert.equal((await route({ configured: false }).GET()).status, 503);
  assert.equal((await route({ read: async () => { throw new Error("private"); } }).GET()).status, 503);
});

test("personal-score migration exposes no player RPC to browser roles and counts only seven valid runs per day", () => {
  assert.match(migration, /r\.eligibility = 'valid'/);
  assert.match(migration, /daily_rank <= 7/);
  assert.match(migration, /revoke all on function public\.flappy_read_personal_week\(uuid, date\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.flappy_read_personal_week\(uuid, date\) to service_role/i);
});
