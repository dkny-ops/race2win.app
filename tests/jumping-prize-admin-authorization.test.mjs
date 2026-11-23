import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const actor = "11111111-1111-4111-8111-111111111111";
const player = "22222222-2222-4222-8222-222222222222";
const source = readFileSync(new URL("../app/api/admin/jumping-race/prizes/route.ts", import.meta.url), "utf8");
const paymentSource = readFileSync(new URL("../app/api/admin/jumping-race/confirm-payment/route.ts", import.meta.url), "utf8");

function load({ authorized = true, rpcError = false } = {}) {
  const calls = []; const compiled = { exports: {} };
  const imports = {
    "next/server": require("next/server"),
    "@/lib/competition/request-body": { readBoundedJson: request => request.json() },
    "@/lib/competition/server": { isUuid: value => value === actor || value === player },
    "@/lib/game/flappy/tournament": { parseFlappyWeek: value => value === "2026-11-16" ? value : null },
    "@/lib/security/prize-admin": { getAuthorizedPrizeAdmin: async () => authorized ? {
      context: { userId: actor }, admin: { rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: rpcError ? {} : null }; } },
    } : null },
  };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("exports", "module", "require", code)(compiled.exports, compiled, name => name in imports ? imports[name] : assert.fail(name));
  return { ...compiled.exports, calls };
}

const request = (body, origin = "https://test.invalid") => new Request("https://test.invalid/api/admin/jumping-race/prizes", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
});

test("Jumping prize administration is same-origin, owner-derived, and never accepts browser award values", async () => {
  const cross = load();
  assert.equal((await cross.POST(request({ action: "activate", confirmed: true }, "https://evil.invalid"))).status, 403);
  assert.equal(cross.calls.length, 0);
  const anonymous = load({ authorized: false });
  assert.equal((await anonymous.POST(request({ action: "activate", confirmed: true }))).status, 404);
  assert.equal(anonymous.calls.length, 0);
  for (const invalid of [
    { action: "activate", confirmed: false },
    { action: "activate", confirmed: true, amountCents: 500 },
    { week: "2026-11-16", playerId: player, action: "allocate", note: "" },
    { week: "2026-11-16", playerId: player, action: "allocate", note: "Reviewed", actor },
    { week: "2026-11-16", playerId: player, action: "paid", note: "Reviewed" },
  ]) {
    const api = load(); assert.equal((await api.POST(request(invalid))).status, 400); assert.equal(api.calls.length, 0);
  }
});

test("Jumping activation and allocation use only the authenticated owner and service-only RPCs", async () => {
  const activation = load();
  assert.equal((await activation.POST(request({ action: "activate", confirmed: true }))).status, 200);
  assert.deepEqual(activation.calls, [{ name: "jr_activate_prize_program", args: { p_actor: actor } }]);
  const allocation = load();
  const body = { week: "2026-11-16", playerId: player, action: "allocate", note: "Owner reviewed the frozen candidate" };
  assert.equal((await allocation.POST(request(body))).status, 200);
  assert.deepEqual(allocation.calls, [{ name: "jr_admin_allocate_prize", args: { p_actor: actor, p_week: body.week, p_player: player, p_note: body.note } }]);
});

test("Jumping payment record remains owner-only, game-scoped, and manual", () => {
  assert.match(paymentSource, /getAuthorizedPrizeAdmin/);
  assert.match(paymentSource, /request\.headers\.get\("origin"\) !== new URL\(request\.url\)\.origin/);
  assert.match(paymentSource, /eq\("slug", "jumping-race"\)/);
  assert.match(paymentSource, /confirmedPaidByOwner !== true/);
  assert.match(paymentSource, /balance\.available_cents < 2000/);
  assert.match(paymentSource, /rtw_owner_confirm_full_balance_paid/);
  assert.doesNotMatch(paymentSource, /fetch\([^)]*payout/i);
});
