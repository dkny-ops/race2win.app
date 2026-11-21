import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../components/game/flappy-verified-canvas.tsx", import.meta.url), "utf8");

test("Flappy guest practice stays local while authenticated play uses official sessions", () => {
  assert.doesNotMatch(component, /<select|setMode|useSearchParams|location\.search|getRandomValues/);
  assert.match(component, /const FLAPPY_TURNSTILE_DIAGNOSTIC_PRACTICE = false/);
  assert.doesNotMatch(component, /FLAPPY_TURNSTILE_DIAGNOSTIC_PRACTICE && g\.tick >= nextCheckpoint\.current/);
  assert.match(component, /const session = authenticated && !FLAPPY_TURNSTILE_DIAGNOSTIC_PRACTICE \? await startFlappyOfficial\(token!, challenge!\.nonce\) : null/);
  assert.match(component, /official\.current = session/);
  assert.doesNotMatch(component, /beginVerification\(session\.sessionId/);
  assert.match(component, /if \(official\.current\)/);
  assert.match(component, /if \(busy\.current \|\| !official\.current\)/);
  assert.match(component, /const blocked = !FLAPPY_TURNSTILE_DIAGNOSTIC_PRACTICE && authenticated &&/);
  assert.match(component, /disabled=\{blocked/);
});

test("Flappy official competition still requires authentication and server validation", () => {
  assert.match(component, /FLAPPY_COMPETITION_ENABLED/);
  assert.match(component, /await prepareFlappyOfficial\(\)/);
  assert.match(component, /await startFlappyOfficial\(token!, challenge!\.nonce\)/);
  assert.match(component, /await checkpointFlappyOfficial\(/);
  assert.match(component, /await finalizeFlappyOfficial\(/);
  assert.doesNotMatch(component, /await finishVerification\(/);
});
