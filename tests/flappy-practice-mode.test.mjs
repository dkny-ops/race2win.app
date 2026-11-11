import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../components/game/flappy-verified-canvas.tsx", import.meta.url), "utf8");

test("Flappy guest practice never creates an official session or sends scoring evidence", () => {
  assert.doesNotMatch(component, /<select|setMode|useSearchParams|location\.search|getRandomValues/);
  assert.match(component, /const session = authenticated \? await startFlappyOfficial\(\) : null/);
  assert.match(component, /official\.current = session/);
  assert.match(component, /if \(session\) beginVerification\(session\.sessionId, session\.turnstile\)/);
  assert.match(component, /if \(official\.current\)/);
  assert.match(component, /if \(busy\.current \|\| !official\.current\)/);
  assert.match(component, /const blocked = authenticated &&/);
  assert.match(component, /disabled=\{blocked/);
});

test("Flappy official competition still requires authentication and server validation", () => {
  assert.match(component, /FLAPPY_COMPETITION_ENABLED/);
  assert.match(component, /await startFlappyOfficial\(\)/);
  assert.match(component, /await checkpointFlappyOfficial\(/);
  assert.match(component, /await finalizeFlappyOfficial\(/);
  assert.match(component, /await finishVerification\(/);
});
