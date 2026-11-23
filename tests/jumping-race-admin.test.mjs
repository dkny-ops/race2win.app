import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const week = "2026-11-02";
const playerId = "00000000-0000-4000-8000-000000000002";
const decision = { week, playerId, action: "approved", confirmed: true };
const closure = { week, action: "close", confirmed: true };

function compile(path, imports) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const compiled = { exports: {} };
  new Function("exports", "module", "require", outputText)(
    compiled.exports, compiled, name => name in imports ? imports[name] : assert.fail(name),
  );
  return compiled.exports;
}

function setup({ authorized = true, error = null } = {}) {
  const calls = [];
  const body = compile("../lib/competition/request-body.ts", { "server-only": {} });
  const api = compile("../app/api/admin/jumping-race/review/route.ts", {
    "next/server": require("next/server"),
    "@/lib/competition/server": {
      isUuid: value => value === playerId,
      readBoundedJson: body.readBoundedJson,
    },
    "@/lib/game/flappy/tournament": { parseFlappyWeek: value => value === week ? value : null },
    "@/lib/security/prize-admin": {
      getAuthorizedPrizeAdmin: async () => authorized ? {
        context: { userId: "verified-owner" },
        admin: { rpc: async (name, args) => { calls.push([name, args]); return { error }; } },
      } : null,
    },
  });
  return { post: api.POST, calls };
}

function request(body, origin = "https://test", site = "same-origin") {
  return new Request("https://test/api/admin/jumping-race/review", {
    method: "POST",
    headers: { origin, "sec-fetch-site": site, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("Jumping Race admin rejects cross-site requests and unauthorized players before any RPC", async () => {
  const authorized = setup();
  assert.equal((await authorized.post(request(decision, "https://outside.test"))).status, 403);
  assert.equal((await authorized.post(request(decision, "https://test", "cross-site"))).status, 403);
  assert.deepEqual(authorized.calls, []);
  const denied = setup({ authorized: false });
  assert.equal((await denied.post(request(decision))).status, 404);
  assert.deepEqual(denied.calls, []);
});

test("Jumping Race review rejects financial actions and unconfirmed or forged input", async () => {
  const { post, calls } = setup();
  for (const input of [
    ...["activate", "allocate", "paid"].map(action => ({ ...decision, action })),
    { ...decision, confirmed: false }, { ...decision, actor: "forged" },
    { ...decision, note: "browser supplied reason" }, { ...decision, playerId: "invalid" },
    { ...closure, week: "2026-11-03" }, { ...closure, playerId },
  ]) assert.equal((await post(request(input))).status, 400);
  assert.deepEqual(calls, []);
});

test("Jumping Race review routes only confirmed decisions and closures to Jumping Race RPCs", async () => {
  const { post, calls } = setup();
  const result = await post(request(decision));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.equal((await post(request(closure))).status, 200);
  assert.deepEqual(calls, [
    ["jr_decide_prize_candidate", {
      p_actor: "verified-owner", p_week: week, p_player: playerId,
      p_decision: "approved", p_note: "Owner approved the candidate after manual review.",
    }],
    ["jr_close_prize_period", { p_actor: "verified-owner", p_week: week }],
  ]);
  const blocked = setup({ error: { code: "P0001" } });
  assert.equal((await blocked.post(request(closure))).status, 409);
});
