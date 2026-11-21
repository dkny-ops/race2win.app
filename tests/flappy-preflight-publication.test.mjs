import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Flappy binds the pre-flight Turnstile token to a single-use server nonce", async () => {
  const [server, widget, migration] = await Promise.all([
    read("lib/game/flappy/server.ts"), read("app/sign-in/turnstile-widget.tsx"),
    read("supabase/migrations/20261121173619_flappy_preflight_turnstile_score_publication.sql"),
  ]);
  assert.match(server, /expectedCdata: \(preflight as Record<string, unknown>\)\.nonce/);
  assert.match(server, /flappy_create_preflight/);
  assert.match(widget, /cData: cdata/);
  assert.match(migration, /private\.flappy_preflight_checks/);
  assert.match(migration, /p\.consumed_at is not null/);
  assert.match(migration, /session_id=s\.id/);
});

test("Flappy publishes only new replay-verified preflight sessions and preserves held history", async () => {
  const [server, client, migration] = await Promise.all([
    read("lib/game/flappy/server.ts"), read("lib/game/flappy/official-client.ts"),
    read("supabase/migrations/20261121173619_flappy_preflight_turnstile_score_publication.sql"),
  ]);
  assert.doesNotMatch(server, /eligibility: "under_review"/);
  assert.match(client, /eligibility: "valid" \| "under_review"/);
  assert.match(migration, /new\.eligibility := case when v_perfect then 'under_review' else 'valid' end/);
  assert.doesNotMatch(migration, /update private\.flappy_runs set eligibility/);
  assert.match(migration, /returning \* into r/);
  assert.match(migration, /'eligibility',r\.eligibility/);
});

test("No in-flight Turnstile widget, request, or timer remains in the Flappy canvas", async () => {
  const component = await read("components/game/flappy-verified-canvas.tsx");
  assert.doesNotMatch(component, /useFlappyInvisibleCheck/);
  assert.doesNotMatch(component, /beginVerification/);
  assert.match(component, /prepareFlappyOfficial/);
  assert.match(component, /cdata=\{pregame\.nonce\}/);
});
